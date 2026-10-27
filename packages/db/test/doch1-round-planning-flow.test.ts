/**
 * The whole round-planning flow on the real migrations (PGlite), as the battalion admin and a
 * company user would run it: new round → the battalion's list → צפי הגעה → activation. The
 * screens call these same functions; this checks they fit together. Invented data only.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { inService } from "@gdud/core";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vitest";
import { applyRoster, parseRoster, readRosterFile } from "../src/doch1-roster-import/index";
import { activateRound, createPlanningRound } from "../src/doch1-rounds/index";
import { runAsUser, type JwtClaims, type Tx } from "../src/index";
import * as schema from "../src/schema/index";
import { SUPABASE_SHIM_SQL } from "./supabase-shim";

const here = path.dirname(fileURLToPath(import.meta.url));
const { units, people, appUsers, memberships, doch1Rounds: rounds, doch1Members: members, doch1FieldOptions: options } = schema;
const claims = (u: { sub: string; email: string }): JwtClaims => ({ sub: u.sub, email: u.email, app_metadata: { provider: "google" }, user_metadata: { email_verified: true } });

it("new round → battalion list → צפי הגעה → activation", async () => {
  const pg = new PGlite();
  await pg.exec(SUPABASE_SHIM_SQL);
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(here, "../migrations") });
  const admin = { sub: randomUUID(), email: "flow-admin@example.com" };
  const clerk = { sub: randomUUID(), email: "flow-clerk@example.com" };
  const [bat] = await db.insert(units).values({ kind: "battalion", name: "גדוד" }).returning();
  const [plsr, plnt] = await db
    .insert(units)
    .values([
      { parentId: bat!.id, kind: "company", name: "פלס״ר" },
      { parentId: bat!.id, kind: "company", name: "פלנ״ט" },
    ])
    .returning();
  const us = await db.insert(appUsers).values([admin, clerk].map((u) => ({ email: u.email, authUserId: u.sub }))).returning();
  await db.insert(memberships).values([
    { userId: us[0]!.id, module: "doch1", role: "admin", unitId: null },
    { userId: us[1]!.id, module: "doch1", role: "company_user", unitId: plsr!.id },
  ]);
  const [stays, moves] = await db
    .insert(people)
    .values([
      { unitId: plsr!.id, fullName: "נשאר בפלס״ר", personalNumber: "9000001" },
      { unitId: plsr!.id, fullName: "עובר לפלנ״ט", personalNumber: "9000002" },
    ])
    .returning();
  const [round7] = await db.insert(rounds).values({ name: "סבב 7", startsOn: "2026-08-23", endsOn: "2026-12-10", state: "active" }).returning();
  await db.insert(schema.doch1RoundCompanies).values([{ roundId: round7!.id, unitId: plsr!.id }, { roundId: round7!.id, unitId: plnt!.id }]);
  await db.insert(options).values([
    { roundId: round7!.id, field: "arrival", name: "מגיע", effect: "arriving" },
    { roundId: round7!.id, field: "arrival", name: "לא מגיע", effect: "not_arriving", sortOrder: 1 },
  ]);
  await db.insert(members).values([stays!, moves!].map((p) => ({ roundId: round7!.id, personId: p.id, callUpOn: "2026-09-06" })));
  const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => runAsUser(db as never, claims(admin), fn);

  // 1. the next round, with the current one's settings
  const { id: round8 } = await asAdmin((tx) =>
    createPlanningRound(tx, { name: "סבב 8", startsOn: "2027-03-01", endsOn: "2027-06-30", callUpOn: "2027-03-08", reminderAt: "09:00", lockAt: "10:00", sendAt: "10:15" }),
  );

  // 2. the battalion's list moves one soldier to פלנ״ט; the admin takes it
  const csv = `מספר אישי,שם מלא,פלוגה,מחלקה\n9000001,נשאר בפלס״ר,פלס״ר,\n9000002,עובר לפלנ״ט,פלנ״ט,\n`;
  const file = parseRoster(await readRosterFile(new TextEncoder().encode(csv), "list.csv"));
  const applied = await asAdmin((tx) =>
    applyRoster(tx, { planningRoundId: round8, file, answers: {}, decisions: { add: [], take: { "9000002": ["unit"] }, keepMissing: [] } }),
  );
  expect(applied).toMatchObject({ members: 2, pendingMoves: 1 });
  // the running round is untouched: the soldier is still in פלס״ר
  expect((await db.select().from(people).where(eq(people.id, moves!.id)))[0]!.unitId).toBe(plsr!.id);

  // 3. the company user marks their soldier "לא מגיע" in the new round
  const [notArriving] = await db.select().from(options).where(and(eq(options.roundId, round8), eq(options.name, "לא מגיע")));
  const marked = await runAsUser(db as never, claims(clerk), (tx) =>
    tx
      .update(members)
      .set({ arrivalOptionId: notArriving!.id })
      .where(and(eq(members.roundId, round8), eq(members.personId, stays!.id)))
      .returning(),
  );
  expect(marked).toHaveLength(1);

  // 4. activation
  expect(await asAdmin((tx) => activateRound(tx, round8))).toEqual({ closedRoundId: round7!.id, moved: 1 });
  expect((await db.select().from(people).where(eq(people.id, moves!.id)))[0]!.unitId).toBe(plnt!.id);
  const [r7] = await db.select().from(rounds).where(eq(rounds.id, round7!.id));
  expect(r7!.state).toBe("closed");

  // the not-arriving soldier is listed on no day of the new round; the other one is
  const listed = await db
    .select({
      personId: members.personId,
      callUpOn: members.callUpOn,
      releasedOn: members.releasedOn,
      arriving: sql<boolean>`not exists (select 1 from ${options} where ${options.id} = ${members.arrivalOptionId} and ${options.effect} = 'not_arriving')`,
    })
    .from(members)
    .where(eq(members.roundId, round8));
  expect(listed.filter((m) => inService(m, "2027-03-10")).map((m) => m.personId)).toEqual([moves!.id]);
});
