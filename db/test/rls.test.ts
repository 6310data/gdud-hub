/**
 * Row-Level Security tests. Runs the real migrations on an in-memory Postgres (PGlite)
 * and checks what each kind of user can and cannot see or change.
 * Add a block here for every new module table.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { runAsUser, type JwtClaims, type Tx } from "../src/index";
import * as schema from "../src/schema/index";
import { SUPABASE_SHIM_SQL } from "./supabase-shim";

const here = path.dirname(fileURLToPath(import.meta.url));
const { units, people, appUsers, memberships, auditLog } = schema;

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const ids = {
  bat: randomUUID(),
  plsr: randomUUID(),
  plsr1: randomUUID(),
  plnt: randomUUID(),
};

interface TestUser {
  authId: string;
  email: string;
  appId?: string;
}
const su: TestUser = { authId: randomUUID(), email: "su@example.com" };
const coreAdmin: TestUser = { authId: randomUUID(), email: "admin@example.com" };
const clerk: TestUser = { authId: randomUUID(), email: "clerk@example.com" };
const editor: TestUser = { authId: randomUUID(), email: "editor@example.com" };
const stranger: TestUser = { authId: randomUUID(), email: "stranger@example.com" };
const inactive: TestUser = { authId: randomUUID(), email: "gone@example.com" };

const claims = (u: TestUser, extra: Partial<JwtClaims> = {}): JwtClaims => ({
  sub: u.authId,
  email: u.email,
  app_metadata: { provider: "google" },
  user_metadata: { email_verified: true },
  ...extra,
});

const as = <T>(u: TestUser, fn: (tx: Tx) => Promise<T>, extra?: Partial<JwtClaims>) =>
  runAsUser(db as never, claims(u, extra), fn);

/** Expect the statement to fail (RLS violation or missing privilege). */
async function rejects(p: Promise<unknown>) {
  await expect(p).rejects.toThrow();
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE_SHIM_SQL);
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(here, "../migrations") });

  // Seed as the owner (bypasses RLS) — like the bootstrap script.
  await db.insert(units).values([
    { id: ids.bat, kind: "battalion", name: "גדוד" },
    { id: ids.plsr, parentId: ids.bat, kind: "company", name: "פלס״ר", code: "plsr" },
    { id: ids.plsr1, parentId: ids.plsr, kind: "platoon", name: "מחלקה 1" },
    { id: ids.plnt, parentId: ids.bat, kind: "company", name: "פלנ״ט", code: "plnt" },
  ]);
  await db.insert(people).values([
    { unitId: ids.plsr, fullName: "חייל פלסר" },
    { unitId: ids.plsr1, fullName: "חייל מחלקה 1" },
    { unitId: ids.plnt, fullName: "חייל פלנט" },
  ]);
  const rows = await db
    .insert(appUsers)
    .values([
      { email: su.email, authUserId: su.authId, isSuperAdmin: true },
      { email: coreAdmin.email, authUserId: coreAdmin.authId },
      { email: clerk.email, authUserId: clerk.authId },
      { email: editor.email, authUserId: editor.authId },
      { email: inactive.email, authUserId: inactive.authId, active: false },
    ])
    .returning();
  for (const u of [su, coreAdmin, clerk, editor, inactive]) {
    u.appId = rows.find((r) => r.email === u.email)!.id;
  }
  await db.insert(memberships).values([
    { userId: coreAdmin.appId!, module: "core", role: "admin", unitId: null },
    { userId: clerk.appId!, module: "doch1", role: "company_user", unitId: ids.plsr },
    { userId: editor.appId!, module: "core", role: "editor", unitId: ids.plsr },
    { userId: inactive.appId!, module: "core", role: "admin", unitId: null },
  ]);
});

describe("runAsUser", () => {
  it("switches to the authenticated role with the user's claims", async () => {
    const r = await as(clerk, (tx) =>
      tx.execute(sql`select current_user as role, auth.uid()::text as uid`),
    );
    const row = (r as unknown as { rows: { role: string; uid: string }[] }).rows[0]!;
    expect(row).toEqual({ role: "authenticated", uid: clerk.authId });
  });
});

describe("units", () => {
  it("any active user reads the structure", async () => {
    const r = await as(clerk, (tx) => tx.select().from(units));
    expect(r).toHaveLength(4);
  });

  it("signed-in but not invited → sees nothing", async () => {
    const r = await as(stranger, (tx) => tx.select().from(units));
    expect(r).toHaveLength(0);
  });

  it("deactivated user → sees nothing", async () => {
    const r = await as(inactive, (tx) => tx.select().from(units));
    expect(r).toHaveLength(0);
  });

  it("only battalion core admin can add units", async () => {
    await rejects(as(clerk, (tx) => tx.insert(units).values({ kind: "team", name: "x" })));
    await rejects(as(editor, (tx) => tx.insert(units).values({ kind: "team", name: "x" })));
    const r = await as(coreAdmin, (tx) =>
      tx.insert(units).values({ parentId: ids.plnt, kind: "platoon", name: "מחלקה 2" }).returning(),
    );
    expect(r).toHaveLength(1);
  });
});

describe("people", () => {
  it("company user sees only their company subtree", async () => {
    const r = await as(clerk, (tx) => tx.select().from(people));
    expect(r.map((p) => p.fullName).sort()).toEqual(["חייל מחלקה 1", "חייל פלסר"].sort());
  });

  it("company user cannot add people (no core role)", async () => {
    await rejects(as(clerk, (tx) => tx.insert(people).values({ unitId: ids.plsr, fullName: "x" })));
  });

  it("editor adds people in own company, not in another", async () => {
    const ok = await as(editor, (tx) =>
      tx.insert(people).values({ unitId: ids.plsr1, fullName: "חדש" }).returning(),
    );
    expect(ok).toHaveLength(1);
    await rejects(as(editor, (tx) => tx.insert(people).values({ unitId: ids.plnt, fullName: "x" })));
  });

  it("editor cannot move a soldier out of their scope", async () => {
    await rejects(
      as(editor, (tx) =>
        tx.update(people).set({ unitId: ids.plnt }).where(eq(people.fullName, "חייל פלסר")),
      ),
    );
  });

  it("editor update on another company affects 0 rows", async () => {
    const r = await as(editor, (tx) =>
      tx.update(people).set({ notes: "hacked" }).where(eq(people.fullName, "חייל פלנט")).returning(),
    );
    expect(r).toHaveLength(0);
  });

  it("nobody can TRUNCATE", async () => {
    await rejects(as(su, (tx) => tx.execute(sql`truncate public.people cascade`)));
  });
});

describe("app_users & memberships", () => {
  it("regular user sees only their own user row and memberships", async () => {
    const u = await as(clerk, (tx) => tx.select().from(appUsers));
    expect(u.map((x) => x.email)).toEqual([clerk.email]);
    const m = await as(clerk, (tx) => tx.select().from(memberships));
    expect(m).toHaveLength(1);
  });

  it("regular user cannot grant themselves roles", async () => {
    await rejects(
      as(clerk, (tx) =>
        tx.insert(memberships).values({ userId: clerk.appId!, module: "core", role: "admin" }),
      ),
    );
  });

  it("core admin can invite users and grant memberships", async () => {
    const [u] = await as(coreAdmin, (tx) =>
      tx.insert(appUsers).values({ email: "new@example.com" }).returning(),
    );
    await as(coreAdmin, (tx) =>
      tx.insert(memberships).values({ userId: u!.id, module: "logistics", role: "viewer", unitId: ids.plnt }),
    );
  });

  it("granting the same module+scope twice updates the role (upsert)", async () => {
    const grant = (role: string) =>
      as(coreAdmin, (tx) =>
        tx
          .insert(memberships)
          .values({ userId: editor.appId!, module: "doch1", role, unitId: null })
          .onConflictDoUpdate({
            target: [memberships.userId, memberships.module, memberships.unitId],
            set: { role },
          }),
      );
    await grant("viewer");
    await grant("admin");
    const rows = await db
      .select()
      .from(memberships)
      .where(sql`${memberships.userId} = ${editor.appId} and ${memberships.module} = 'doch1'`);
    expect(rows.map((r) => r.role)).toEqual(["admin"]);
  });

  it("core admin cannot create or promote a super admin", async () => {
    await rejects(
      as(coreAdmin, (tx) => tx.insert(appUsers).values({ email: "evil@example.com", isSuperAdmin: true })),
    );
    await rejects(
      as(coreAdmin, (tx) =>
        tx.update(appUsers).set({ isSuperAdmin: true }).where(eq(appUsers.id, coreAdmin.appId!)),
      ),
    );
  });

  it("core admin cannot touch the super admin's row", async () => {
    const r = await as(coreAdmin, (tx) =>
      tx.update(appUsers).set({ active: false }).where(eq(appUsers.id, su.appId!)).returning(),
    );
    expect(r).toHaveLength(0);
  });

  it("nobody can set auth_user_id directly", async () => {
    await rejects(
      as(su, (tx) =>
        tx.update(appUsers).set({ authUserId: randomUUID() }).where(eq(appUsers.id, clerk.appId!)),
      ),
    );
  });
});

describe("link_auth_user()", () => {
  const link = (u: TestUser, extra?: Partial<JwtClaims>) =>
    as(
      u,
      async (tx) => {
        const r = await tx.execute<{ id: string | null }>(sql`select app.link_auth_user() as id`);
        return (r as unknown as { rows: { id: string | null }[] }).rows[0]!.id;
      },
      extra,
    );

  it("links an invited Google account on first sign-in", async () => {
    await db.insert(appUsers).values({ email: "invited@example.com" });
    const invited: TestUser = { authId: randomUUID(), email: "Invited@Example.com" };
    const id = await link(invited);
    expect(id).toBeTruthy();
    const r = await as(invited, (tx) => tx.select().from(appUsers));
    expect(r).toHaveLength(1);
  });

  it("refuses non-Google providers and unverified emails", async () => {
    await db.insert(appUsers).values({ email: "p@example.com" });
    const u: TestUser = { authId: randomUUID(), email: "p@example.com" };
    expect(await link(u, { app_metadata: { provider: "email" } })).toBeNull();
    expect(await link(u, { user_metadata: { email_verified: false } })).toBeNull();
  });

  it("does not hijack an invite already linked to another account", async () => {
    const attacker: TestUser = { authId: randomUUID(), email: clerk.email };
    expect(await link(attacker)).toBeNull();
  });

  it("returns null for emails that were never invited", async () => {
    expect(await link(stranger)).toBeNull();
  });
});

describe("audit_log", () => {
  it("records changes with the acting user", async () => {
    await as(coreAdmin, (tx) =>
      tx.update(units).set({ color: "#1e3a5f" }).where(eq(units.id, ids.plsr)),
    );
    const rows = await db.select().from(auditLog).where(eq(auditLog.rowId, ids.plsr));
    const last = rows.at(-1)!;
    expect(last.action).toBe("update");
    expect(last.actorUserId).toBe(coreAdmin.appId);
  });

  it("is readable by core admin only, and never writable", async () => {
    expect(await as(clerk, (tx) => tx.select().from(auditLog))).toHaveLength(0);
    expect((await as(coreAdmin, (tx) => tx.select().from(auditLog))).length).toBeGreaterThan(0);
    await rejects(as(su, (tx) => tx.insert(auditLog).values({ tableName: "x", action: "fake" })));
  });
});
