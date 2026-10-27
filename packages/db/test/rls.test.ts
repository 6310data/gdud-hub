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
      .values({ name: "סבב בדיקה", startsOn: addDays(today, -30), endsOn: addDays(today, 30), lockAt: "23:59:59", active: true })
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
