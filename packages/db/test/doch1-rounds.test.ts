/**
 * Creating a planning round (src/doch1-rounds): what it copies from the latest round, run as the
 * battalion doch1 admin on the real migrations (PGlite).
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { createPlanningRound } from "../src/doch1-rounds/index";
import { runAsUser, type JwtClaims } from "../src/index";
import * as schema from "../src/schema/index";
import { SUPABASE_SHIM_SQL } from "./supabase-shim";

const here = path.dirname(fileURLToPath(import.meta.url));
const { units, appUsers, memberships, doch1Rounds: rounds, doch1RoundCompanies: roundCompanies, doch1Statuses: statuses } = schema;
const { doch1FieldOptions: options, doch1Locations: locations, doch1StandbyTypes: standbyTypes } = schema;

let db: ReturnType<typeof drizzle<typeof schema>>;
const admin = { sub: randomUUID(), email: "d1-admin@example.com" };
const clerk = { sub: randomUUID(), email: "d1-clerk@example.com" };
const claims = (u: { sub: string; email: string }): JwtClaims => ({
  sub: u.sub,
  email: u.email,
  app_metadata: { provider: "google" },
  user_metadata: { email_verified: true },
});
const NEW = { name: "סבב 8", startsOn: "2027-03-01", endsOn: "2027-06-30", callUpOn: "2027-03-08", reminderAt: "09:00", lockAt: "10:00", sendAt: "10:15" };

let oldClosed = "";
let current = "";
let plsr = "";
let plnt = "";

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(SUPABASE_SHIM_SQL);
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(here, "../migrations") });
  const [bat] = await db.insert(units).values({ kind: "battalion", name: "גדוד" }).returning();
  const cs = await db
    .insert(units)
    .values([
      { parentId: bat!.id, kind: "company", name: "פלס״ר" },
      { parentId: bat!.id, kind: "company", name: "פלנ״ט" },
    ])
    .returning();
  plsr = cs[0]!.id;
  plnt = cs[1]!.id;
  const us = await db
    .insert(appUsers)
    .values([
      { email: admin.email, authUserId: admin.sub },
      { email: clerk.email, authUserId: clerk.sub },
    ])
    .returning();
  await db.insert(memberships).values([
    { userId: us[0]!.id, module: "doch1", role: "admin", unitId: null },
    { userId: us[1]!.id, module: "doch1", role: "company_user", unitId: plsr },
  ]);

  const rs = await db
    .insert(rounds)
    .values([
      { name: "סבב 6", startsOn: "2026-01-01", endsOn: "2026-04-01", state: "closed" },
      { name: "סבב 7", startsOn: "2026-08-23", endsOn: "2026-12-10", state: "active" },
    ])
    .returning();
  oldClosed = rs[0]!.id;
  current = rs[1]!.id;
  await db.insert(roundCompanies).values([
    { roundId: current, unitId: plsr, appFrom: "2026-10-01" },
    { roundId: current, unitId: plnt, active: false },
    { roundId: oldClosed, unitId: plsr },
  ]);
  const [oldVersion] = await db
    .insert(statuses)
    .values({ roundId: current, name: "עזה", color: "#e07b2e", displayGroup: "עזה", sheetValue: "עזה", active: false })
    .returning();
  await db.insert(statuses).values([
    { roundId: current, name: "עזה", color: "#e07b2e", displayGroup: "עזה", sheetValue: "עזה", countsInSadak: true, countsAsPresent: true, replacesId: oldVersion!.id, sortOrder: 1 },
    { roundId: current, name: "לא בשמ״פ", color: "#7a8699", displayGroup: "אחר", sheetValue: "0", offDuty: true, sortOrder: 2 },
    { roundId: oldClosed, name: "ישן", color: "#000000", displayGroup: "ישן", sheetValue: "ישן" },
  ]);
  await db.insert(options).values([
    { roundId: current, field: "arrival", name: "מגיע", effect: "arriving" },
    { roundId: current, field: "arrival", name: "לא מגיע", effect: "not_arriving", sortOrder: 1 },
    { roundId: current, field: "enlistment", name: "התייצב", effect: "arrived" },
  ]);
  await db.insert(locations).values([
    { roundId: current, name: "מוצב 131", kind: "outpost" },
    { roundId: current, name: "מיוערת", kind: "camp", active: false },
  ]);
  await db.insert(standbyTypes).values({ roundId: current, name: "עתודת גדוד", level: "battalion", size: 8, requiredRoles: ["מ״פ / סמ״פ"] });
});

describe("createPlanningRound", () => {
  it("only the battalion admin creates one", async () => {
    await expect(runAsUser(db as never, claims(clerk), (tx) => createPlanningRound(tx, NEW))).rejects.toThrow();
  });

  it("creates a planning round and copies the latest round's settings", async () => {
    const res = await runAsUser(db as never, claims(admin), (tx) => createPlanningRound(tx, NEW));
    expect(res.copiedFrom).toBe(current);
    const [r] = await db.select().from(rounds).where(eq(rounds.id, res.id));
    expect(r).toMatchObject({ ...NEW, reminderAt: "09:00:00", lockAt: "10:00:00", sendAt: "10:15:00", state: "planning", active: false });

    const rc = await db.select().from(roundCompanies).where(eq(roundCompanies.roundId, res.id));
    // "active in the round" carries over; the pilot date doesn't
    expect(rc.map((c) => [c.unitId, c.active, c.appFrom]).sort()).toEqual([[plnt, false, null], [plsr, true, null]].sort());

    const st = await db.select().from(statuses).where(eq(statuses.roundId, res.id));
    expect(st.map((s) => s.name).sort()).toEqual(["לא בשמ״פ", "עזה"]); // the current versions only
    expect(st.every((s) => s.active && s.replacesId === null)).toBe(true);
    expect(st.find((s) => s.name === "עזה")).toMatchObject({ countsInSadak: true, countsAsPresent: true, sortOrder: 1 });

    const os = await db.select().from(options).where(eq(options.roundId, res.id));
    expect(os.map((o) => [o.field, o.name, o.effect, o.sortOrder]).sort()).toEqual(
      [
        ["arrival", "מגיע", "arriving", 0],
        ["arrival", "לא מגיע", "not_arriving", 1],
        ["enlistment", "התייצב", "arrived", 0],
      ].sort(),
    );

    const ls = await db.select().from(locations).where(eq(locations.roundId, res.id));
    expect(ls.map((l) => [l.name, l.kind, l.active]).sort()).toEqual([["מוצב 131", "outpost", true], ["מיוערת", "camp", false]].sort());
    const ts = await db.select().from(standbyTypes).where(eq(standbyTypes.roundId, res.id));
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ name: "עתודת גדוד", level: "battalion", size: 8, requiredRoles: ["מ״פ / סמ״פ"] });

    // the source round is untouched
    expect(await db.select().from(options).where(eq(options.roundId, current))).toHaveLength(3);
  });

  it("a second planning round is refused", async () => {
    await expect(runAsUser(db as never, claims(admin), (tx) => createPlanningRound(tx, { ...NEW, name: "עוד" }))).rejects.toThrow();
  });
});
