/**
 * Row-Level Security tests. Runs the real migrations on an in-memory Postgres (PGlite)
 * and checks what each kind of user can and cannot see or change.
 * Add a block here for every new module table.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { addDays, israelToday } from "@gdud/core";
import { and, eq, sql } from "drizzle-orm";
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

  it("a doch1 company user adds people only in their own company (since 0005_doch1_security)", async () => {
    await rejects(as(clerk, (tx) => tx.insert(people).values({ unitId: ids.plnt, fullName: "x" })));
    await rejects(as(stranger, (tx) => tx.insert(people).values({ unitId: ids.plsr, fullName: "x" })));
    const ok = await as(clerk, (tx) => tx.insert(people).values({ unitId: ids.plsr1, fullName: "חדש מדוח 1" }).returning());
    expect(ok).toHaveLength(1);
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
      tx.insert(memberships).values({ userId: u!.id, module: "logistics", role: "company_user", unitId: ids.plnt }),
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

describe("logistics", () => {
  const {
    logisticsItems: items,
    logisticsKitItems: kitItems,
    logisticsSerials: serials,
    logisticsAssignments: assignments,
    logisticsStorage: storage,
    logisticsForms: forms,
    logisticsEvents: events,
  } = schema;

  const logAdmin: TestUser = { authId: randomUUID(), email: "log-admin@example.com" };
  const plsrAdmin: TestUser = { authId: randomUUID(), email: "plsr-rasap@example.com" };
  const plsrViewer: TestUser = { authId: randomUUID(), email: "plsr-mp@example.com" };
  const plntViewer: TestUser = { authId: randomUUID(), email: "plnt-mp@example.com" };
  const logisticsUsers = [logAdmin, plsrAdmin, plsrViewer, plntViewer];

  const lid = { item: "", s1: "", s2: "", s3: "", plsrSoldier: "", plntSoldier: "" };

  const formData = {
    title: "טופס החתמת ציוד",
    battalion: "גדוד",
    issuedAt: new Date().toISOString(),
    person: { name: "x", personalNumber: null, company: null, platoon: null, phone: null },
    lines: [],
    notes: "",
    signer: "",
    signerTitle: "מחתים",
    issuedBy: "",
    declaration: "",
  };

  const heldSerials = (u: TestUser) =>
    as(u, async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`select app.logistics_held_serials() as id`);
      return (r as unknown as { rows: { id: string }[] }).rows.map((x) => x.id);
    });

  beforeAll(async () => {
    const rows = await db
      .insert(appUsers)
      .values(logisticsUsers.map((u) => ({ email: u.email, authUserId: u.authId })))
      .returning();
    for (const u of logisticsUsers) u.appId = rows.find((r) => r.email === u.email)!.id;
    await db.insert(memberships).values([
      { userId: logAdmin.appId!, module: "logistics", role: "admin", unitId: null },
      { userId: plsrAdmin.appId!, module: "logistics", role: "admin", unitId: ids.plsr },
      { userId: plsrViewer.appId!, module: "logistics", role: "company_user", unitId: ids.plsr },
      { userId: plntViewer.appId!, module: "logistics", role: "company_user", unitId: ids.plnt },
    ]);

    const [item] = await db.insert(items).values({ name: "M4 קצר", category: "נשק" }).returning();
    lid.item = item!.id;
    const ss = await db
      .insert(serials)
      .values([
        { itemId: lid.item, serial: "1001" },
        { itemId: lid.item, serial: "1002" },
        { itemId: lid.item, serial: "1003", condition: "broken" },
      ])
      .returning();
    lid.s1 = ss[0]!.id;
    lid.s2 = ss[1]!.id;
    lid.s3 = ss[2]!.id;
    const ppl = await db.select().from(people);
    lid.plsrSoldier = ppl.find((p) => p.fullName === "חייל מחלקה 1")!.id;
    lid.plntSoldier = ppl.find((p) => p.fullName === "חייל פלנט")!.id;
  });

  describe("catalogue & serials", () => {
    it("users without a logistics membership see nothing", async () => {
      expect(await as(clerk, (tx) => tx.select().from(items))).toHaveLength(0);
      expect(await as(clerk, (tx) => tx.select().from(serials))).toHaveLength(0);
    });

    it("any logistics member reads the catalogue and every serial", async () => {
      expect(await as(plntViewer, (tx) => tx.select().from(items))).toHaveLength(1);
      expect(await as(plntViewer, (tx) => tx.select().from(serials))).toHaveLength(3);
    });

    it("only a battalion-wide admin adds item types, kit and serials", async () => {
      await rejects(as(plsrViewer, (tx) => tx.insert(items).values({ name: "x" })));
      await rejects(as(plsrAdmin, (tx) => tx.insert(items).values({ name: "x" })));
      await rejects(as(plsrAdmin, (tx) => tx.insert(serials).values({ itemId: lid.item, serial: "9" })));
      await rejects(as(plsrAdmin, (tx) => tx.insert(kitItems).values({ itemId: lid.item, name: "רצועה" })));
      const ok = await as(logAdmin, async (tx) => {
        await tx.insert(kitItems).values({ itemId: lid.item, name: "רצועה" });
        return tx.insert(serials).values({ itemId: lid.item, serial: "1004" }).returning();
      });
      expect(ok).toHaveLength(1);
    });

    it("only a battalion-wide admin changes a serial's condition directly", async () => {
      const company = await as(plsrAdmin, (tx) =>
        tx.update(serials).set({ condition: "ok" }).where(eq(serials.id, lid.s3)).returning(),
      );
      expect(company).toHaveLength(0);
      const v = await as(plsrViewer, (tx) =>
        tx.update(serials).set({ condition: "ok" }).where(eq(serials.id, lid.s3)).returning(),
      );
      expect(v).toHaveLength(0);
      const r = await as(logAdmin, (tx) =>
        tx.update(serials).set({ condition: "ok" }).where(eq(serials.id, lid.s3)).returning(),
      );
      expect(r).toHaveLength(1);
    });

    it("the serial number itself can never be edited", async () => {
      await rejects(as(su, (tx) => tx.update(serials).set({ serial: "evil" }).where(eq(serials.id, lid.s1))));
    });

    it("rejects serials with whitespace", async () => {
      await rejects(as(logAdmin, (tx) => tx.insert(serials).values({ itemId: lid.item, serial: "12 34" })));
    });
  });

  describe("assignments", () => {
    it("company admin signs out to a soldier in their company, not in another", async () => {
      const ok = await as(plsrAdmin, (tx) =>
        tx.insert(assignments).values({ serialId: lid.s1, personId: lid.plsrSoldier }).returning(),
      );
      expect(ok[0]!.signedBy).toBe(plsrAdmin.appId);
      await rejects(
        as(plsrAdmin, (tx) => tx.insert(assignments).values({ serialId: lid.s2, personId: lid.plntSoldier })),
      );
    });

    it("a serial can have only one open assignment", async () => {
      await rejects(
        as(logAdmin, (tx) => tx.insert(assignments).values({ serialId: lid.s1, personId: lid.plntSoldier })),
      );
    });

    it("cannot sign out in someone else's name", async () => {
      await rejects(
        as(logAdmin, (tx) =>
          tx.insert(assignments).values({ serialId: lid.s2, personId: lid.plsrSoldier, signedBy: plsrAdmin.appId! }),
        ),
      );
    });

    it("assignments are visible only within scope, but held serials are known to all members", async () => {
      expect(await as(plsrViewer, (tx) => tx.select().from(assignments))).toHaveLength(1);
      expect(await as(plntViewer, (tx) => tx.select().from(assignments))).toHaveLength(0);
      expect(await heldSerials(plntViewer)).toEqual([lid.s1]);
      expect(await heldSerials(clerk)).toEqual([]);
    });

    it("viewers cannot return items", async () => {
      const v = await as(plsrViewer, (tx) =>
        tx.update(assignments).set({ returnedAt: new Date() }).where(eq(assignments.serialId, lid.s1)).returning(),
      );
      expect(v).toHaveLength(0);
    });

    it("cannot move an assignment to another soldier, and nobody deletes history", async () => {
      await rejects(
        as(su, (tx) =>
          tx.update(assignments).set({ personId: lid.plntSoldier }).where(eq(assignments.serialId, lid.s1)),
        ),
      );
      await rejects(as(su, (tx) => tx.delete(assignments).where(eq(assignments.serialId, lid.s1))));
    });

    it("a signed-out serial cannot be deleted", async () => {
      await rejects(as(logAdmin, (tx) => tx.delete(serials).where(eq(serials.id, lid.s1))));
    });

    it("returning (by a company admin) closes the row, sets the condition and frees the serial", async () => {
      await as(plsrAdmin, (tx) =>
        tx
          .update(assignments)
          .set({ returnedAt: new Date(), returnedTo: "broken" })
          .where(eq(assignments.serialId, lid.s1)),
      );
      const [s1] = await db.select().from(serials).where(eq(serials.id, lid.s1));
      expect(s1!.condition).toBe("broken");
      expect(await heldSerials(logAdmin)).toEqual([]);
      await rejects(
        as(plsrAdmin, (tx) => tx.update(assignments).set({ returnedAt: null }).where(eq(assignments.serialId, lid.s1))),
      );
      const again = await as(logAdmin, (tx) =>
        tx.insert(assignments).values({ serialId: lid.s1, personId: lid.plntSoldier }).returning(),
      );
      expect(again).toHaveLength(1);
    });
  });

  describe("storage, forms and events", () => {
    it("storage follows the soldier's unit", async () => {
      const ok = await as(plsrAdmin, (tx) =>
        tx.insert(storage).values({ personId: lid.plsrSoldier, itemName: "קסדה" }).returning(),
      );
      expect(ok).toHaveLength(1);
      await rejects(
        as(plsrAdmin, (tx) => tx.insert(storage).values({ personId: lid.plntSoldier, itemName: "קסדה" })),
      );
      expect(await as(plntViewer, (tx) => tx.select().from(storage))).toHaveLength(0);
    });

    it("forms: created by the acting admin, readable only within scope, immutable", async () => {
      const [f] = await as(plsrAdmin, (tx) =>
        tx.insert(forms).values({ kind: "signout", personId: lid.plsrSoldier, data: formData }).returning(),
      );
      expect(f!.createdBy).toBe(plsrAdmin.appId);
      expect(await as(plsrViewer, (tx) => tx.select().from(forms))).toHaveLength(1);
      expect(await as(plntViewer, (tx) => tx.select().from(forms))).toHaveLength(0);
      await rejects(
        as(plsrViewer, (tx) => tx.insert(forms).values({ kind: "holdings", personId: lid.plsrSoldier, data: formData })),
      );
      await rejects(as(su, (tx) => tx.update(forms).set({ kind: "holdings" }).where(eq(forms.id, f!.id))));
    });

    it("events: admins append with their own id; viewers cannot write; nobody deletes", async () => {
      const [e] = await as(plsrAdmin, (tx) =>
        tx.insert(events).values({ kind: "sign", personId: lid.plsrSoldier, personName: "חייל מחלקה 1" }).returning(),
      );
      expect(e!.actorUserId).toBe(plsrAdmin.appId);
      const [named] = await as(plsrAdmin, (tx) =>
        tx.insert(events).values({ kind: "notes", personId: lid.plsrSoldier, actorName: "מישהו אחר" }).returning(),
      );
      expect(named!.actorName).toBe(plsrAdmin.email);
      await rejects(as(plsrAdmin, (tx) => tx.insert(events).values({ kind: "sign", actorUserId: logAdmin.appId! })));
      // stock events (no soldier) are battalion-wide: company admins can't write them
      await rejects(as(plsrAdmin, (tx) => tx.insert(events).values({ kind: "serial_remove", item: "M4 קצר" })));
      await rejects(as(plsrAdmin, (tx) => tx.insert(events).values({ kind: "sign", personId: lid.plntSoldier })));
      await rejects(as(plsrViewer, (tx) => tx.insert(events).values({ kind: "kit" })));
      await rejects(as(su, (tx) => tx.delete(events).where(eq(events.id, e!.id))));
    });

    it("events about soldiers are scoped; stock events are visible to all members", async () => {
      await as(logAdmin, (tx) => tx.insert(events).values({ kind: "serials_add", item: "M4 קצר" }));
      const plnt = await as(plntViewer, (tx) => tx.select().from(events));
      expect(plnt.map((e) => e.kind)).toEqual(["serials_add"]);
      const plsr = await as(plsrViewer, (tx) => tx.select().from(events));
      expect(plsr.map((e) => e.kind).sort()).toEqual(["notes", "serials_add", "sign"]);
      expect(await as(clerk, (tx) => tx.select().from(events))).toHaveLength(0);
    });
  });

  describe("people (אלפון)", () => {
    it("a logistics admin adds and edits soldiers in their unit only", async () => {
      const [p] = await as(plsrAdmin, (tx) =>
        tx.insert(people).values({ unitId: ids.plsr1, fullName: "חייל חדש מלוגיסטיקה" }).returning(),
      );
      expect(p).toBeTruthy();
      await rejects(as(plsrAdmin, (tx) => tx.insert(people).values({ unitId: ids.plnt, fullName: "x" })));
      const r = await as(plsrAdmin, (tx) =>
        tx.update(people).set({ phone: "050" }).where(eq(people.id, lid.plntSoldier)).returning(),
      );
      expect(r).toHaveLength(0);
    });

    it("a logistics viewer cannot edit soldiers, and a logistics admin cannot delete them", async () => {
      const r = await as(plsrViewer, (tx) =>
        tx.update(people).set({ phone: "050" }).where(eq(people.id, lid.plsrSoldier)).returning(),
      );
      expect(r).toHaveLength(0);
      const d = await as(plsrAdmin, (tx) => tx.delete(people).where(eq(people.id, lid.plsrSoldier)).returning());
      expect(d).toHaveLength(0);
    });
  });

  it("logistics changes are audited with the acting user", async () => {
    const rows = await db.select().from(auditLog).where(eq(auditLog.tableName, "logistics_assignments"));
    expect(rows.some((r) => r.actorUserId === plsrAdmin.appId)).toBe(true);
  });
});

describe("doch1", () => {
  const {
    doch1Rounds: rounds,
    doch1Statuses: statuses,
    doch1Members: members,
    doch1Days: days,
    doch1PushSubscriptions: pushSubs,
    doch1RoundCompanies: roundCompanies,
    doch1ReminderRequests: reminderRequests,
    doch1BrigadeLog: brigadeLog,
  } = schema;

  const d1Admin: TestUser = { authId: randomUUID(), email: "d1-admin@example.com" };
  const plsrClerk: TestUser = { authId: randomUUID(), email: "d1-plsr-clerk@example.com" };
  const plsr1Cmdr: TestUser = { authId: randomUUID(), email: "d1-plsr1-mm@example.com" };
  const plntClerk: TestUser = { authId: randomUUID(), email: "d1-plnt-clerk@example.com" };
  const d1Viewer: TestUser = { authId: randomUUID(), email: "d1-viewer@example.com" };
  const doch1Users = [d1Admin, plsrClerk, plsr1Cmdr, plntClerk, d1Viewer];

  const today = israelToday(new Date());
  let roundId = "";
  const st = { A: "", Z: "" };
  const p = { plsrSoldier: "", plsr1Soldier: "", plntSoldier: "" };

  /** First SQLSTATE found on the error or its causes (same walk as pgCode in apps/web/src/lib/action-result.ts). */
  const pgCodeOf = (err: unknown): string | undefined => {
    let e: unknown = err;
    for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string") return code;
      e = (e as { cause?: unknown }).cause;
    }
    return undefined;
  };

  const setDay = (u: TestUser, personId: string, day: string, statusId: string) =>
    as(u, (tx) =>
      tx
        .insert(days)
        .values({ roundId, personId, day, statusId })
        .onConflictDoUpdate({ target: [days.personId, days.day], set: { statusId } }),
    );

  beforeAll(async () => {
    const rows = await db
      .insert(appUsers)
      .values(doch1Users.map((u) => ({ email: u.email, authUserId: u.authId })))
      .returning();
    for (const u of doch1Users) u.appId = rows.find((r) => r.email === u.email)!.id;
    await db.insert(memberships).values([
      { userId: d1Admin.appId!, module: "doch1", role: "admin", unitId: null },
      { userId: plsrClerk.appId!, module: "doch1", role: "company_user", unitId: ids.plsr },
      { userId: plsr1Cmdr.appId!, module: "doch1", role: "platoon_commander", unitId: ids.plsr1 },
      { userId: plntClerk.appId!, module: "doch1", role: "company_user", unitId: ids.plnt },
      { userId: d1Viewer.appId!, module: "doch1", role: "viewer", unitId: null },
    ]);

    const [round] = await db
      .insert(rounds)
      .values({ name: "סבב בדיקה", startsOn: addDays(today, -30), endsOn: addDays(today, 30), lockAt: "23:59:59", state: "active" })
      .returning();
    roundId = round!.id;
    await db.insert(roundCompanies).values([
      { roundId, unitId: ids.plsr },
      { roundId, unitId: ids.plnt },
    ]);
    const ss = await db
      .insert(statuses)
      .values([
        { roundId, name: "א", color: "#e07b2e", displayGroup: "א", sheetValue: "א", countsInSadak: true },
        { roundId, name: "ז", color: "#7a8699", displayGroup: "ז", sheetValue: "0", offDuty: true },
      ])
      .returning();
    st.A = ss[0]!.id;
    st.Z = ss[1]!.id;
    const ppl = await db.select().from(people);
    p.plsrSoldier = ppl.find((x) => x.fullName === "חייל פלסר")!.id;
    p.plsr1Soldier = ppl.find((x) => x.fullName === "חייל מחלקה 1")!.id;
    p.plntSoldier = ppl.find((x) => x.fullName === "חייל פלנט")!.id;
    await db.insert(members).values(Object.values(p).map((personId) => ({ roundId, personId })));
  });

  it("platoon commander writes only their platoon", async () => {
    await setDay(plsr1Cmdr, p.plsr1Soldier, today, st.A);
    await rejects(setDay(plsr1Cmdr, p.plsrSoldier, today, st.A)); // company level, outside the platoon
  });

  it("platoon commander reads only their platoon's days and members", async () => {
    await setDay(plsrClerk, p.plsrSoldier, today, st.A);
    const seen = await as(plsr1Cmdr, (tx) => tx.select().from(days));
    expect(seen.map((r) => r.personId)).toEqual([p.plsr1Soldier]);
    expect((await as(plsr1Cmdr, (tx) => tx.select().from(members))).map((m) => m.personId)).toEqual([p.plsr1Soldier]);
  });

  it("company user covers the company's platoons, not another company", async () => {
    await setDay(plsrClerk, p.plsr1Soldier, today, st.Z);
    await rejects(setDay(plsrClerk, p.plntSoldier, today, st.A));
    expect(await as(plntClerk, (tx) => tx.select().from(days).where(eq(days.personId, p.plsr1Soldier)))).toHaveLength(0);
  });

  it("two saves of the same soldier and day: last one wins", async () => {
    await setDay(plsr1Cmdr, p.plsr1Soldier, today, st.A);
    await setDay(plsrClerk, p.plsr1Soldier, today, st.Z);
    const [row] = await db.select().from(days).where(and(eq(days.personId, p.plsr1Soldier), eq(days.day, today)));
    expect(row!.statusId).toBe(st.Z);
    expect(row!.updatedBy).toBe(plsrClerk.appId);
  });

  it("updated_by is always the acting user", async () => {
    await as(plsrClerk, (tx) =>
      tx
        .update(days)
        .set({ statusId: st.A, updatedBy: d1Admin.appId! })
        .where(and(eq(days.personId, p.plsr1Soldier), eq(days.day, today))),
    );
    const [row] = await db.select().from(days).where(and(eq(days.personId, p.plsr1Soldier), eq(days.day, today)));
    expect(row!.updatedBy).toBe(plsrClerk.appId);
  });

  it("after the lock only the battalion admin can change today", async () => {
    await db.update(rounds).set({ lockAt: "00:00:00" }).where(eq(rounds.id, roundId));
    expect(await setDay(plsrClerk, p.plsr1Soldier, today, st.A).then(() => "ok", pgCodeOf)).toBe("GD001");
    const del = as(plsrClerk, (tx) => tx.delete(days).where(and(eq(days.personId, p.plsr1Soldier), eq(days.day, today))));
    expect(await del.then(() => "ok", pgCodeOf)).toBe("GD001");
    await setDay(d1Admin, p.plsr1Soldier, today, st.A);
    await setDay(plsrClerk, p.plsr1Soldier, addDays(today, 1), st.A); // tomorrow stays open
    await db.update(rounds).set({ lockAt: "23:59:59" }).where(eq(rounds.id, roundId));
  });

  it("past days are admin-only; days outside the round are rejected", async () => {
    expect(await setDay(plsrClerk, p.plsr1Soldier, addDays(today, -1), st.A).then(() => "ok", pgCodeOf)).toBe("GD001");
    await setDay(d1Admin, p.plsr1Soldier, addDays(today, -1), st.A);
    expect(await setDay(d1Admin, p.plsr1Soldier, addDays(today, 31), st.A).then(() => "ok", pgCodeOf)).toBe("GD002");
  });

  it("a day cannot point at another round's status", async () => {
    const [other] = await db.insert(rounds).values({ name: "סבב אחר", startsOn: today, endsOn: today }).returning();
    const [foreign] = await db
      .insert(statuses)
      .values({ roundId: other!.id, name: "א", color: "#000000", displayGroup: "א", sheetValue: "א" })
      .returning();
    await rejects(setDay(d1Admin, p.plsr1Soldier, addDays(today, 2), foreign!.id));
  });

  it("viewer reads but cannot write", async () => {
    expect((await as(d1Viewer, (tx) => tx.select().from(days))).length).toBeGreaterThan(0);
    await rejects(setDay(d1Viewer, p.plsr1Soldier, addDays(today, 1), st.A));
  });

  it("users without a doch1 membership see nothing", async () => {
    expect(await as(stranger, (tx) => tx.select().from(days))).toHaveLength(0);
    expect(await as(coreAdmin, (tx) => tx.select().from(statuses))).toHaveLength(0);
  });

  it("only battalion admins change settings", async () => {
    expect(await as(plsrClerk, (tx) => tx.update(statuses).set({ color: "#000000" }).where(eq(statuses.id, st.A)).returning())).toHaveLength(0);
    expect(await as(d1Admin, (tx) => tx.update(statuses).set({ color: "#000000" }).where(eq(statuses.id, st.A)).returning())).toHaveLength(1);
    await rejects(as(plsrClerk, (tx) => tx.insert(rounds).values({ name: "x", startsOn: today, endsOn: today })));
    const rc = await as(plsrClerk, (tx) =>
      tx.update(roundCompanies).set({ appFrom: today }).where(eq(roundCompanies.unitId, ids.plsr)).returning(),
    );
    expect(rc).toHaveLength(0);
  });

  it("company users update member fields in their company; only admins add or remove members", async () => {
    const ok = await as(plsrClerk, (tx) =>
      tx.update(members).set({ notes: "הערה" }).where(eq(members.personId, p.plsr1Soldier)).returning(),
    );
    expect(ok).toHaveLength(1);
    const other = await as(plsrClerk, (tx) =>
      tx.update(members).set({ notes: "x" }).where(eq(members.personId, p.plntSoldier)).returning(),
    );
    expect(other).toHaveLength(0);
    const cmdr = await as(plsr1Cmdr, (tx) =>
      tx.update(members).set({ notes: "x" }).where(eq(members.personId, p.plsr1Soldier)).returning(),
    );
    expect(cmdr).toHaveLength(0);
    expect(await as(plsrClerk, (tx) => tx.delete(members).where(eq(members.personId, p.plsr1Soldier)).returning())).toHaveLength(0);
  });

  it("a company user takes a soldier out of the report (released / deferred); a platoon commander cannot", async () => {
    const set = (u: TestUser, inReport: boolean) =>
      as(u, (tx) => tx.update(members).set({ inReport }).where(eq(members.personId, p.plsr1Soldier)).returning());
    expect(await set(plsr1Cmdr, false)).toHaveLength(0);
    expect(await set(plsrClerk, false)).toHaveLength(1);
    expect(await set(plsrClerk, true)).toHaveLength(1);
    expect(await as(plntClerk, (tx) => tx.update(members).set({ inReport: false }).where(eq(members.personId, p.plsrSoldier)).returning())).toHaveLength(0);
  });

  it("a company user sets call-up and release dates; a platoon commander cannot; release before call-up is rejected", async () => {
    const set = (u: TestUser, v: { callUpOn: string | null; releasedOn: string | null }, personId = p.plsr1Soldier) =>
      as(u, (tx) => tx.update(members).set(v).where(eq(members.personId, personId)).returning());
    expect(await set(plsr1Cmdr, { callUpOn: "2026-09-06", releasedOn: null })).toHaveLength(0);
    expect(await set(plntClerk, { callUpOn: "2026-09-06", releasedOn: null })).toHaveLength(0);
    expect(await set(plsrClerk, { callUpOn: "2026-09-06", releasedOn: "2026-10-01" })).toHaveLength(1);
    await rejects(set(plsrClerk, { callUpOn: "2026-09-06", releasedOn: "2026-09-01" }));
    expect(await set(plsrClerk, { callUpOn: null, releasedOn: null })).toHaveLength(1);
  });

  it("push subscriptions are private to their owner", async () => {
    await as(plsrClerk, (tx) => tx.insert(pushSubs).values({ endpoint: "https://push.example/1", p256dh: "k", auth: "a" }));
    expect(await as(plntClerk, (tx) => tx.select().from(pushSubs))).toHaveLength(0);
    expect(await as(plsrClerk, (tx) => tx.select().from(pushSubs))).toHaveLength(1);
    await rejects(
      as(plntClerk, (tx) =>
        tx.insert(pushSubs).values({ userId: plsrClerk.appId!, endpoint: "https://push.example/2", p256dh: "k", auth: "a" }),
      ),
    );
    await rejects(as(plsrClerk, (tx) => tx.insert(pushSubs).values({ endpoint: "http://push.example/3", p256dh: "k", auth: "a" })));
    expect(await as(plntClerk, (tx) => tx.delete(pushSubs).returning())).toHaveLength(0);
  });

  it("reminder requests and brigade log: battalion admin, in their own name", async () => {
    await as(d1Admin, (tx) => tx.insert(reminderRequests).values({ roundId, unitId: ids.plsr }));
    await rejects(as(plsrClerk, (tx) => tx.insert(reminderRequests).values({ roundId, unitId: ids.plsr })));
    await rejects(
      as(d1Admin, (tx) => tx.insert(brigadeLog).values({ roundId, day: today, partial: false, content: "x", sentBy: plsrClerk.appId! })),
    );
    const [log] = await as(d1Admin, (tx) => tx.insert(brigadeLog).values({ roundId, day: today, partial: true, content: "x" }).returning());
    expect(log!.sentBy).toBe(d1Admin.appId);
    expect(await as(plsrClerk, (tx) => tx.select().from(brigadeLog))).toHaveLength(0);
  });

  it("doch1 company user can edit their soldiers in people; not another company's", async () => {
    const ok = await as(plsrClerk, (tx) =>
      tx.update(people).set({ phone: "0500000000" }).where(eq(people.id, p.plsr1Soldier)).returning(),
    );
    expect(ok).toHaveLength(1);
    const other = await as(plsrClerk, (tx) =>
      tx.update(people).set({ phone: "0500000000" }).where(eq(people.id, p.plntSoldier)).returning(),
    );
    expect(other).toHaveLength(0);
    const cmdr = await as(plsr1Cmdr, (tx) =>
      tx.update(people).set({ phone: "0500000001" }).where(eq(people.id, p.plsr1Soldier)).returning(),
    );
    expect(cmdr).toHaveLength(0);
  });

  it("writes are audited with the acting user", async () => {
    const rows = await db.select().from(auditLog).where(eq(auditLog.tableName, "doch1_days"));
    expect(rows.some((r) => r.actorUserId === plsrClerk.appId)).toBe(true);
  });

  it("change log (doch1_person_log): one soldier the user sees, this round only; audit_log itself stays closed", async () => {
    const log = (u: TestUser, personId: string, round = roundId) =>
      as(u, async (tx) => {
        const r = await tx.execute<{ actor: string | null; table_name: string; before: unknown; after: unknown }>(
          sql`select * from app.doch1_person_log(${round}::uuid, ${personId}::uuid, 50)`,
        );
        return Array.isArray(r) ? r : ((r as { rows: unknown[] }).rows as typeof r);
      });
    const clerkView = await log(plsrClerk, p.plsr1Soldier);
    expect(clerkView.some((r) => r.table_name === "doch1_days" && r.actor === "d1-plsr-clerk@example.com")).toBe(true);
    expect(clerkView.some((r) => r.table_name === "people")).toBe(true); // the phone change above
    expect((await log(plsr1Cmdr, p.plsr1Soldier)).length).toBeGreaterThan(0);
    expect(await log(plsr1Cmdr, p.plsrSoldier)).toHaveLength(0); // company level, outside the platoon
    expect(await log(plntClerk, p.plsr1Soldier)).toHaveLength(0);
    expect(await log(stranger, p.plsr1Soldier)).toHaveLength(0);
    expect(await log(coreAdmin, p.plsr1Soldier)).toHaveLength(0); // core admin without doch1
    expect((await log(plsrClerk, p.plsr1Soldier, randomUUID())).every((r) => r.table_name === "people")).toBe(true);
    expect(await as(plsrClerk, (tx) => tx.select().from(auditLog))).toHaveLength(0);
  });
  describe("doch1 standby", () => {
    const {
      doch1Locations: locations,
      doch1StandbyTypes: types,
      doch1StandbyTeams: teams,
      doch1StandbyHolders: holders,
      doch1StandbyMembers: teamMembers,
      doch1Vehicles: vehicles,
    } = schema;
    const t = { plsrTeam: "", sharedTeam: "" };
    let outpost = "";
    let vehicleId = "";

    /** A team created the way the app does it: the team row, then its holding company. */
    const createTeam = (u: TestUser, name: string, unitId: string) =>
      as(u, async (tx) => {
        const [team] = await tx.insert(teams).values({ roundId, name }).returning();
        await tx.insert(holders).values({ teamId: team!.id, unitId });
        return team!.id;
      });

    beforeAll(async () => {
      const [loc] = await db.insert(locations).values({ roundId, name: "מוצב 1", kind: "outpost" }).returning();
      outpost = loc!.id;
      const [v] = await db.insert(vehicles).values({ number: "700100" }).returning();
      vehicleId = v!.id;
      // a battalion team held by both companies
      const [shared] = await db.insert(teams).values({ roundId, name: "פינוי א" }).returning();
      t.sharedTeam = shared!.id;
      await db.insert(holders).values([
        { teamId: t.sharedTeam, unitId: ids.plsr },
        { teamId: t.sharedTeam, unitId: ids.plnt },
      ]);
    });

    it("only battalion admins manage locations and standby types; every doch1 user reads them", async () => {
      await rejects(as(plsrClerk, (tx) => tx.insert(locations).values({ roundId, name: "מוצב 2", kind: "outpost" })));
      await rejects(as(plsrClerk, (tx) => tx.insert(types).values({ roundId, name: "חפ״ק" })));
      await as(d1Admin, (tx) => tx.insert(types).values({ roundId, name: "חפ״ק", size: 3, requiredRoles: ["קשר"] }));
      expect(await as(plsr1Cmdr, (tx) => tx.select().from(types))).toHaveLength(1);
      expect(await as(stranger, (tx) => tx.select().from(locations))).toHaveLength(0);
    });

    it("a company user creates a team for their own company and edits it", async () => {
      t.plsrTeam = await createTeam(plsrClerk, "חפ״ק", ids.plsr);
      const upd = await as(plsrClerk, (tx) =>
        tx.update(teams).set({ locationId: outpost, vehicleId }).where(eq(teams.id, t.plsrTeam)).returning(),
      );
      expect(upd).toHaveLength(1);
      expect(await as(plntClerk, (tx) => tx.update(teams).set({ name: "x" }).where(eq(teams.id, t.plsrTeam)).returning())).toHaveLength(0);
      expect(await as(plsr1Cmdr, (tx) => tx.update(teams).set({ name: "x" }).where(eq(teams.id, t.plsrTeam)).returning())).toHaveLength(0);
      await rejects(createTeam(plsr1Cmdr, "x", ids.plsr1));
      await rejects(createTeam(d1Viewer, "x", ids.plsr));
    });

    it("a company user cannot make their company a holder of someone else's team", async () => {
      await rejects(as(plntClerk, (tx) => tx.insert(holders).values({ teamId: t.plsrTeam, unitId: ids.plnt })));
      // nor create a team in another company's name
      await rejects(createTeam(plntClerk, "x", ids.plsr));
      await as(d1Admin, (tx) => tx.insert(holders).values({ teamId: t.plsrTeam, unitId: ids.plnt }));
      expect(await as(plntClerk, (tx) => tx.update(teams).set({ sortOrder: 1 }).where(eq(teams.id, t.plsrTeam)).returning())).toHaveLength(1);
      await db.delete(holders).where(and(eq(holders.teamId, t.plsrTeam), eq(holders.unitId, ids.plnt)));
    });

    it("team members: editors add soldiers they cover; one team per soldier per round", async () => {
      await as(plsrClerk, (tx) => tx.insert(teamMembers).values({ roundId, teamId: t.plsrTeam, personId: p.plsr1Soldier, role: "קשר" }));
      // another company's soldier, even on a team the clerk edits
      await rejects(as(plsrClerk, (tx) => tx.insert(teamMembers).values({ roundId, teamId: t.sharedTeam, personId: p.plntSoldier })));
      // a soldier is on one team at most
      await rejects(as(d1Admin, (tx) => tx.insert(teamMembers).values({ roundId, teamId: t.sharedTeam, personId: p.plsr1Soldier })));
      // not an editor of the team
      await rejects(as(plntClerk, (tx) => tx.insert(teamMembers).values({ roundId, teamId: t.plsrTeam, personId: p.plntSoldier })));
      await as(plntClerk, (tx) => tx.insert(teamMembers).values({ roundId, teamId: t.sharedTeam, personId: p.plntSoldier }));
      expect(
        await as(plntClerk, (tx) => tx.update(teamMembers).set({ role: "x" }).where(eq(teamMembers.teamId, t.plsrTeam)).returning()),
      ).toHaveLength(0);
      expect(await as(plsr1Cmdr, (tx) => tx.delete(teamMembers).where(eq(teamMembers.teamId, t.plsrTeam)).returning())).toHaveLength(0);
    });

    it("team members are read by their unit's users and by the team's editors", async () => {
      const cmdr = await as(plsr1Cmdr, (tx) => tx.select().from(teamMembers));
      expect(cmdr.map((m) => m.personId)).toEqual([p.plsr1Soldier]);
      // the plsr clerk edits the shared team, so they see its plnt soldier too
      const clerk = await as(plsrClerk, (tx) => tx.select().from(teamMembers));
      expect(clerk.map((m) => m.personId).sort()).toEqual([p.plsr1Soldier, p.plntSoldier].sort());
      expect(await as(stranger, (tx) => tx.select().from(teamMembers))).toHaveLength(0);
    });

    it("vehicles: a team's editors change its vehicle's state; others cannot", async () => {
      expect(await as(plsrClerk, (tx) => tx.update(vehicles).set({ state: "service" }).where(eq(vehicles.id, vehicleId)).returning())).toHaveLength(1);
      expect(await as(plntClerk, (tx) => tx.update(vehicles).set({ state: "broken" }).where(eq(vehicles.id, vehicleId)).returning())).toHaveLength(0);
      await as(plntClerk, (tx) => tx.insert(vehicles).values({ number: "700200" }));
      await rejects(as(plsr1Cmdr, (tx) => tx.insert(vehicles).values({ number: "700300" })));
      expect(await as(plsrClerk, (tx) => tx.delete(vehicles).where(eq(vehicles.id, vehicleId)).returning())).toHaveLength(0);
      await rejects(as(d1Admin, (tx) => tx.insert(vehicles).values({ number: "70 01" })));
    });

    it("soldier location: company users set it in their company; it must be a location of the same round", async () => {
      const set = (u: TestUser, personId: string, locationId: string | null) =>
        as(u, (tx) => tx.update(members).set({ locationId }).where(eq(members.personId, personId)).returning());
      expect(await set(plsrClerk, p.plsr1Soldier, outpost)).toHaveLength(1);
      expect(await set(plsrClerk, p.plntSoldier, outpost)).toHaveLength(0);
      expect(await set(plsr1Cmdr, p.plsr1Soldier, null)).toHaveLength(0);
      const [other] = await db.insert(rounds).values({ name: "סבב ישן", startsOn: today, endsOn: today }).returning();
      const [foreign] = await db.insert(locations).values({ roundId: other!.id, name: "מוצב 1", kind: "outpost" }).returning();
      await rejects(set(d1Admin, p.plsr1Soldier, foreign!.id));
      await rejects(as(d1Admin, (tx) => tx.update(teams).set({ locationId: foreign!.id }).where(eq(teams.id, t.plsrTeam))));
    });

    it("a holder removing itself leaves the team to the admin; deleting a team is for its editors", async () => {
      expect(await as(plntClerk, (tx) => tx.delete(teams).where(eq(teams.id, t.plsrTeam)).returning())).toHaveLength(0);
      expect(await as(plsrClerk, (tx) => tx.delete(teams).where(eq(teams.id, t.plsrTeam)).returning())).toHaveLength(1);
      // the team's members went with it
      expect(await db.select().from(teamMembers).where(eq(teamMembers.teamId, t.plsrTeam))).toHaveLength(0);
    });

    it("standby writes are audited", async () => {
      const rows = await db.select().from(auditLog).where(eq(auditLog.tableName, "doch1_standby_members"));
      expect(rows.some((r) => r.actorUserId === plsrClerk.appId)).toBe(true);
    });
  });

  describe("doch1 round planning", () => {
    const { doch1FieldOptions: options } = schema;
    const opt = { arriving: "", notArriving: "", arrived: "" };

    const setMember = (u: TestUser, personId: string, v: Partial<typeof members.$inferInsert>) =>
      as(u, (tx) =>
        tx
          .update(members)
          .set(v)
          .where(and(eq(members.roundId, roundId), eq(members.personId, personId)))
          .returning(),
      );

    beforeAll(async () => {
      const rows = await as(d1Admin, (tx) =>
        tx
          .insert(options)
          .values([
            { roundId, field: "arrival", name: "מגיע", effect: "arriving" },
            { roundId, field: "arrival", name: "לא מגיע", effect: "not_arriving", sortOrder: 1 },
            { roundId, field: "enlistment", name: "התייצב", effect: "arrived" },
          ])
          .returning(),
      );
      opt.arriving = rows[0]!.id;
      opt.notArriving = rows[1]!.id;
      opt.arrived = rows[2]!.id;
    });

    it("value lists: everyone in doch1 reads them, only the battalion admin writes", async () => {
      expect(await as(plsrClerk, (tx) => tx.select().from(options))).toHaveLength(3);
      expect(await as(stranger, (tx) => tx.select().from(options))).toHaveLength(0);
      await rejects(as(plsrClerk, (tx) => tx.insert(options).values({ roundId, field: "arrival", name: "x", effect: "arriving" })));
      expect(await as(plsrClerk, (tx) => tx.update(options).set({ name: "y" }).where(eq(options.id, opt.arriving)).returning())).toHaveLength(0);
      expect(await as(plsrClerk, (tx) => tx.delete(options).where(eq(options.id, opt.arriving)).returning())).toHaveLength(0);
      // an effect of the other list
      await rejects(as(d1Admin, (tx) => tx.insert(options).values({ roundId, field: "arrival", name: "z", effect: "arrived" })));
      // the same name twice in one list
      await rejects(as(d1Admin, (tx) => tx.insert(options).values({ roundId, field: "arrival", name: "מגיע", effect: "arriving" })));
      const audit = await db.select().from(auditLog).where(eq(auditLog.tableName, "doch1_field_options"));
      expect(audit.some((r) => r.actorUserId === d1Admin.appId)).toBe(true);
    });

    it("a company user sets צפי הגעה and סטטוס גיוס for their own soldiers only", async () => {
      expect(await setMember(plsrClerk, p.plsr1Soldier, { arrivalOptionId: opt.notArriving })).toHaveLength(1);
      expect(await setMember(plsrClerk, p.plsr1Soldier, { enlistmentOptionId: opt.arrived })).toHaveLength(1);
      expect(await setMember(plntClerk, p.plsr1Soldier, { arrivalOptionId: opt.arriving })).toHaveLength(0);
      expect(await setMember(plsr1Cmdr, p.plsr1Soldier, { arrivalOptionId: opt.arriving })).toHaveLength(0);
      expect(await setMember(d1Viewer, p.plsr1Soldier, { arrivalOptionId: opt.arriving })).toHaveLength(0);
      expect(await setMember(plsrClerk, p.plsr1Soldier, { arrivalOptionId: null })).toHaveLength(1);
    });

    it("a value of the other list or of another round is rejected", async () => {
      const wrongList = setMember(d1Admin, p.plsr1Soldier, { arrivalOptionId: opt.arrived });
      expect(await wrongList.then(() => "ok", pgCodeOf)).toBe("GD003");
      const [other] = await db.insert(rounds).values({ name: "סבב אחר לצפי", startsOn: today, endsOn: today }).returning();
      const [foreign] = await db.insert(options).values({ roundId: other!.id, field: "arrival", name: "מגיע", effect: "arriving" }).returning();
      await rejects(setMember(d1Admin, p.plsr1Soldier, { arrivalOptionId: foreign!.id }));
    });

    it("deleting a value in use leaves the soldier's field blank", async () => {
      const [tmp] = await as(d1Admin, (tx) =>
        tx.insert(options).values({ roundId, field: "arrival", name: "זמני", effect: "arriving" }).returning(),
      );
      await setMember(plsrClerk, p.plsr1Soldier, { arrivalOptionId: tmp!.id });
      await as(d1Admin, (tx) => tx.delete(options).where(eq(options.id, tmp!.id)));
      const [m] = await db.select().from(members).where(and(eq(members.roundId, roundId), eq(members.personId, p.plsr1Soldier)));
      expect(m!.arrivalOptionId).toBeNull();
      expect(m!.roundId).toBe(roundId);
    });

    it("a pending company move is set by the battalion admin only", async () => {
      const byClerk = setMember(plsrClerk, p.plsr1Soldier, { plannedUnitId: ids.plnt });
      expect(await byClerk.then(() => "ok", pgCodeOf)).toBe("GD004");
      expect(await setMember(d1Admin, p.plsr1Soldier, { plannedUnitId: ids.plnt })).toHaveLength(1);
      // the clerk can still edit other fields of a soldier with a pending move
      expect(await setMember(plsrClerk, p.plsr1Soldier, { notes: "עובר" })).toHaveLength(1);
      expect(await setMember(d1Admin, p.plsr1Soldier, { plannedUnitId: null })).toHaveLength(1);
    });

    it("round state: one active and one planning at most; `active` follows the state and can't be written", async () => {
      const [main] = await db.select().from(rounds).where(eq(rounds.id, roundId));
      expect(main!.active).toBe(true);
      const [planning] = await as(d1Admin, (tx) =>
        tx.insert(rounds).values({ name: "סבב הבא", startsOn: today, endsOn: today, state: "planning" }).returning(),
      );
      expect(planning!.active).toBe(false);
      await rejects(as(d1Admin, (tx) => tx.insert(rounds).values({ name: "סבב נוסף", startsOn: today, endsOn: today, state: "planning" })));
      await rejects(as(d1Admin, (tx) => tx.insert(rounds).values({ name: "סבב פעיל", startsOn: today, endsOn: today, state: "active" })));
      await rejects(as(d1Admin, (tx) => tx.execute(sql`update public.doch1_rounds set active = true where id = ${planning!.id}::uuid`)));
      await rejects(as(d1Admin, (tx) => tx.update(rounds).set({ state: "draft" as never }).where(eq(rounds.id, planning!.id))));
      expect(await as(plsrClerk, (tx) => tx.update(rounds).set({ state: "active" }).where(eq(rounds.id, planning!.id)).returning())).toHaveLength(0);
      await db.delete(rounds).where(eq(rounds.id, planning!.id));
    });

    it("reminder requests carry a kind", async () => {
      await as(d1Admin, (tx) => tx.insert(reminderRequests).values({ roundId, unitId: ids.plsr, kind: "arrival" }));
      await rejects(as(d1Admin, (tx) => tx.insert(reminderRequests).values({ roundId, unitId: ids.plsr, kind: "x" as never })));
    });
  });

  describe("doch1 reports", () => {
    const { doch1DmhCategories: categories, doch1ReportGroups: groups, doch1Locations: locations } = schema;
    let camp = "";

    beforeAll(async () => {
      const [loc] = await db.insert(locations).values({ roundId, name: "מחנה", kind: "camp" }).returning();
      camp = loc!.id;
    });

    it("only battalion admins manage the דמ״ח categories and the 10א groups; every doch1 user reads them", async () => {
      for (const u of [plsrClerk, plsr1Cmdr, d1Viewer]) {
        await rejects(as(u, (tx) => tx.insert(categories).values({ roundId, name: "לוחם" })));
        await rejects(as(u, (tx) => tx.insert(groups).values({ roundId, name: "מכלול", unitIds: [ids.plsr1] })));
      }
      const [cat] = await as(d1Admin, (tx) => tx.insert(categories).values({ roundId, name: "מט״ב", listed: true }).returning());
      const [grp] = await as(d1Admin, (tx) => tx.insert(groups).values({ roundId, name: "מכלול", commander: "סמג״ד", unitIds: [ids.plsr1] }).returning());
      expect(await as(plsr1Cmdr, (tx) => tx.select().from(categories))).toHaveLength(1);
      expect(await as(d1Viewer, (tx) => tx.select().from(groups))).toHaveLength(1);
      expect(await as(stranger, (tx) => tx.select().from(categories))).toHaveLength(0);
      expect(await as(stranger, (tx) => tx.select().from(groups))).toHaveLength(0);
      expect(await as(plsrClerk, (tx) => tx.update(categories).set({ listed: false }).where(eq(categories.id, cat!.id)).returning())).toHaveLength(0);
      expect(await as(plsrClerk, (tx) => tx.delete(groups).where(eq(groups.id, grp!.id)).returning())).toHaveLength(0);
      expect(await as(d1Admin, (tx) => tx.update(groups).set({ unitIds: [ids.plsr] }).where(eq(groups.id, grp!.id)).returning())).toHaveLength(1);
    });

    it("a status's camp: set by the admin, a location of the same round", async () => {
      expect(await as(plsrClerk, (tx) => tx.update(statuses).set({ locationId: camp }).where(eq(statuses.id, st.A)).returning())).toHaveLength(0);
      expect(await as(d1Admin, (tx) => tx.update(statuses).set({ locationId: camp }).where(eq(statuses.id, st.A)).returning())).toHaveLength(1);
      const [other] = await db.insert(rounds).values({ name: "סבב אחר", startsOn: today, endsOn: today }).returning();
      const [foreign] = await db.insert(locations).values({ roundId: other!.id, name: "מחנה", kind: "camp" }).returning();
      await rejects(as(d1Admin, (tx) => tx.update(statuses).set({ locationId: foreign!.id }).where(eq(statuses.id, st.A))));
      await as(d1Admin, (tx) => tx.update(statuses).set({ locationId: null }).where(eq(statuses.id, st.A)));
    });

    it("report settings writes are audited", async () => {
      for (const table of ["doch1_dmh_categories", "doch1_report_groups"]) {
        const rows = await db.select().from(auditLog).where(eq(auditLog.tableName, table));
        expect(rows.some((r) => r.actorUserId === d1Admin.appId)).toBe(true);
      }
    });
  });
});

describe("department master admins", () => {
  const logMaster: TestUser = { authId: randomUUID(), email: "log-master@example.com" };
  const plsrMaster: TestUser = { authId: randomUUID(), email: "plsr-master@example.com" };
  const logPlain: TestUser = { authId: randomUUID(), email: "log-plain-admin@example.com" };
  const target: TestUser = { authId: randomUUID(), email: "target@example.com" };
  const users = [logMaster, plsrMaster, logPlain, target];
  const { logisticsItems: items } = schema;

  beforeAll(async () => {
    const rows = await db
      .insert(appUsers)
      .values(users.map((u) => ({ email: u.email, authUserId: u.authId })))
      .returning();
    for (const u of users) u.appId = rows.find((r) => r.email === u.email)!.id;
    await db.insert(memberships).values([
      { userId: logMaster.appId!, module: "logistics", role: "master_admin", unitId: null },
      { userId: plsrMaster.appId!, module: "logistics", role: "master_admin", unitId: ids.plsr },
      { userId: logPlain.appId!, module: "logistics", role: "admin", unitId: null },
    ]);
  });

  const grant = (u: TestUser, module: "logistics" | "doch1" | "core", role: string, unitId: string | null) =>
    as(u, (tx) => tx.insert(memberships).values({ userId: target.appId!, module, role, unitId }).returning());

  it("a master admin has every admin right in the department", async () => {
    const [it] = await as(logMaster, (tx) => tx.insert(items).values({ name: "פריט מנהל ראשי", category: "כללי" }).returning());
    expect(it).toBeDefined();
    await db.delete(items).where(eq(items.id, it!.id));
  });

  it("sees the invited users (to pick from), a plain admin doesn't", async () => {
    expect((await as(logMaster, (tx) => tx.select().from(appUsers))).length).toBeGreaterThan(4);
    expect(await as(logPlain, (tx) => tx.select().from(appUsers))).toHaveLength(1);
  });

  it("grants and removes roles in their own department only", async () => {
    expect(await grant(logMaster, "logistics", "company_user", ids.plnt)).toHaveLength(1);
    await rejects(grant(logMaster, "doch1", "admin", null));
    await rejects(grant(logMaster, "core", "admin", null));
    await rejects(grant(logPlain, "logistics", "company_user", ids.plsr));
    const seen = await as(logMaster, (tx) => tx.select().from(memberships).where(eq(memberships.userId, target.appId!)));
    expect(seen.map((m) => m.module)).toEqual(["logistics"]);
    expect(
      await as(logMaster, (tx) =>
        tx.update(memberships).set({ module: "doch1" }).where(eq(memberships.userId, target.appId!)).catch(() => "rejected"),
      ),
    ).toBe("rejected");
    expect(await as(logMaster, (tx) => tx.delete(memberships).where(eq(memberships.userId, target.appId!)).returning())).toHaveLength(1);
  });

  it("a company-scoped master admin manages only roles inside that company", async () => {
    expect(await grant(plsrMaster, "logistics", "company_user", ids.plsr1)).toHaveLength(1);
    await rejects(grant(plsrMaster, "logistics", "admin", ids.plnt));
    await rejects(grant(plsrMaster, "logistics", "admin", null));
    const seen = await as(plsrMaster, (tx) => tx.select().from(memberships).where(eq(memberships.module, "logistics")));
    expect(seen.every((m) => m.unitId === ids.plsr || m.unitId === ids.plsr1)).toBe(true);
    await db.delete(memberships).where(eq(memberships.userId, target.appId!));
  });

  it("role changes are audited with the acting master admin", async () => {
    const rows = await db.select().from(auditLog).where(eq(auditLog.tableName, "memberships"));
    expect(rows.some((r) => r.actorUserId === logMaster.appId && r.action === "insert")).toBe(true);
  });
});

describe("kesher", () => {
  const {
    kesherItems: items,
    kesherKitItems: kits,
    kesherSerials: serials,
    kesherHolders: holders,
    kesherStock: stock,
    kesherChecks: checks,
    kesherCheckLines: lines,
    kesherEvents: events,
    kesherSettings: settings,
  } = schema;

  const kAdmin: TestUser = { authId: randomUUID(), email: "kesher-admin@example.com" };
  const kViewer: TestUser = { authId: randomUUID(), email: "kesher-viewer@example.com" };
  const plsrUser: TestUser = { authId: randomUUID(), email: "kesher-plsr@example.com" };
  const plsrUser2: TestUser = { authId: randomUUID(), email: "kesher-plsr2@example.com" };
  const plsrAdmin: TestUser = { authId: randomUUID(), email: "kesher-plsr-admin@example.com" };
  const plntUser: TestUser = { authId: randomUUID(), email: "kesher-plnt@example.com" };
  const kesherUsers = [kAdmin, kViewer, plsrUser, plsrUser2, plsrAdmin, plntUser];

  const k = { radio: "", battery: "", amp: "", sPlsr: "", sPlsr2: "", sPlnt: "", sWh: "", plsrSoldier: "", plsrGone: "", plntSoldier: "" };

  beforeAll(async () => {
    const rows = await db
      .insert(appUsers)
      .values(kesherUsers.map((u) => ({ email: u.email, authUserId: u.authId })))
      .returning();
    for (const u of kesherUsers) u.appId = rows.find((r) => r.email === u.email)!.id;
    await db.insert(memberships).values([
      { userId: kAdmin.appId!, module: "kesher", role: "admin", unitId: null },
      { userId: kViewer.appId!, module: "kesher", role: "user", unitId: null },
      { userId: plsrUser.appId!, module: "kesher", role: "user", unitId: ids.plsr },
      { userId: plsrUser2.appId!, module: "kesher", role: "user", unitId: ids.plsr },
      { userId: plsrAdmin.appId!, module: "kesher", role: "admin", unitId: ids.plsr },
      { userId: plntUser.appId!, module: "kesher", role: "user", unitId: ids.plnt },
    ]);
    const ppl = await db
      .insert(people)
      .values([
        { unitId: ids.plsr1, fullName: "קשר פלסר" },
        { unitId: ids.plsr, fullName: "קשר פלסר שהשתחרר", active: false },
        { unitId: ids.plnt, fullName: "קשר פלנט" },
      ])
      .returning();
    [k.plsrSoldier, k.plsrGone, k.plntSoldier] = ppl.map((p) => p.id) as [string, string, string];

    const its = await db
      .insert(items)
      .values([
        { name: "710", kind: "serial" },
        { name: "סוללות קטנות", kind: "bulk" },
        { name: "מגבר", kind: "bulk" },
      ])
      .returning();
    [k.radio, k.battery, k.amp] = its.map((i) => i.id) as [string, string, string];
    const ss = await db
      .insert(serials)
      .values([
        { itemId: k.radio, serial: "489001", location: "company", unitId: ids.plsr },
        { itemId: k.radio, serial: "489002", location: "company", unitId: ids.plsr },
        { itemId: k.radio, serial: "489003", location: "company", unitId: ids.plnt },
        { itemId: k.radio, serial: "489004" },
      ])
      .returning();
    [k.sPlsr, k.sPlsr2, k.sPlnt, k.sWh] = ss.map((s) => s.id) as [string, string, string, string];
    await as(kAdmin, async (tx) => {
      await tx.insert(holders).values([
        { serialId: k.sPlsr, unitId: ids.plsr, signerPersonId: k.plsrSoldier, signerRole: "קשר מ״פ" },
        { serialId: k.sPlsr2, unitId: ids.plsr },
        // unit_id always comes from the serial (trigger), whatever the caller sends
        { serialId: k.sPlnt, unitId: ids.plsr, signerPersonId: k.plntSoldier },
      ]);
      await tx.insert(stock).values([
        { itemId: k.battery, unitId: null, qty: 40 },
        { itemId: k.battery, unitId: ids.plsr, qty: 8 },
      ]);
      await tx.insert(events).values([
        { kind: "sign", unitId: ids.plsr, company: "פלס״ר", personId: k.plsrSoldier, personName: "קשר פלסר", serial: "489001" },
        { kind: "sign", unitId: ids.plnt, company: "פלנ״ט", personId: k.plntSoldier, personName: "קשר פלנט", serial: "489003" },
        { kind: "stock_edit", item: "סוללות קטנות", qty: 40 },
      ]);
    });
  });

  it("users without a kesher membership see nothing", async () => {
    for (const t of [items, serials, stock, settings]) expect(await as(clerk, (tx) => tx.select().from(t))).toHaveLength(0);
    expect(await as(clerk, (tx) => tx.select().from(holders))).toHaveLength(0);
    expect(await as(clerk, (tx) => tx.select().from(events))).toHaveLength(0);
    expect(await as(stranger, (tx) => tx.select().from(serials))).toHaveLength(0);
  });

  it("every member reads the catalogue, every צ׳ and its location, and the quantities", async () => {
    expect(await as(plntUser, (tx) => tx.select().from(items))).toHaveLength(3);
    expect(await as(plntUser, (tx) => tx.select().from(serials))).toHaveLength(4);
    expect(await as(plntUser, (tx) => tx.select().from(stock))).toHaveLength(2);
    expect(await as(plntUser, (tx) => tx.select().from(settings))).toHaveLength(1);
  });

  it("only a battalion admin writes the catalogue, צ׳, quantities and settings (a company admin can't)", async () => {
    for (const u of [plsrUser, plsrAdmin, kViewer]) {
      await rejects(as(u, (tx) => tx.insert(items).values({ name: `x-${u.email}`, kind: "bulk" })));
      await rejects(as(u, (tx) => tx.insert(serials).values({ itemId: k.radio, serial: "9" })));
      await rejects(as(u, (tx) => tx.insert(stock).values({ itemId: k.amp, qty: 1 })));
      expect(await as(u, (tx) => tx.update(stock).set({ qty: 99 }).where(eq(stock.itemId, k.battery)).returning())).toHaveLength(0);
      expect(await as(u, (tx) => tx.update(serials).set({ location: "warehouse", unitId: null }).where(eq(serials.id, k.sPlsr)).returning())).toHaveLength(0);
      expect(await as(u, (tx) => tx.update(settings).set({ checkStaleDays: 3 }).returning())).toHaveLength(0);
    }
    const ok = await as(kAdmin, (tx) => tx.update(settings).set({ checkStaleDays: 7 }).returning());
    expect(ok).toHaveLength(1);
  });

  it("the serial number and its device type never change", async () => {
    await rejects(as(su, (tx) => tx.update(serials).set({ serial: "evil" }).where(eq(serials.id, k.sWh))));
    await rejects(as(su, (tx) => tx.update(serials).set({ itemId: k.battery }).where(eq(serials.id, k.sWh))));
  });

  it("a צ׳ needs a device type and a company unit; stock needs ציוד משלים", async () => {
    await rejects(as(kAdmin, (tx) => tx.insert(serials).values({ itemId: k.battery, serial: "500" })));
    await rejects(as(kAdmin, (tx) => tx.insert(serials).values({ itemId: k.radio, serial: "501", location: "company", unitId: ids.plsr1 })));
    await rejects(as(kAdmin, (tx) => tx.insert(serials).values({ itemId: k.radio, serial: "502", location: "company" })));
    await rejects(as(kAdmin, (tx) => tx.insert(stock).values({ itemId: k.radio, qty: 1 })));
    await rejects(as(kAdmin, (tx) => tx.insert(stock).values({ itemId: k.amp, unitId: ids.plsr, qty: -1 })));
  });

  it("the warehouse goes below zero only while it isn't tracked", async () => {
    await rejects(as(kAdmin, (tx) => tx.update(stock).set({ qty: -2 }).where(and(eq(stock.itemId, k.battery), sql`${stock.unitId} is null`))));
    await as(kAdmin, async (tx) => {
      await tx.update(settings).set({ warehouseTracked: false });
      await tx.update(stock).set({ qty: -2 }).where(and(eq(stock.itemId, k.battery), sql`${stock.unitId} is null`));
      await tx.update(stock).set({ qty: 40 }).where(and(eq(stock.itemId, k.battery), sql`${stock.unitId} is null`));
      await tx.update(settings).set({ warehouseTracked: true });
    });
  });

  it("holders: a company user sees their company's, not another's; battalion members see all", async () => {
    expect((await as(plsrUser, (tx) => tx.select().from(holders))).map((h) => h.serialId).sort()).toEqual([k.sPlsr, k.sPlsr2].sort());
    expect(await as(plsrUser2, (tx) => tx.select().from(holders))).toHaveLength(2);
    expect((await as(plntUser, (tx) => tx.select().from(holders))).map((h) => h.serialId)).toEqual([k.sPlnt]);
    expect(await as(kViewer, (tx) => tx.select().from(holders))).toHaveLength(3);
  });

  it("a holder row takes its company from the צ׳ and is created by a battalion admin only", async () => {
    await rejects(as(plsrAdmin, (tx) => tx.insert(holders).values({ serialId: k.sWh, unitId: ids.plsr })));
    // a warehouse צ׳ has no company
    await rejects(as(kAdmin, (tx) => tx.insert(holders).values({ serialId: k.sWh, unitId: ids.plsr })));
    const [h] = await db.select().from(holders).where(eq(holders.serialId, k.sPlsr));
    expect(h!.unitId).toBe(ids.plsr);
    expect(h!.signedBy).toBe(kAdmin.appId);
  });

  it("a company user sets the holder from their company — not another company's soldier, not an inactive one", async () => {
    const ok = await as(plsrUser, (tx) =>
      tx.update(holders).set({ holderPersonId: k.plsrSoldier, holderRole: "קשר מ״מ", frame: "חפ״ק" }).where(eq(holders.serialId, k.sPlsr2)).returning(),
    );
    expect(ok).toHaveLength(1);
    await rejects(as(plsrUser, (tx) => tx.update(holders).set({ holderPersonId: k.plntSoldier }).where(eq(holders.serialId, k.sPlsr2))));
    await rejects(as(plsrUser, (tx) => tx.update(holders).set({ holderPersonId: k.plsrGone }).where(eq(holders.serialId, k.sPlsr2))));
    // another company's row is not even visible
    expect(await as(plsrUser, (tx) => tx.update(holders).set({ frame: "x" }).where(eq(holders.serialId, k.sPlnt)).returning())).toHaveLength(0);
  });

  it("only a battalion admin changes who signed for a צ׳", async () => {
    await rejects(as(plsrUser, (tx) => tx.update(holders).set({ signerPersonId: null }).where(eq(holders.serialId, k.sPlsr))));
    await rejects(as(plsrAdmin, (tx) => tx.update(holders).set({ signerRole: "x" }).where(eq(holders.serialId, k.sPlsr))));
    await rejects(as(su, (tx) => tx.update(holders).set({ unitId: ids.plnt }).where(eq(holders.serialId, k.sPlsr))));
    await rejects(as(kAdmin, (tx) => tx.update(holders).set({ signerPersonId: k.plntSoldier }).where(eq(holders.serialId, k.sPlsr))));
    const r = await as(kAdmin, (tx) => tx.update(holders).set({ signerRole: "סמל קשר" }).where(eq(holders.serialId, k.sPlsr)).returning());
    expect(r[0]!.signerRole).toBe("סמל קשר");
  });

  it("a צ׳ on a company can't be deleted; moving it drops its holder row", async () => {
    await rejects(as(kAdmin, (tx) => tx.delete(serials).where(eq(serials.id, k.sPlsr2))));
    await as(kAdmin, (tx) => tx.update(serials).set({ location: "company", unitId: ids.plnt }).where(eq(serials.id, k.sPlsr2)));
    expect(await db.select().from(holders).where(eq(holders.serialId, k.sPlsr2))).toHaveLength(0);
    await as(kAdmin, (tx) => tx.update(serials).set({ location: "warehouse", unitId: null }).where(eq(serials.id, k.sPlsr2)));
    expect(await as(kAdmin, (tx) => tx.delete(serials).where(eq(serials.id, k.sPlsr2)).returning())).toHaveLength(1);
  });

  it("תקן: lines are ציוד משלים and never loop", async () => {
    await as(kAdmin, (tx) =>
      tx.insert(kits).values([
        { parentItemId: k.radio, itemId: k.amp, qty: 1 },
        { parentItemId: k.amp, itemId: k.battery, qty: 2 },
      ]),
    );
    await rejects(as(kAdmin, (tx) => tx.insert(kits).values({ parentItemId: k.battery, itemId: k.amp })));
    await rejects(as(kAdmin, (tx) => tx.insert(kits).values({ parentItemId: k.amp, itemId: k.radio })));
    await rejects(as(plsrUser, (tx) => tx.insert(kits).values({ parentItemId: k.radio, itemId: k.battery })));
  });

  it("דוח צ׳: filed for the user's own company only, with its own צ׳, in their name", async () => {
    const [c] = await as(plsrUser, (tx) =>
      tx.insert(checks).values({ unitId: ids.plsr, total: 1, found: 1, reporterName: "מישהו אחר", byUser: kAdmin.appId! }).returning(),
    );
    expect(c!.byUser).toBe(plsrUser.appId);
    expect(c!.reporterName).toBe(plsrUser.email);
    await as(plsrUser, (tx) => tx.insert(lines).values({ checkId: c!.id, serialId: k.sPlsr, serial: "489001", found: true }));
    await rejects(as(plsrUser, (tx) => tx.insert(lines).values({ checkId: c!.id, serialId: k.sPlnt, serial: "489003", found: true })));
    // another user of the same company can't add lines to someone else's report
    await rejects(as(plsrUser2, (tx) => tx.insert(lines).values({ checkId: c!.id, serialId: k.sPlsr, serial: "x", found: false })));
    await rejects(as(plsrUser, (tx) => tx.insert(checks).values({ unitId: ids.plnt, total: 1, found: 1 })));
    await rejects(as(plsrUser, (tx) => tx.insert(checks).values({ unitId: ids.plsr, total: 1, found: 1, sheetKey: "x" })));
    expect(await as(plsrUser2, (tx) => tx.select().from(checks))).toHaveLength(1);
    expect(await as(plsrUser2, (tx) => tx.select().from(lines))).toHaveLength(1);
    expect(await as(plntUser, (tx) => tx.select().from(checks))).toHaveLength(0);
    expect(await as(plntUser, (tx) => tx.select().from(lines))).toHaveLength(0);
  });

  it("notified_at is never set by a user; imported reports are marked notified", async () => {
    const [c] = await as(plsrUser, (tx) => tx.insert(checks).values({ unitId: ids.plsr, total: 2, found: 1, notifiedAt: new Date() }).returning());
    expect(c!.notifiedAt).toBeNull();
    await rejects(as(su, (tx) => tx.update(checks).set({ notifiedAt: new Date() }).where(eq(checks.id, c!.id))));
    await rejects(as(su, (tx) => tx.delete(checks).where(eq(checks.id, c!.id))));
    const [imported] = await as(kAdmin, (tx) =>
      tx.insert(checks).values({ unitId: ids.plnt, total: 3, found: 3, reporterName: "מדווח מהגיליון", sheetKey: "rep:1" }).returning(),
    );
    expect(imported!.notifiedAt).not.toBeNull();
    expect(imported!.byUser).toBeNull();
    expect(imported!.reporterName).toBe("מדווח מהגיליון");
  });

  it("events: company rows scoped; rows without company and soldier visible to all; append-only, in the actor's name", async () => {
    const plsr = await as(plsrUser, (tx) => tx.select().from(events));
    expect(plsr.map((e) => e.kind).sort()).toEqual(["sign", "stock_edit"]);
    expect(await as(kViewer, (tx) => tx.select().from(events))).toHaveLength(3);
    const [e] = await as(plsrUser, (tx) => tx.insert(events).values({ kind: "assign", unitId: ids.plsr, actorName: "x" }).returning());
    expect(e!.actorName).toBe(plsrUser.email);
    await rejects(as(plsrUser, (tx) => tx.insert(events).values({ kind: "assign", unitId: ids.plnt })));
    await rejects(as(plsrUser, (tx) => tx.insert(events).values({ kind: "stock_edit" })));
    await rejects(as(plsrUser, (tx) => tx.insert(events).values({ kind: "assign", unitId: ids.plsr, actorUserId: kAdmin.appId! })));
    await rejects(as(su, (tx) => tx.delete(events).where(eq(events.id, e!.id))));
    await rejects(as(clerk, (tx) => tx.insert(events).values({ kind: "assign", unitId: ids.plsr })));
  });

  it("kesher changes are audited with the acting user", async () => {
    const rows = await db.select().from(auditLog).where(eq(auditLog.tableName, "kesher_holders"));
    expect(rows.some((r) => r.actorUserId === plsrUser.appId && r.action === "update")).toBe(true);
  });

  it("ציוד משלים screen: only a battalion admin sets מלאי כללי and changes or removes a תקן line", async () => {
    for (const u of [plsrUser, plsrAdmin, kViewer]) {
      expect(await as(u, (tx) => tx.update(items).set({ brigadeQty: 5 }).where(eq(items.id, k.battery)).returning())).toHaveLength(0);
      expect(await as(u, (tx) => tx.update(kits).set({ qty: 3 }).where(eq(kits.itemId, k.battery)).returning())).toHaveLength(0);
      expect(await as(u, (tx) => tx.delete(kits).where(eq(kits.itemId, k.battery)).returning())).toHaveLength(0);
    }
    expect(await as(kAdmin, (tx) => tx.update(items).set({ brigadeQty: 70 }).where(eq(items.id, k.battery)).returning())).toHaveLength(1);
    // מלאי כללי is for ציוד משלים only
    await rejects(as(kAdmin, (tx) => tx.update(items).set({ brigadeQty: 1 }).where(eq(items.id, k.radio))));
    await rejects(as(kAdmin, (tx) => tx.update(items).set({ brigadeQty: -1 }).where(eq(items.id, k.battery))));
    expect(await as(kAdmin, (tx) => tx.update(kits).set({ qty: 3 }).where(eq(kits.itemId, k.battery)).returning())).toHaveLength(1);
    await rejects(as(kAdmin, (tx) => tx.update(kits).set({ qty: 100 }).where(eq(kits.itemId, k.battery))));
    expect(await as(kAdmin, (tx) => tx.delete(kits).where(eq(kits.itemId, k.battery)).returning())).toHaveLength(1);
  });

  it("דוח צ׳ from the app: the reporter adds every line of their company and its check event", async () => {
    await as(plntUser, async (tx) => {
      const [c] = await tx.insert(checks).values({ unitId: ids.plnt, total: 1, found: 0, note: "בתיקון" }).returning();
      await tx.insert(lines).values({ checkId: c!.id, serialId: k.sPlnt, serial: "489003", item: "710", found: false });
      await tx.insert(events).values({ kind: "check", unitId: ids.plnt, company: "פלנ״ט", qty: 1, details: "0/1 נראו בעין" });
    });
    const seen = await as(plntUser, (tx) => tx.select().from(lines).where(eq(lines.serialId, k.sPlnt)));
    expect(seen.map((l) => l.found)).toEqual([false]);
    expect((await as(plsrUser, (tx) => tx.select().from(events))).some((e) => e.kind === "check")).toBe(false);
  });

  it("תקין / תקול: only a battalion admin marks a צ׳ or the warehouse's ציוד משלים broken", async () => {
    for (const u of [plsrUser, plsrAdmin, kViewer]) {
      expect(await as(u, (tx) => tx.update(serials).set({ condition: "broken" }).where(eq(serials.id, k.sWh)).returning())).toHaveLength(0);
      expect(await as(u, (tx) => tx.update(items).set({ brokenQty: 2 }).where(eq(items.id, k.battery)).returning())).toHaveLength(0);
    }
    expect(await as(kAdmin, (tx) => tx.update(serials).set({ condition: "broken" }).where(eq(serials.id, k.sWh)).returning())).toHaveLength(1);
    expect(await as(kAdmin, (tx) => tx.update(items).set({ brokenQty: 2 }).where(eq(items.id, k.battery)).returning())).toHaveLength(1);
    // a device type has no broken count of its own: its צ׳ carry the condition
    await rejects(as(kAdmin, (tx) => tx.update(items).set({ brokenQty: 1 }).where(eq(items.id, k.radio))));
    await rejects(as(kAdmin, (tx) => tx.update(items).set({ brokenQty: -1 }).where(eq(items.id, k.battery))));
    await as(kAdmin, async (tx) => {
      await tx.update(serials).set({ condition: "ok" }).where(eq(serials.id, k.sWh));
      await tx.update(items).set({ brokenQty: 0 }).where(eq(items.id, k.battery));
    });
  });

  it("זיכוי לחטיבה: a צ׳ returned to the brigade leaves its company and its holder row", async () => {
    const [x] = await db.insert(serials).values({ itemId: k.radio, serial: "489099", location: "company", unitId: ids.plnt }).returning();
    await as(kAdmin, (tx) => tx.insert(holders).values({ serialId: x!.id, unitId: ids.plnt, signerPersonId: k.plntSoldier }));
    await as(kAdmin, (tx) => tx.update(serials).set({ location: "brigade", unitId: null }).where(eq(serials.id, x!.id)));
    expect(await db.select().from(holders).where(eq(holders.serialId, x!.id))).toHaveLength(0);
    await rejects(as(kAdmin, (tx) => tx.update(serials).set({ location: "brigade", unitId: ids.plnt }).where(eq(serials.id, x!.id))));
  });

  it("vehicles: every member reads דוח 1's vehicles with their standby team and their ציוד משלים; only a battalion admin writes it", async () => {
    const { doch1Vehicles: vehicles, doch1Rounds: rounds, doch1StandbyTeams: teams, kesherVehicleStock: vstock } = schema;
    const [v] = await db.insert(vehicles).values({ number: "812345", kind: "האמר" }).returning();
    let [round] = await db.select().from(rounds).where(eq(rounds.state, "active"));
    round ??= (await db.insert(rounds).values({ name: "סבב קשר", startsOn: "2026-10-01", endsOn: "2026-12-01", state: "active" }).returning())[0];
    await db.insert(teams).values({ roundId: round!.id, name: "חפ״ק מג״ד", vehicleId: v!.id });

    type V = { number: string; standby: string | null };
    const vehiclesOf = (u: TestUser) =>
      as(u, async (tx) => ((await tx.execute(sql`select number, standby from app.kesher_vehicles()`)) as unknown as { rows: V[] }).rows);
    expect((await vehiclesOf(plntUser)).find((r) => r.number === "812345")?.standby).toBe("חפ״ק מג״ד");
    // not a kesher member: nothing (the function checks it, not only the caller's doch1 rights)
    expect(await vehiclesOf(stranger)).toHaveLength(0);

    for (const u of [plsrUser, plsrAdmin, kViewer]) await rejects(as(u, (tx) => tx.insert(vstock).values({ vehicleId: v!.id, itemId: k.battery, qty: 2 })));
    await as(kAdmin, (tx) => tx.insert(vstock).values({ vehicleId: v!.id, itemId: k.battery, qty: 2 }));
    await rejects(as(kAdmin, (tx) => tx.insert(vstock).values({ vehicleId: v!.id, itemId: k.radio, qty: 1 })));
    await rejects(as(kAdmin, (tx) => tx.insert(vstock).values({ vehicleId: v!.id, itemId: k.amp, qty: 0 })));
    expect(await as(plntUser, (tx) => tx.select().from(vstock))).toHaveLength(1);
    expect(await as(clerk, (tx) => tx.select().from(vstock))).toHaveLength(0);
    expect(await as(plsrUser, (tx) => tx.update(vstock).set({ qty: 9 }).returning())).toHaveLength(0);
  });

  it("צהוב בעיניים: every member reads it; a battalion admin adds it, always in their own name and now", async () => {
    const { kesherEyeChecks: eye } = schema;
    for (const u of [plsrUser, plsrAdmin, kViewer]) await rejects(as(u, (tx) => tx.insert(eye).values({ serialId: k.sPlsr })));
    const [row] = await as(kAdmin, (tx) =>
      tx.insert(eye).values({ serialId: k.sPlsr, byUser: kViewer.appId!, byName: "מישהו אחר", at: new Date("2020-01-01") }).returning(),
    );
    expect(row!.byUser).toBe(kAdmin.appId);
    expect(row!.byName).toBe(kAdmin.email);
    expect(row!.at.getFullYear()).toBeGreaterThan(2020);
    expect(await as(plntUser, (tx) => tx.select().from(eye))).toHaveLength(1);
    expect(await as(clerk, (tx) => tx.select().from(eye))).toHaveLength(0);
    await rejects(as(kAdmin, (tx) => tx.update(eye).set({ byName: "x" })));
    await rejects(as(kAdmin, (tx) => tx.delete(eye)));
  });

  it("settings: an admin sets the thresholds and notifications; the reminder claim is the job's only", async () => {
    expect(await as(kAdmin, (tx) => tx.update(settings).set({ eyeWarnDays: 3, eyeAlertDays: 7, notifyMissing: true, reminderHour: 9 }).returning())).toHaveLength(1);
    await rejects(as(kAdmin, (tx) => tx.update(settings).set({ eyeWarnDays: 8, eyeAlertDays: 7 })));
    await rejects(as(kAdmin, (tx) => tx.update(settings).set({ reminderHour: 24 })));
    await rejects(as(kAdmin, (tx) => tx.update(settings).set({ reminderSentOn: "2026-10-28" })));
    expect(await as(plsrUser, (tx) => tx.update(settings).set({ reminderHour: null }).returning())).toHaveLength(0);
  });

  it("a kesher member subscribes to push like a דוח 1 member; others can't", async () => {
    const { doch1PushSubscriptions: subs } = schema;
    await as(plntUser, (tx) => tx.insert(subs).values({ endpoint: "https://push.example/kesher", p256dh: "k", auth: "a" }));
    expect(await as(plntUser, (tx) => tx.select().from(subs))).toHaveLength(1);
    await rejects(as(stranger, (tx) => tx.insert(subs).values({ endpoint: "https://push.example/stranger", p256dh: "k", auth: "a" })));
  });
});

describe("company", () => {
  const {
    companyJoinRequests: joins,
    companyJoinAttempts: attempts,
    companyProfileRequests: changes,
    doch1Rounds: rounds,
    doch1Statuses: statuses,
    doch1Members: members,
    doch1Days: days,
    doch1PushSubscriptions: subs,
    logisticsItems: lItems,
    logisticsSerials: lSerials,
    logisticsAssignments: lAssign,
    logisticsStorage: lStorage,
    kesherItems: kItems,
    kesherSerials: kSerials,
    kesherHolders: kHolders,
  } = schema;

  // company members (invited, with memberships)
  const cAdmin: TestUser = { authId: randomUUID(), email: "co-plsr-admin@example.com" };
  const cCmdr: TestUser = { authId: randomUUID(), email: "co-plsr1-mm@example.com" };
  const cPlntAdmin: TestUser = { authId: randomUUID(), email: "co-plnt-admin@example.com" };
  const plntDoch1: TestUser = { authId: randomUUID(), email: "co-plnt-doch1@example.com" };
  const members_ = [cAdmin, cCmdr, cPlntAdmin, plntDoch1];
  // Google accounts that were never invited (join through /join)
  const gA: TestUser = { authId: randomUUID(), email: "soldier-a@gmail.com" };
  const gB: TestUser = { authId: randomUUID(), email: "soldier-b@gmail.com" };
  const gA2: TestUser = { authId: randomUUID(), email: "soldier-a-second@gmail.com" };
  const gNone: TestUser = { authId: randomUUID(), email: "nobody@gmail.com" };
  const gSpam: TestUser = { authId: randomUUID(), email: "spam@gmail.com" };

  const s = { a: "", b: "", c: "", gone: "" };

  const pgCodeOf = (err: unknown): string | undefined => {
    let e: unknown = err;
    for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string") return code;
      e = (e as { cause?: unknown }).cause;
    }
    return undefined;
  };
  async function failsWith(p: Promise<unknown>, code: string) {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, `expected ${code}`).not.toBeNull();
    expect(pgCodeOf(err)).toBe(code);
  }
  const rowsOf = <T,>(r: unknown) => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
  const call = <T = Record<string, unknown>,>(u: TestUser, q: ReturnType<typeof sql>, extra?: Partial<JwtClaims>) =>
    as(u, async (tx) => rowsOf<T>(await tx.execute(q)), extra);
  const join = (u: TestUser, pn: string, last4: string, extra?: Partial<JwtClaims>) =>
    call(u, sql`select app.request_join(${pn}, ${last4}) as r`, extra);
  const approve = (u: TestUser, id: string, yes = true) => call(u, sql`select app.approve_join(${id}::uuid, ${yes})`);
  const myPerson = async (u: TestUser) => (await call<{ id: string | null }>(u, sql`select app.my_person_id() as id`))[0]!.id;

  beforeAll(async () => {
    const rows = await db
      .insert(appUsers)
      .values(members_.map((u) => ({ email: u.email, authUserId: u.authId })))
      .returning();
    for (const u of members_) u.appId = rows.find((r) => r.email === u.email)!.id;
    await db.insert(memberships).values([
      { userId: cAdmin.appId!, module: "company", role: "admin", unitId: ids.plsr },
      { userId: cCmdr.appId!, module: "company", role: "platoon_commander", unitId: ids.plsr1 },
      { userId: cPlntAdmin.appId!, module: "company", role: "admin", unitId: ids.plnt },
      { userId: plntDoch1.appId!, module: "doch1", role: "company_user", unitId: ids.plnt },
    ]);
    const ppl = await db
      .insert(people)
      .values([
        { unitId: ids.plsr1, fullName: "חייל אלף", personalNumber: "8100001", phone: "050-111-2233", roleTitle: "קשר" },
        { unitId: ids.plsr, fullName: "חייל בית", personalNumber: "8100002", phone: "0521114455" },
        { unitId: ids.plnt, fullName: "חייל גימל", personalNumber: "8100003", phone: "0531116677" },
        { unitId: ids.plsr, fullName: "חייל שהשתחרר", personalNumber: "8100004", phone: "0541118899", active: false },
      ])
      .returning();
    [s.a, s.b, s.c, s.gone] = ppl.map((p) => p.id) as [string, string, string, string];

    // gear: logistics (one signed, one signed and in אפסון), kesher (signer of one צ׳), on soldier A
    const [item] = await db.insert(lItems).values({ name: "M4 פלוגה" }).returning();
    const ls = await db
      .insert(lSerials)
      .values([
        { itemId: item!.id, serial: "CO1001" },
        { itemId: item!.id, serial: "CO1002" },
        { itemId: item!.id, serial: "CO1003" },
      ])
      .returning();
    await db.insert(lAssign).values([
      { serialId: ls[0]!.id, personId: s.a },
      { serialId: ls[1]!.id, personId: s.a },
      { serialId: ls[2]!.id, personId: s.c },
    ]);
    await db.insert(lStorage).values({ personId: s.a, serialId: ls[1]!.id, itemName: "M4 פלוגה" });
    const [kItem] = await db.insert(kItems).values({ name: "מגן מכלול", kind: "serial" }).returning();
    const [kSerial] = await db.insert(kSerials).values({ itemId: kItem!.id, serial: "CO-K1", location: "company", unitId: ids.plsr }).returning();
    await db.insert(kHolders).values({ serialId: kSerial!.id, unitId: ids.plsr, signerPersonId: s.a, holderPersonId: s.b });

    // days in the active round
    const today = israelToday(new Date());
    let [round] = await db.select().from(rounds).where(eq(rounds.state, "active"));
    round ??= (await db.insert(rounds).values({ name: "סבב פלוגה", startsOn: addDays(today, -30), endsOn: addDays(today, 30), state: "active" }).returning())[0];
    const st = await db
      .insert(statuses)
      .values([
        { roundId: round!.id, name: "פלוגה בבסיס", color: "#2e7d32", displayGroup: "בבסיס", sheetValue: "co1", countsAsPresent: true },
        { roundId: round!.id, name: "פלוגה בבית", color: "#1565c0", displayGroup: "בבית", sheetValue: "co2", homeDay: true },
      ])
      .returning();
    await db.insert(members).values([
      { roundId: round!.id, personId: s.a },
      { roundId: round!.id, personId: s.c },
    ]);
    await db.insert(days).values([
      { roundId: round!.id, personId: s.a, day: addDays(today, -2), statusId: st[0]!.id },
      { roundId: round!.id, personId: s.a, day: addDays(today, -1), statusId: st[1]!.id },
      { roundId: round!.id, personId: s.a, day: today, statusId: st[0]!.id },
      { roundId: round!.id, personId: s.a, day: addDays(today, 1), statusId: st[1]!.id },
      { roundId: round!.id, personId: s.c, day: today, statusId: st[0]!.id },
    ]);
  });

  describe("joining", () => {
    it("an unlinked account has no soldier and sees nothing of the module", async () => {
      expect(await myPerson(gA)).toBeNull();
      expect(await as(gA, (tx) => tx.select().from(joins))).toHaveLength(0);
      expect(await call(gA, sql`select * from app.my_gear()`)).toHaveLength(0);
      expect(await call(gA, sql`select * from app.person_gear(${s.a}::uuid)`)).toHaveLength(0);
    });

    it("gives the same answer whether or not the personal number matched; no match leaves no row", async () => {
      const matched = await join(gA, "81-00001", "2233");
      const wrongPhone = await join(gNone, "8100001", "0000");
      const noSuchNumber = await join(gNone, "8999999", "2233");
      const inactive = await join(gNone, "8100004", "8899");
      expect(wrongPhone).toEqual(matched);
      expect(noSuchNumber).toEqual(matched);
      expect(inactive).toEqual(matched);
      const all = await db.select().from(joins);
      expect(all.filter((r) => r.authUserId === gNone.authId)).toHaveLength(0);
      const mine = all.filter((r) => r.authUserId === gA.authId);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ personId: s.a, unitId: ids.plsr1, status: "pending", email: gA.email });
      // every attempt is counted, match or not
      expect((await db.select().from(attempts)).filter((a) => a.authUserId === gNone.authId)).toHaveLength(3);
    });

    it("one open request per account: asking again replaces it", async () => {
      await join(gB, "8100001", "2233");
      await join(gB, "8100002", "4455");
      const mine = (await db.select().from(joins)).filter((r) => r.authUserId === gB.authId);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ personId: s.b, unitId: ids.plsr });
    });

    it("needs a Google account with a verified email, and input in the right format", async () => {
      await rejects(join(gNone, "8100001", "2233", { user_metadata: { email_verified: false } }));
      await rejects(join(gNone, "8100001", "2233", { app_metadata: { provider: "email" } }));
      await failsWith(join(gNone, "12", "2233"), "GD102");
      await failsWith(join(gNone, "8100001", "22"), "GD102");
    });

    it("is limited to 5 attempts per account a day", async () => {
      for (let i = 0; i < 5; i++) await join(gSpam, "8999999", "0000");
      await failsWith(join(gSpam, "8100001", "2233"), "GD101");
      expect((await db.select().from(joins)).filter((r) => r.authUserId === gSpam.authId)).toHaveLength(0);
    });

    it("requests are seen by the soldier's company admins only", async () => {
      expect((await as(cAdmin, (tx) => tx.select().from(joins))).map((r) => r.personId).sort()).toEqual([s.a, s.b].sort());
      expect(await as(cPlntAdmin, (tx) => tx.select().from(joins))).toHaveLength(0);
      expect(await as(cCmdr, (tx) => tx.select().from(joins))).toHaveLength(0);
      expect(await as(clerk, (tx) => tx.select().from(joins))).toHaveLength(0);
    });

    it("nobody writes requests or attempts directly", async () => {
      await rejects(as(cAdmin, (tx) => tx.insert(joins).values({ authUserId: gNone.authId, email: gNone.email, personId: s.b, unitId: ids.plsr })));
      await rejects(as(cAdmin, (tx) => tx.update(joins).set({ status: "approved" })));
      await rejects(as(su, (tx) => tx.select().from(attempts)));
    });

    it("only a company admin of the soldier's unit approves; it links the account", async () => {
      const [reqA] = await db.select().from(joins).where(and(eq(joins.authUserId, gA.authId), eq(joins.status, "pending")));
      await rejects(approve(cCmdr, reqA!.id));
      await rejects(approve(cPlntAdmin, reqA!.id));
      await rejects(approve(gA, reqA!.id));
      await approve(cAdmin, reqA!.id);
      expect(await myPerson(gA)).toBe(s.a);
      const [u] = await db.select().from(appUsers).where(eq(appUsers.authUserId, gA.authId));
      expect(u).toMatchObject({ email: gA.email, personId: s.a, active: true, isSuperAdmin: false, displayName: "חייל אלף" });
      expect(await db.select().from(memberships).where(eq(memberships.userId, u!.id))).toHaveLength(0);
      await failsWith(approve(cAdmin, reqA!.id), "GD103");
      // the approval and the new account are in the audit log, by the admin
      const log = await db.select().from(auditLog).where(and(eq(auditLog.tableName, "app_users"), eq(auditLog.rowId, u!.id)));
      expect(log[0]?.actorUserId).toBe(cAdmin.appId);
    });

    it("a linked account can't ask again, and a second account for the same soldier isn't approved", async () => {
      await join(gA, "8100002", "4455");
      expect((await db.select().from(joins)).filter((r) => r.authUserId === gA.authId && r.status === "pending")).toHaveLength(0);
      await join(gA2, "8100001", "2233");
      const [req] = await db.select().from(joins).where(and(eq(joins.authUserId, gA2.authId), eq(joins.status, "pending")));
      await failsWith(approve(cAdmin, req!.id), "GD105");
      await approve(cAdmin, req!.id, false);
      expect((await db.select().from(joins).where(eq(joins.id, req!.id)))[0]!.status).toBe("rejected");
      expect(await myPerson(gA2)).toBeNull();
    });

    it("a disabled account stays out: its request is silent and never approved", async () => {
      await db.update(appUsers).set({ personId: null }).where(eq(appUsers.id, inactive.appId!));
      await join(inactive, "8100002", "4455");
      expect((await db.select().from(joins)).filter((r) => r.authUserId === inactive.authId)).toHaveLength(0);
    });
    it("a company admin links a soldier to a Google email by hand; the soldier claims it on sign-in", async () => {
      const gC: TestUser = { authId: randomUUID(), email: "soldier-c@gmail.com" };
      const link = (u: TestUser, person: string, email: string) => call(u, sql`select app.company_link_account(${person}::uuid, ${email})`);
      await rejects(link(cAdmin, s.c, gC.email));
      await rejects(link(cCmdr, s.a, gC.email));
      await failsWith(link(cPlntAdmin, s.c, "not-an-email"), "GD109");
      await failsWith(link(cPlntAdmin, s.c, inactive.email), "GD106");
      await link(cPlntAdmin, s.c, " Soldier-C@gmail.com ");
      expect(await myPerson(gC)).toBeNull();
      await call(gC, sql`select app.link_auth_user()`);
      expect(await myPerson(gC)).toBe(s.c);
      await failsWith(link(cPlntAdmin, s.c, "other@gmail.com"), "GD105");
    });
  });

  describe("אני", () => {
    it("the soldier reads their own gear: logistics (אפסון marked) and kesher", async () => {
      const gear = await call<{ source: string; serial: string; detail: string | null }>(gA, sql`select * from app.my_gear()`);
      expect(gear.map((g) => `${g.source}:${g.serial}:${g.detail ?? ""}`).sort()).toEqual(
        ["kesher:CO-K1:חותם על הפלוגה", "logistics:CO1001:", "logistics:CO1002:באפסון"].sort(),
      );
    });

    it("a soldier can't see another soldier's gear, days or details", async () => {
      expect(await call(gA, sql`select * from app.person_gear(${s.c}::uuid)`)).toHaveLength(0);
      expect(await call(gA, sql`select * from app.person_days(${s.c}::uuid)`)).toHaveLength(0);
      expect(await call(gA, sql`select * from app.person_details(${s.b}::uuid)`)).toHaveLength(0);
      expect(await call(gA, sql`select * from app.company_roster(${ids.plsr}::uuid)`)).toHaveLength(0);
      // and no department table opens up to them
      expect(await as(gA, (tx) => tx.select().from(people))).toHaveLength(0);
      expect(await as(gA, (tx) => tx.select().from(lAssign))).toHaveLength(0);
      expect(await as(gA, (tx) => tx.select().from(kHolders))).toHaveLength(0);
      expect(await as(gA, (tx) => tx.select().from(days))).toHaveLength(0);
    });

    it("the soldier reads their own details (never the personal number) and days of the active round", async () => {
      const [me] = await call<Record<string, unknown>>(gA, sql`select * from app.person_details(app.my_person_id())`);
      expect(me).toMatchObject({ full_name: "חייל אלף", role_title: "קשר", phone: "050-111-2233" });
      expect(Object.keys(me!)).not.toContain("personal_number");
      const ds = await call<{ day: unknown; present: boolean; home: boolean }>(gA, sql`select * from app.my_days()`);
      expect(ds).toHaveLength(4);
      expect(ds.filter((d) => d.present)).toHaveLength(2);
      expect(ds.filter((d) => d.home)).toHaveLength(2);
    });

    it("a commander sees a soldier they cover, not one of another company or platoon", async () => {
      expect(await call(cAdmin, sql`select * from app.person_gear(${s.a}::uuid)`)).toHaveLength(3);
      expect(await call(cCmdr, sql`select * from app.person_gear(${s.a}::uuid)`)).toHaveLength(3);
      expect(await call(cCmdr, sql`select * from app.person_details(${s.b}::uuid)`)).toHaveLength(0);
      expect(await call(cPlntAdmin, sql`select * from app.person_gear(${s.a}::uuid)`)).toHaveLength(0);
      expect(await call(cPlntAdmin, sql`select * from app.person_gear(${s.c}::uuid)`)).toHaveLength(1);
    });

    it("the roster: the covered soldiers with today's status and gear count, no personal number", async () => {
      const r = await call<Record<string, unknown>>(cAdmin, sql`select * from app.company_roster(${ids.plsr}::uuid)`);
      const a = r.find((x) => x.id === s.a)!;
      expect(a).toMatchObject({ full_name: "חייל אלף", status_name: "פלוגה בבסיס", gear: 3, linked: true });
      expect(Object.keys(a)).not.toContain("personal_number");
      expect(r.map((x) => x.id)).not.toContain(s.gone);
      expect(r.map((x) => x.id)).not.toContain(s.c);
      const mm = await call<{ id: string }>(cCmdr, sql`select * from app.company_roster(${ids.plsr}::uuid)`);
      expect(mm.map((x) => x.id)).toContain(s.a);
      expect(mm.map((x) => x.id)).not.toContain(s.b);
      expect(await call(cPlntAdmin, sql`select * from app.company_roster(${ids.plsr}::uuid)`)).toHaveLength(0);
    });

    it("a linked soldier may subscribe to push", async () => {
      await as(gA, (tx) => tx.insert(subs).values({ endpoint: "https://push.example/soldier", p256dh: "k", auth: "a" }));
      expect(await as(gA, (tx) => tx.select().from(subs))).toHaveLength(1);
      await rejects(as(gNone, (tx) => tx.insert(subs).values({ endpoint: "https://push.example/none", p256dh: "k", auth: "a" })));
    });
  });

  describe("self-edit", () => {
    it("the soldier fixes their own phone at once, audited; nobody else through this", async () => {
      const [r] = await call<{ phone: string }>(gA, sql`select app.update_my_phone('+972 50-999-8877') as phone`);
      expect(r!.phone).toBe("0509998877");
      const [p] = await db.select().from(people).where(eq(people.id, s.a));
      expect(p!.phone).toBe("0509998877");
      const [u] = await db.select().from(appUsers).where(eq(appUsers.authUserId, gA.authId));
      const log = await db.select().from(auditLog).where(and(eq(auditLog.tableName, "people"), eq(auditLog.rowId, s.a)));
      expect(log.at(-1)?.actorUserId).toBe(u!.id);
      await failsWith(call(gA, sql`select app.update_my_phone('12345')`), "GD107");
      await rejects(call(gNone, sql`select app.update_my_phone('0501234567')`));
      await rejects(call(cAdmin, sql`select app.update_my_phone('0501234567')`));
      // the soldier can't write people directly
      expect(await as(gA, (tx) => tx.update(people).set({ fullName: "x" }).where(eq(people.id, s.a)).returning())).toHaveLength(0);
    });

    it("a name change waits for approval; the soldier sees their own request only", async () => {
      const [r] = await call<{ id: string }>(gA, sql`select app.request_profile_change('full_name', '  חייל   אלף  חדש ') as id`);
      const [p] = await db.select().from(people).where(eq(people.id, s.a));
      expect(p!.fullName).toBe("חייל אלף");
      const mine = await as(gA, (tx) => tx.select().from(changes));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ id: r!.id, field: "full_name", oldValue: "חייל אלף", newValue: "חייל אלף חדש", status: "pending", unitId: ids.plsr1 });
      // asking again replaces the open request
      await call(gA, sql`select app.request_profile_change('full_name', 'חייל אלף מתוקן')`);
      expect(await db.select().from(changes).where(eq(changes.personId, s.a))).toHaveLength(1);
      await failsWith(call(gA, sql`select app.request_profile_change('full_name', 'א')`), "GD108");
      await rejects(call(gA, sql`select app.request_profile_change('phone', '0501234567')`));
      await rejects(call(gNone, sql`select app.request_profile_change('full_name', 'שם')`));
    });

    it("change requests are seen by the soldier's commanders, not by another company", async () => {
      expect(await as(cAdmin, (tx) => tx.select().from(changes))).toHaveLength(1);
      expect(await as(cCmdr, (tx) => tx.select().from(changes))).toHaveLength(1);
      expect(await as(cPlntAdmin, (tx) => tx.select().from(changes))).toHaveLength(0);
      expect(await as(clerk, (tx) => tx.select().from(changes))).toHaveLength(0);
    });

    it("the platoon commander approves for their platoon; the name and the previous name are kept", async () => {
      const [req] = await db.select().from(changes).where(and(eq(changes.personId, s.a), eq(changes.status, "pending")));
      await rejects(call(cPlntAdmin, sql`select app.decide_profile_change(${req!.id}::uuid, true)`));
      await rejects(call(gA, sql`select app.decide_profile_change(${req!.id}::uuid, true)`));
      await call(cCmdr, sql`select app.decide_profile_change(${req!.id}::uuid, true)`);
      const [p] = await db.select().from(people).where(eq(people.id, s.a));
      expect(p!.fullName).toBe("חייל אלף מתוקן");
      const [done] = await db.select().from(changes).where(eq(changes.id, req!.id));
      expect(done).toMatchObject({ status: "approved", oldValue: "חייל אלף", decidedBy: cCmdr.appId });
      await failsWith(call(cAdmin, sql`select app.decide_profile_change(${req!.id}::uuid, false)`), "GD103");
    });

    it("a platoon commander can't decide for a soldier outside their platoon; the company admin can", async () => {
      // soldier B (company level, not in מחלקה 1), linked through the request from before
      const [reqB] = await db.select().from(joins).where(and(eq(joins.authUserId, gB.authId), eq(joins.status, "pending")));
      await approve(cAdmin, reqB!.id);
      const [id] = await call<{ id: string }>(gB, sql`select app.request_profile_change('role_title', 'נהג') as id`);
      await rejects(call(cCmdr, sql`select app.decide_profile_change(${id!.id}::uuid, true)`));
      await call(cAdmin, sql`select app.decide_profile_change(${id!.id}::uuid, false)`);
      const [p] = await db.select().from(people).where(eq(people.id, s.b));
      expect(p!.roleTitle).toBeNull();
    });

    it("proposing the current value withdraws the open request", async () => {
      await call(gB, sql`select app.request_profile_change('role_title', 'נהג')`);
      await call(gB, sql`select app.request_profile_change('role_title', '')`);
      expect((await db.select().from(changes).where(eq(changes.personId, s.b))).map((r) => r.status).sort()).toEqual(["cancelled", "rejected"]);
    });

    it("an inactive soldier's account loses its soldier", async () => {
      await db.update(people).set({ active: false }).where(eq(people.id, s.b));
      expect(await myPerson(gB)).toBeNull();
      expect(await call(gB, sql`select * from app.my_gear()`)).toHaveLength(0);
      await db.update(people).set({ active: true }).where(eq(people.id, s.b));
    });
  });
  describe("register (החתמה פנימית)", () => {
    const { companyItems: cItems, companySignings: signings, kesherEvents: kEvents } = schema;
    const cCmdr2: TestUser = { authId: randomUUID(), email: "co-plsr2-mm@example.com" };
    const r = { plsr2: "", d: "", kSerial: "", tent: "", pots: "" };
    const sign = (u: TestUser, kind: string, id: string, to: string, qty = 1) =>
      call<{ id: string }>(u, sql`select app.company_sign(${kind}, ${id}::uuid, ${to}::uuid, ${qty}) as id`).then((x) => x[0]!.id);
    const giveBack = (u: TestUser, id: string) => call(u, sql`select app.company_return(${id}::uuid)`);
    const openFor = async (serialId: string) =>
      (await db.select().from(signings).where(eq(signings.kesherSerialId, serialId))).filter((x) => !x.returnedAt);

    beforeAll(async () => {
      const [plsr2] = await db.insert(units).values({ parentId: ids.plsr, kind: "platoon", name: "מחלקה 2" }).returning();
      r.plsr2 = plsr2!.id;
      const [d] = await db.insert(people).values({ unitId: r.plsr2, fullName: "חייל דלת" }).returning();
      r.d = d!.id;
      const [u] = await db.insert(appUsers).values({ email: cCmdr2.email, authUserId: cCmdr2.authId }).returning();
      cCmdr2.appId = u!.id;
      await db.insert(memberships).values({ userId: cCmdr2.appId, module: "company", role: "platoon_commander", unitId: r.plsr2 });
      const [ks] = await db.select().from(kSerials).where(eq(kSerials.serial, "CO-K1"));
      r.kSerial = ks!.id;
    });

    it("company items: the admin writes; the company's members read; nobody else", async () => {
      await rejects(as(cCmdr, (tx) => tx.insert(cItems).values({ unitId: ids.plsr, name: "אוהל" })));
      await rejects(as(cPlntAdmin, (tx) => tx.insert(cItems).values({ unitId: ids.plsr, name: "אוהל" })));
      await rejects(as(cAdmin, (tx) => tx.insert(cItems).values({ unitId: ids.plsr1, name: "אוהל" })));
      const [tent] = await as(cAdmin, (tx) => tx.insert(cItems).values({ unitId: ids.plsr, name: "אוהל סיירים", serial: "T-100" }).returning());
      const [pots] = await as(cAdmin, (tx) => tx.insert(cItems).values({ unitId: ids.plsr, name: "סיר", quantity: 3 }).returning());
      r.tent = tent!.id;
      r.pots = pots!.id;
      await rejects(as(cAdmin, (tx) => tx.insert(cItems).values({ unitId: ids.plsr, name: "כפול", serial: "T-100" })));
      await rejects(as(cAdmin, (tx) => tx.insert(cItems).values({ unitId: ids.plsr, name: "שני", serial: "T-101", quantity: 2 })));
      expect(await as(cCmdr2, (tx) => tx.select().from(cItems))).toHaveLength(2);
      expect(await as(cPlntAdmin, (tx) => tx.select().from(cItems))).toHaveLength(0);
      expect(await as(gA, (tx) => tx.select().from(cItems))).toHaveLength(0);
      expect(await as(cCmdr, (tx) => tx.update(cItems).set({ name: "x" }).returning())).toHaveLength(0);
    });

    it("what can be signed: the company's kesher צ׳ with where each is now — for a member with no kesher role", async () => {
      const items = await call<{ kind: string; serial: string | null; now_name: string | null; available: number }>(cCmdr2, sql`select * from app.company_register_items(${ids.plsr}::uuid)`);
      expect(items.find((x) => x.serial === "CO-K1")).toMatchObject({ kind: "kesher", now_name: "חייל בית", available: 1 });
      expect(items.find((x) => x.serial === null)).toMatchObject({ kind: "company", available: 3 });
      expect(await as(cCmdr2, (tx) => tx.select().from(kSerials))).toHaveLength(0);
      expect(await call(cPlntAdmin, sql`select * from app.company_register_items(${ids.plsr}::uuid)`)).toHaveLength(0);
      expect(await call(gA, sql`select * from app.company_register_items(${ids.plsr}::uuid)`)).toHaveLength(0);
    });

    it("the receiver picker: names of the company's soldiers only", async () => {
      const names = await call<Record<string, unknown>>(cCmdr2, sql`select * from app.company_soldier_names(${ids.plsr}::uuid)`);
      expect(names.map((x) => x.full_name)).toEqual(expect.arrayContaining(["חייל אלף מתוקן", "חייל בית", "חייל דלת"]));
      expect(names.map((x) => x.full_name)).not.toContain("חייל גימל");
      expect(Object.keys(names[0]!).sort()).toEqual(["full_name", "id", "unit_id"]);
      expect(await call(cPlntAdmin, sql`select * from app.company_soldier_names(${ids.plsr}::uuid)`)).toHaveLength(0);
    });

    it("a platoon commander borrows a kesher צ׳ for their soldier; kesher's records don't change", async () => {
      const holdersBefore = await db.select().from(kHolders).where(eq(kHolders.serialId, r.kSerial));
      const eventsBefore = (await db.select().from(kEvents)).length;
      await sign(cCmdr2, "kesher", r.kSerial, r.d);
      const open = await openFor(r.kSerial);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ unitId: ids.plsr, fromPersonId: s.b, toPersonId: r.d, signedBy: cCmdr2.appId });
      expect(await db.select().from(kHolders).where(eq(kHolders.serialId, r.kSerial))).toEqual(holdersBefore);
      expect((await db.select().from(kEvents)).length).toBe(eventsBefore);
      // the usual holder and signer see who has it now
      const bGear = await call<{ serial: string; with_name: string | null }>(gB, sql`select * from app.my_gear()`);
      expect(bGear.find((g) => g.serial === "CO-K1")?.with_name).toBe("חייל דלת");
      const aGear = await call<{ serial: string; with_name: string | null }>(gA, sql`select * from app.my_gear()`);
      expect(aGear.find((g) => g.serial === "CO-K1")?.with_name).toBe("חייל דלת");
      const dGear = await call<{ source: string; serial: string; detail: string }>(cCmdr2, sql`select * from app.person_gear(${r.d}::uuid)`);
      expect(dGear).toEqual([expect.objectContaining({ source: "company", serial: "CO-K1", detail: "מחייל בית" })]);
    });

    it("passing it on closes the open entry in the same step — never in two places", async () => {
      await failsWith(sign(cCmdr2, "kesher", r.kSerial, r.d), "GD110");
      await sign(cCmdr, "kesher", r.kSerial, s.a);
      const open = await openFor(r.kSerial);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ fromPersonId: r.d, toPersonId: s.a });
      expect((await db.select().from(signings).where(eq(signings.kesherSerialId, r.kSerial))).filter((x) => x.returnedAt)).toHaveLength(1);
      await rejects(as(cAdmin, (tx) => tx.insert(signings).values({ unitId: ids.plsr, kesherSerialId: r.kSerial, toPersonId: s.b })));
      await rejects(as(cAdmin, (tx) => tx.update(signings).set({ returnedAt: new Date() })));
    });

    it("only the company admin, or the commander of the platoon it is with or goes to, records it", async () => {
      // it is with A (מחלקה 1); מ״מ 2 signing it to B (company level) is neither lending nor borrowing
      await rejects(sign(cCmdr2, "kesher", r.kSerial, s.b));
      await rejects(sign(cPlntAdmin, "kesher", r.kSerial, s.b));
      await rejects(sign(gA, "kesher", r.kSerial, s.b));
      await failsWith(sign(cAdmin, "kesher", r.kSerial, s.c), "GD113");
      await failsWith(sign(cAdmin, "kesher", r.kSerial, s.gone), "GD113");
    });

    it("a quantity item: several open entries, never more than the company has", async () => {
      await sign(cAdmin, "company", r.pots, s.a, 2);
      await failsWith(sign(cAdmin, "company", r.pots, s.b, 2), "GD111");
      await sign(cAdmin, "company", r.pots, s.b, 1);
      await failsWith(as(cAdmin, (tx) => tx.update(cItems).set({ quantity: 2 }).where(eq(cItems.id, r.pots))), "GD111");
      const tentEntry = await sign(cAdmin, "company", r.tent, r.d);
      await failsWith(sign(cCmdr, "company", r.tent, r.d), "GD110");
      await sign(cCmdr, "company", r.tent, s.a);
      expect((await db.select().from(signings).where(eq(signings.companyItemId, r.tent))).filter((x) => !x.returnedAt)).toHaveLength(1);
      expect((await db.select().from(signings).where(eq(signings.id, tentEntry)))[0]!.returnedBy).toBe(cCmdr.appId);
    });

    it("logistics gear: a צ׳ signed on a soldier of the company is lent internally; logistics' records don't change", async () => {
      const [co1001, co1002, co1003] = await Promise.all(
        ["CO1001", "CO1002", "CO1003"].map(async (n) => (await db.select().from(lSerials).where(eq(lSerials.serial, n)))[0]!.id),
      );
      const items = await call<{ kind: string; serial: string; now_name: string | null }>(cCmdr2, sql`select * from app.company_register_items(${ids.plsr}::uuid)`);
      const logistics = items.filter((x) => x.kind === "logistics");
      // CO1002 is in אפסון, CO1003 is on a soldier of another company
      expect(logistics.map((x) => `${x.serial}:${x.now_name}`)).toEqual(["CO1001:חייל אלף מתוקן"]);
      expect(await as(cCmdr2, (tx) => tx.select().from(lAssign))).toHaveLength(0);

      const assignBefore = await db.select().from(lAssign);
      const id = await sign(cCmdr2, "logistics", co1001!, r.d);
      expect((await db.select().from(signings).where(eq(signings.id, id)))[0]).toMatchObject({ logisticsSerialId: co1001, fromPersonId: s.a, toPersonId: r.d });
      expect(await db.select().from(lAssign)).toEqual(assignBefore);
      const aGear = await call<{ source: string; serial: string; with_name: string | null }>(gA, sql`select * from app.my_gear()`);
      expect(aGear.find((g) => g.source === "logistics" && g.serial === "CO1001")?.with_name).toBe("חייל דלת");
      const dGear = await call<{ source: string; item: string; detail: string }>(cCmdr2, sql`select * from app.person_gear(${r.d}::uuid)`);
      expect(dGear.find((g) => g.source === "company" && g.item === "M4 פלוגה")?.detail).toBe("מחייל אלף מתוקן");
      const list = await call<{ kind: string; serial: string }>(cCmdr2, sql`select * from app.company_register(${ids.plsr}::uuid, true)`);
      expect(list.find((x) => x.serial === "CO1001")?.kind).toBe("logistics");

      await failsWith(sign(cAdmin, "logistics", co1002!, r.d), "GD112");
      await failsWith(sign(cAdmin, "logistics", co1003!, r.d), "GD113");
      await failsWith(sign(cPlntAdmin, "logistics", co1003!, s.c), "GD110");
      await giveBack(cCmdr2, id);
    });

    it("הוחזר: the admin or a commander of the giver's / receiver's platoon; once", async () => {
      const [entry] = await openFor(r.kSerial);
      await rejects(giveBack(cPlntAdmin, entry!.id));
      await rejects(giveBack(gA, entry!.id));
      await giveBack(cCmdr2, entry!.id); // it came from D, of מחלקה 2
      await failsWith(giveBack(cAdmin, entry!.id), "GD114");
      expect(await openFor(r.kSerial)).toHaveLength(0);
      const bGear = await call<{ serial: string; with_name: string | null }>(gB, sql`select * from app.my_gear()`);
      expect(bGear.find((g) => g.serial === "CO-K1")?.with_name).toBeNull();
    });

    it("who reads the register: the company's members, and a soldier about their own entries only", async () => {
      const all = await db.select().from(signings);
      expect(await as(cCmdr2, (tx) => tx.select().from(signings))).toHaveLength(all.length);
      const mine = await as(gA, (tx) => tx.select().from(signings));
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((x) => x.toPersonId === s.a || x.fromPersonId === s.a)).toBe(true);
      expect(await as(cPlntAdmin, (tx) => tx.select().from(signings))).toHaveLength(0);
      expect(await as(clerk, (tx) => tx.select().from(signings))).toHaveLength(0);
      // the kesher department doesn't see it either
      const kesherUser: TestUser = { authId: randomUUID(), email: "co-kesher-user@example.com" };
      const [u] = await db.insert(appUsers).values({ email: kesherUser.email, authUserId: kesherUser.authId }).returning();
      await db.insert(memberships).values({ userId: u!.id, module: "kesher", role: "admin", unitId: null });
      expect(await as(kesherUser, (tx) => tx.select().from(signings))).toHaveLength(0);
    });

    it("the register list: every platoon's entries with names, for the company's members only", async () => {
      const open = await call<{ item: string; to_name: string; from_name: string | null; signed_by_name: string }>(cCmdr2, sql`select * from app.company_register(${ids.plsr}::uuid, true)`);
      expect(open.map((x) => `${x.item}:${x.to_name}`).sort()).toEqual(["אוהל סיירים:חייל אלף מתוקן", "סיר:חייל אלף מתוקן", "סיר:חייל בית"].sort());
      const history = await call<{ item: string; from_name: string | null; returned_by_name: string }>(cCmdr2, sql`select * from app.company_register(${ids.plsr}::uuid, false)`);
      expect(history.filter((x) => x.item === "מגן מכלול")).toHaveLength(2);
      expect(await call(cPlntAdmin, sql`select * from app.company_register(${ids.plsr}::uuid, true)`)).toHaveLength(0);
      expect(await call(gA, sql`select * from app.company_register(${ids.plsr}::uuid, true)`)).toHaveLength(0);
    });

    it("the roster counts register entries in a soldier's gear", async () => {
      const roster = await call<{ id: string; gear: number }>(cAdmin, sql`select * from app.company_roster(${ids.plsr}::uuid)`);
      // A: 2 logistics + 1 kesher (signer) + pots ×2 entry + tent
      expect(roster.find((x) => x.id === s.a)?.gear).toBe(5);
    });
  });
  describe("roles (הגדרות)", () => {
    const grant = (u: TestUser, userId: string, module: string, role: string, unit: string) =>
      call<{ id: string }>(u, sql`select app.company_grant_role(${userId}::uuid, ${module}::module_id, ${role}, ${unit}::uuid) as id`).then((x) => x[0]!.id);
    const revoke = (u: TestUser, id: string) => call(u, sql`select app.company_revoke_role(${id}::uuid)`);
    const appIdOf = async (u: TestUser) => (await db.select().from(appUsers).where(eq(appUsers.authUserId, u.authId)))[0]!.id;

    it("a company admin gives the whitelisted roles to the company's linked soldiers", async () => {
      const a = await appIdOf(gA);
      const id = await grant(cAdmin, a, "doch1", "company_user", ids.plsr);
      const [m] = await db.select().from(memberships).where(eq(memberships.id, id));
      expect(m).toMatchObject({ userId: a, module: "doch1", role: "company_user", unitId: ids.plsr, viaCompany: true });
      // the role works: soldier A, now a doch1 company user, sees the company's people
      expect((await as(gA, (tx) => tx.select().from(people))).length).toBeGreaterThan(1);
      await grant(cAdmin, a, "doch1", "viewer", ids.plsr); // same unit: changes the role
      expect((await db.select().from(memberships).where(eq(memberships.id, id)))[0]!.role).toBe("viewer");
      const mm = await grant(cAdmin, a, "company", "platoon_commander", ids.plsr1);
      expect((await db.select().from(memberships).where(eq(memberships.id, mm)))[0]).toMatchObject({ module: "company", unitId: ids.plsr1 });
      await grant(cAdmin, a, "kesher", "user", ids.plsr);
      await grant(cAdmin, a, "logistics", "company_user", ids.plsr);
      await grant(cAdmin, a, "doch1", "platoon_commander", ids.plsr1);
    });

    it("never an admin role, a battalion or another company's unit, or the wrong level", async () => {
      const b = await appIdOf(gB);
      for (const [mod, role, unit] of [
        ["doch1", "admin", ids.plsr],
        ["doch1", "master_admin", ids.plsr],
        ["company", "admin", ids.plsr],
        ["kesher", "admin", ids.plsr],
        ["kesher", "user", ids.plsr1],
        ["logistics", "admin", ids.plsr],
        ["doch1", "platoon_commander", ids.plsr],
        ["core", "editor", ids.plsr],
      ] as const)
        await failsWith(grant(cAdmin, b, mod, role, unit), "GD115");
      await rejects(grant(cAdmin, b, "doch1", "company_user", ids.bat));
      await rejects(grant(cAdmin, b, "doch1", "company_user", ids.plnt));
    });

    it("only to an account linked to an active soldier of the company; never by a platoon commander or to oneself", async () => {
      await failsWith(grant(cAdmin, clerk.appId!, "doch1", "viewer", ids.plsr), "GD116");
      const gC = (await db.select().from(appUsers).where(eq(appUsers.email, "soldier-c@gmail.com")))[0]!;
      await failsWith(grant(cAdmin, gC.id, "doch1", "viewer", ids.plsr), "GD116");
      await rejects(grant(cCmdr, await appIdOf(gB), "doch1", "viewer", ids.plsr));
      await rejects(grant(cAdmin, cAdmin.appId!, "doch1", "viewer", ids.plsr));
      // the memberships policies are not widened
      await rejects(as(cAdmin, (tx) => tx.insert(memberships).values({ userId: gC.id, module: "doch1", role: "viewer", unitId: ids.plsr })));
    });

    it("a role given in /admin is read-only here: not overwritten, not revoked; via_company can't be faked", async () => {
      const b = await appIdOf(gB);
      const [m] = await as(coreAdmin, (tx) =>
        tx.insert(memberships).values({ userId: b, module: "kesher", role: "user", unitId: ids.plsr, viaCompany: true }).returning(),
      );
      expect(m!.viaCompany).toBe(false);
      await failsWith(grant(cAdmin, b, "kesher", "user", ids.plsr), "GD117");
      await rejects(revoke(cAdmin, m!.id));
    });

    it("revoke: a company admin of that company, roles given here only", async () => {
      const a = await appIdOf(gA);
      const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, a), eq(memberships.module, "kesher")));
      await rejects(revoke(cPlntAdmin, m!.id));
      await rejects(revoke(cCmdr, m!.id));
      await revoke(cAdmin, m!.id);
      expect(await db.select().from(memberships).where(eq(memberships.id, m!.id))).toHaveLength(0);
      const [own] = await db.select().from(memberships).where(eq(memberships.userId, cCmdr.appId!));
      await rejects(revoke(cAdmin, own!.id));
    });

    it("the access list: the company's linked accounts and their roles, for the company admin only", async () => {
      const rows = await call<{ email: string; module: string | null; role: string | null; editable: boolean }>(cAdmin, sql`select * from app.company_access_list(${ids.plsr}::uuid)`);
      expect(rows.filter((r) => r.email === gA.email).map((r) => `${r.module}:${r.role}:${r.editable}`).sort()).toEqual(
        ["company:platoon_commander:true", "doch1:platoon_commander:true", "doch1:viewer:true", "logistics:company_user:true"].sort(),
      );
      expect(rows.find((r) => r.email === gB.email && r.module === "kesher")).toMatchObject({ editable: false });
      expect(rows.map((r) => r.email)).not.toContain("soldier-c@gmail.com");
      expect(await call(cCmdr, sql`select * from app.company_access_list(${ids.plsr}::uuid)`)).toHaveLength(0);
      expect(await call(cPlntAdmin, sql`select * from app.company_access_list(${ids.plsr}::uuid)`)).toHaveLength(0);
    });

    it("a soldier's previous names are readable by whoever sees the soldier (for the imports), nothing else", async () => {
      const kesherAdmin: TestUser = { authId: randomUUID(), email: "co-kesher-importer@example.com" };
      const [u] = await db.insert(appUsers).values({ email: kesherAdmin.email, authUserId: kesherAdmin.authId }).returning();
      await db.insert(memberships).values({ userId: u!.id, module: "kesher", role: "admin", unitId: null });
      const seen = await as(kesherAdmin, (tx) => tx.select().from(changes));
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((r) => r.field === "full_name" && r.status === "approved")).toBe(true);
      expect(seen.find((r) => r.personId === s.a)?.oldValue).toBe("חייל אלף");
      // a doch1 user of another company doesn't see it
      expect(await as(plntDoch1, (tx) => tx.select().from(changes))).toHaveLength(0);
    });
  });
  describe("standby (כוננות של הפלוגה)", () => {
    const { doch1StandbyTeams: teams, doch1StandbyHolders: holders, doch1StandbyMembers: teamMembers, doch1Vehicles: vehicles } = schema;
    let roundId = "";
    let team = "";

    beforeAll(async () => {
      roundId = (await db.select().from(rounds).where(eq(rounds.state, "active")))[0]!.id;
    });

    it("a company admin with no דוח 1 role reads their company's round rows and days, not another company's", async () => {
      expect(await as(cAdmin, (tx) => tx.select().from(rounds))).not.toHaveLength(0);
      expect((await as(cAdmin, (tx) => tx.select().from(statuses))).length).toBeGreaterThan(0);
      const ms = await as(cAdmin, (tx) => tx.select().from(members));
      expect(ms.map((m) => m.personId)).toContain(s.a);
      expect(ms.map((m) => m.personId)).not.toContain(s.c);
      expect((await as(cAdmin, (tx) => tx.select().from(days))).every((d) => d.personId !== s.c)).toBe(true);
      // a platoon commander of the module doesn't get this
      expect(await as(cCmdr, (tx) => tx.select().from(members))).toHaveLength(0);
      // and nobody writes דוח 1 days through it
      expect(await as(cAdmin, (tx) => tx.update(days).set({ updatedAt: new Date() }).returning())).toHaveLength(0);
      expect(await as(cAdmin, (tx) => tx.update(members).set({ notes: "x" }).returning())).toHaveLength(0);
    });

    it("the company admin builds the company's own team: its holder is the company, its soldiers the company's", async () => {
      await rejects(as(cAdmin, (tx) => tx.insert(teams).values({ roundId, name: "כוננות פלנט", unitId: ids.plnt })));
      await rejects(as(cCmdr, (tx) => tx.insert(teams).values({ roundId, name: "כוננות", unitId: ids.plsr })));
      await rejects(as(cAdmin, (tx) => tx.insert(teams).values({ roundId, name: "כוננות גדודית" })));
      const [t] = await as(cAdmin, (tx) => tx.insert(teams).values({ roundId, name: "כיתת כוננות פלסר", unitId: ids.plsr }).returning());
      team = t!.id;
      expect((await db.select().from(holders).where(eq(holders.teamId, team))).map((h) => h.unitId)).toEqual([ids.plsr]);
      await as(cAdmin, (tx) => tx.insert(teamMembers).values({ roundId, teamId: team, personId: s.a, role: "לוחם" }));
      expect(await as(cAdmin, (tx) => tx.select().from(teamMembers).where(eq(teamMembers.teamId, team)))).toHaveLength(1);
      // a soldier of another company, a holder of another company: refused even for a super admin
      await failsWith(as(su, (tx) => tx.insert(teamMembers).values({ roundId, teamId: team, personId: s.c })), "GD005");
      await failsWith(as(su, (tx) => tx.insert(holders).values({ teamId: team, unitId: ids.plnt })), "GD005");
      await as(cAdmin, (tx) => tx.update(teams).set({ name: "כיתת כוננות א" }).where(eq(teams.id, team)));
      expect(await as(cPlntAdmin, (tx) => tx.update(teams).set({ name: "x" }).where(eq(teams.id, team)).returning())).toHaveLength(0);
      expect(await as(cPlntAdmin, (tx) => tx.select().from(teams).where(eq(teams.id, team)))).toHaveLength(0);
    });

    it("vehicles: the company adds its own and uses only its own; only a דוח 1 admin moves one between companies", async () => {
      const [mine] = await as(cAdmin, (tx) => tx.insert(vehicles).values({ number: "CO-777", unitId: ids.plsr }).returning());
      await rejects(as(cAdmin, (tx) => tx.insert(vehicles).values({ number: "CO-778" })));
      await rejects(as(cAdmin, (tx) => tx.insert(vehicles).values({ number: "CO-779", unitId: ids.plnt })));
      const [battalion] = await as(su, (tx) => tx.insert(vehicles).values({ number: "CO-780" }).returning());
      await as(cAdmin, (tx) => tx.update(teams).set({ vehicleId: mine!.id }).where(eq(teams.id, team)));
      await failsWith(as(cAdmin, (tx) => tx.update(teams).set({ vehicleId: battalion!.id }).where(eq(teams.id, team))), "GD005");
      expect((await as(cAdmin, (tx) => tx.select().from(vehicles))).map((v) => v.number)).not.toContain("CO-780");
      expect(await as(cPlntAdmin, (tx) => tx.select().from(vehicles).where(eq(vehicles.id, mine!.id)))).toHaveLength(0);
      await as(cAdmin, (tx) => tx.update(vehicles).set({ state: "service" }).where(eq(vehicles.id, mine!.id)));
      await failsWith(as(cAdmin, (tx) => tx.update(vehicles).set({ unitId: null }).where(eq(vehicles.id, mine!.id))), "GD006");
      await failsWith(as(su, (tx) => tx.update(vehicles).set({ unitId: ids.plnt }).where(eq(vehicles.id, mine!.id))), "GD005");
    });

    it("only a דוח 1 admin moves a team between battalion and a company", async () => {
      await failsWith(as(cAdmin, (tx) => tx.update(teams).set({ unitId: null }).where(eq(teams.id, team))), "GD006");
      await as(su, (tx) => tx.update(teams).set({ unitId: null, vehicleId: null }).where(eq(teams.id, team)));
      // battalion again: the company admin no longer edits it
      expect(await as(cAdmin, (tx) => tx.update(teams).set({ name: "y" }).where(eq(teams.id, team)).returning())).toHaveLength(0);
      await as(su, (tx) => tx.update(teams).set({ unitId: ids.plsr }).where(eq(teams.id, team)));
      expect((await db.select().from(holders).where(eq(holders.teamId, team))).map((h) => h.unitId)).toEqual([ids.plsr]);
    });
  });
});
