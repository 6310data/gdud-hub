/**
 * The one-time step of 0035_company_standby_security: an existing team whose members are all of one
 * company, and that no other company holds, becomes that company's (with its vehicle, if only that company's teams use it); the rest
 * stay battalion. Runs the migrations up to 0034, seeds teams, then applies the rest.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vitest";
import * as schema from "../src/schema/index";
import { SUPABASE_SHIM_SQL } from "./supabase-shim";

const here = path.dirname(fileURLToPath(import.meta.url));
const { units, people, doch1Rounds, doch1Members, doch1Vehicles, doch1StandbyTeams, doch1StandbyHolders, doch1StandbyMembers } = schema;

it("gives a one-company team (and its unshared vehicle) to the company; shared ones stay battalion", async () => {
  const full = path.join(here, "../migrations");
  const partial = mkdtempSync(path.join(tmpdir(), "gdud-migrations-"));
  cpSync(full, partial, { recursive: true });
  const journalPath = path.join(partial, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const cut = journal.entries.findIndex((e) => e.tag.startsWith("0035_"));
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }));

  const pg = new PGlite();
  await pg.exec(SUPABASE_SHIM_SQL);
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: partial });

  const [bat] = await db.insert(units).values({ kind: "battalion", name: "גדוד" }).returning();
  const [a, b] = await db
    .insert(units)
    .values([
      { parentId: bat!.id, kind: "company", name: "א" },
      { parentId: bat!.id, kind: "company", name: "ב" },
    ])
    .returning();
  const [a1] = await db.insert(units).values({ parentId: a!.id, kind: "platoon", name: "א1" }).returning();
  const [pa, pa1, pa2, pb, pb2] = await db
    .insert(people)
    .values([
      { unitId: a!.id, fullName: "א" },
      { unitId: a1!.id, fullName: "א1" },
      { unitId: a1!.id, fullName: "א2" },
      { unitId: b!.id, fullName: "ב" },
      { unitId: b!.id, fullName: "ב2" },
    ])
    .returning();
  const [round] = await db.insert(doch1Rounds).values({ name: "ס", startsOn: "2026-10-01", endsOn: "2026-11-01", state: "active" }).returning();
  await db.insert(doch1Members).values([pa, pa1, pa2, pb, pb2].map((p) => ({ roundId: round!.id, personId: p!.id })));
  const [own, shared, mixedV] = await db.insert(doch1Vehicles).values([{ number: "1" }, { number: "2" }, { number: "3" }]).returning();
  const [tA, tA2, tAB, tShared] = await db
    .insert(doch1StandbyTeams)
    .values([
      { roundId: round!.id, name: "של א", vehicleId: own!.id },
      { roundId: round!.id, name: "של א עם רכב משותף", vehicleId: shared!.id },
      { roundId: round!.id, name: "א + ב", vehicleId: mixedV!.id },
      { roundId: round!.id, name: "של ב עם רכב משותף", vehicleId: shared!.id },
    ])
    .returning();
  await db.insert(doch1StandbyHolders).values([
    { teamId: tA!.id, unitId: a!.id },
    { teamId: tAB!.id, unitId: a!.id },
    { teamId: tAB!.id, unitId: b!.id },
  ]);
  await db.insert(doch1StandbyMembers).values([
    { roundId: round!.id, teamId: tA!.id, personId: pa!.id },
    { roundId: round!.id, teamId: tA!.id, personId: pa1!.id },
    { roundId: round!.id, teamId: tA2!.id, personId: pa2!.id },
    { roundId: round!.id, teamId: tAB!.id, personId: pb!.id },
    { roundId: round!.id, teamId: tShared!.id, personId: pb2!.id },
  ]);

  await migrate(db, { migrationsFolder: full });

  const team = async (id: string) => (await db.select().from(doch1StandbyTeams).where(eq(doch1StandbyTeams.id, id)))[0]!;
  const vehicle = async (id: string) => (await db.select().from(doch1Vehicles).where(eq(doch1Vehicles.id, id)))[0]!;
  const holdersOf = async (id: string) => (await db.select().from(doch1StandbyHolders).where(eq(doch1StandbyHolders.teamId, id))).map((h) => h.unitId);

  expect((await team(tA!.id)).unitId).toBe(a!.id);
  expect((await vehicle(own!.id)).unitId).toBe(a!.id);
  expect(await holdersOf(tA!.id)).toEqual([a!.id]);
  // the vehicle is shared with company ב's team: both teams stay battalion, the vehicle too
  expect((await team(tA2!.id)).unitId).toBeNull();
  expect((await team(tShared!.id)).unitId).toBeNull();
  expect((await vehicle(shared!.id)).unitId).toBeNull();
  // held by א + ב: stays shared (battalion), whoever its members are
  expect((await team(tAB!.id)).unitId).toBeNull();
  expect((await holdersOf(tAB!.id)).sort()).toEqual([a!.id, b!.id].sort());
});
