/**
 * The battalion's soldier list (src/doch1-roster-import): reading xlsx / csv in the אלפון layout,
 * and comparing it with the base round on the real migrations (PGlite). Invented data only.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyRoster,
  copyFromRound,
  corrections,
  correctionsWorkbook,
  parseRoster,
  planRoster,
  readRosterFile,
  RosterImportError,
  type RosterAnswers,
  type RosterDecisions,
  type RosterFile,
  parseBrigadeList,
} from "../src/doch1-roster-import/index";
import { readWorkbook } from "../src/doch1-import/read";
import { runAsUser, type Tx } from "../src/index";
import * as schema from "../src/schema/index";
import { SUPABASE_SHIM_SQL } from "./supabase-shim";

type Cell = string | number | Date | null;
const HEADERS = ["שם מלא", "מספר אישי", "שם פרטי", "שם משפחה", "פלוגה", "מחלקה", "מקצוע", "לכמה סבבים הגיע", "מספר טלפון", "גיל", "האם קצין", "תפקיד בפועל"];
const row = (pn: Cell, first: string, last: string, company: string, platoon: string, phone: Cell = null, role: string | null = null): Cell[] => [
  `${first} ${last}`,
  pn,
  first,
  last,
  company,
  platoon,
  "רובאי",
  3,
  phone,
  30,
  "לא",
  role,
];

async function xlsx(rows: Cell[][], opts: { headers?: string[]; title?: boolean } = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("אלפון");
  if (opts.title) ws.addRow(["רשימת חיילים לסבב 8"]);
  ws.addRow(opts.headers ?? HEADERS);
  for (const r of rows) ws.addRow(r);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const file = async (rows: Cell[][], opts?: { headers?: string[]; title?: boolean }): Promise<RosterFile> =>
  parseRoster(await readRosterFile(await xlsx(rows, opts), "list.xlsx"));

describe("reading the file", () => {
  it("finds the header row and the columns by header text, in any order", async () => {
    const headers = [...HEADERS];
    [headers[4], headers[8]] = [headers[8]!, headers[4]!]; // פלוגה ↔ מספר טלפון
    headers[11] = "תפקיד\nבפועל";
    const r = row(8000001, "דנה", "בדויה", "פלס״ר", "מחלקה 1", "0501234567", "קשר");
    [r[4], r[8]] = [r[8]!, r[4]!];
    const parsed = await file([r], { headers, title: true });
    expect(parsed.rows).toEqual([
      expect.objectContaining({ line: 3, personalNumber: "8000001", fullName: "דנה בדויה", company: "פלס״ר", platoon: "מחלקה 1", phone: "0501234567", role: "קשר" }),
    ]);
  });

  it("reads optional צפי הגעה and תאריך גיוס columns", async () => {
    const parsed = await file([[...row(8000001, "דנה", "בדויה", "פלס״ר", ""), "לא מגיע", "06.09.2026"]], {
      headers: [...HEADERS, "צפי הגעה", "תאריך גיוס"],
    });
    expect(parsed.rows[0]).toMatchObject({ arrival: "לא מגיע", callUpOn: "2026-09-06" });
  });

  it("reads csv (with a BOM, quotes and commas inside quotes) the same way", async () => {
    const csv = `﻿${HEADERS.join(",")}\n"בדויה, דנה",8000001,דנה,בדויה,"פלס""ר",מחלקה 1,רובאי,3,0501234567,30,לא,קשר\n`;
    const parsed = parseRoster(await readRosterFile(new TextEncoder().encode(csv), "list.csv"));
    expect(parsed.rows[0]).toMatchObject({ personalNumber: "8000001", fullName: "בדויה, דנה", company: 'פלס"ר', role: "קשר" });
  });

  it("a file without a personal-number header is refused", async () => {
    await expect(readRosterFile(await xlsx([["x"]], { headers: ["שם", "טלפון"] }), "list.xlsx").then(parseRoster)).rejects.toThrow(RosterImportError);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const { units, people, appUsers, memberships, doch1Rounds: rounds, doch1Members: members, doch1FieldOptions: options, doch1ImportMappings, doch1Locations: locations } =
  schema;
type Db = ReturnType<typeof drizzle<typeof schema>>;
const admin = { sub: randomUUID(), email: "roster-admin@example.com" };
const d1Only = { sub: randomUUID(), email: "roster-d1-only@example.com" };
const clerk = { sub: randomUUID(), email: "roster-clerk@example.com" };

/**
 * Companies פלס״ר (מחלקה 1, מחלקה 2) and פלנ״ט; rounds 6 (closed), 7 (active), 8 (planning, call-up
 * 08.03.2027); p1–p4 in round 7 (p4 without a personal number), p9 only in round 6.
 */
async function seed() {
  const pg = new PGlite();
  await pg.exec(SUPABASE_SHIM_SQL);
  const db: Db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(here, "../migrations") });
  const [bat] = await db.insert(units).values({ kind: "battalion", name: "גדוד" }).returning();
  const [plsr, plnt] = await db
    .insert(units)
    .values([
      { parentId: bat!.id, kind: "company", name: "פלס״ר" },
      { parentId: bat!.id, kind: "company", name: "פלנ״ט" },
    ])
    .returning();
  const [plsr1, plsr2] = await db
    .insert(units)
    .values([
      { parentId: plsr!.id, kind: "platoon", name: "מחלקה 1" },
      { parentId: plsr!.id, kind: "platoon", name: "מחלקה 2" },
    ])
    .returning();
  const ids = { plsr: plsr!.id, plsr1: plsr1!.id, plsr2: plsr2!.id, plnt: plnt!.id };
  const us = await db
    .insert(appUsers)
    .values([admin, d1Only, clerk].map((u) => ({ email: u.email, authUserId: u.sub })))
    .returning();
  await db.insert(memberships).values([
    { userId: us[0]!.id, module: "doch1", role: "admin", unitId: null },
    { userId: us[0]!.id, module: "core", role: "admin", unitId: null },
    { userId: us[1]!.id, module: "doch1", role: "admin", unitId: null },
    { userId: us[2]!.id, module: "doch1", role: "company_user", unitId: ids.plsr },
  ]);
  const ppl = await db
    .insert(people)
    .values([
      { unitId: ids.plsr1, fullName: "דנה בדויה", personalNumber: "8000001", phone: "0500000001" },
      { unitId: ids.plsr1, fullName: "רון ממציא", personalNumber: "8000002", phone: "0500000002" },
      { unitId: ids.plsr1, fullName: "טל דמיוני", personalNumber: "8000003" },
      { unitId: ids.plnt, fullName: "בלי מספר" },
      { unitId: ids.plnt, fullName: "חוזר מסבב קודם", personalNumber: "8000009" },
    ])
    .returning();
  const [p1, p2, p3, p4, p9] = ppl.map((x) => x.id) as [string, string, string, string, string];
  const rs = await db
    .insert(rounds)
    .values([
      { name: "סבב 6", startsOn: "2026-01-01", endsOn: "2026-04-01", state: "closed" },
      { name: "סבב 7", startsOn: "2026-08-23", endsOn: "2026-12-10", state: "active" },
      { name: "סבב 8", startsOn: "2027-03-01", endsOn: "2027-06-30", callUpOn: "2027-03-08", state: "planning" },
    ])
    .returning();
  const [oldRound, active, planning] = rs.map((x) => x.id) as [string, string, string];
  const [activeOutpost] = await db.insert(locations).values({ roundId: active, name: "מוצב 131", kind: "outpost" }).returning();
  const [planningOutpost] = await db.insert(locations).values({ roundId: planning, name: "מוצב 131", kind: "outpost" }).returning();
  await db.insert(members).values([
    { roundId: active, personId: p1, dmhCategory: "לוחם", hasDisc: true, notes: "הערה", locationId: activeOutpost!.id },
    ...[p2, p3, p4].map((personId) => ({ roundId: active, personId })),
    { roundId: oldRound, personId: p9 },
  ]);
  await db.insert(options).values([
    { roundId: planning, field: "arrival", name: "מגיע", effect: "arriving" },
    { roundId: planning, field: "arrival", name: "לא מגיע", effect: "not_arriving", sortOrder: 1 },
  ]);
  return {
    db,
    ids,
    r: { old: oldRound, active, planning },
    p: { p1, p2, p3, p4, p9 },
    planningOutpost: planningOutpost!.id,
    as: <T>(u: { sub: string; email: string }, fn: (tx: Tx) => Promise<T>) => runAsUser(db as never, { sub: u.sub, email: u.email }, fn),
  };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

// the battalion's list: p1 same, p2 moved to מחלקה 2 with a new phone, p9 back from an older round,
// a new soldier, one twice, one with a bad number; p3 and p4 (no personal number) are not on it
const list = () =>
  file([
    row(8000001, "דנה", "בדויה", "פלס״ר", "מחלקה 1", "050-0000001"),
    row(8000002, "רון", "ממציא", "פלס״ר", "מחלקה 2", "0509999999"),
    row(8000009, "חוזר", "מסבב קודם", "פלנ״ט", ""),
    row(8000010, "חדשה", "לגמרי", "פלנ״ט", ""),
    row(8000010, "חדשה", "לגמרי", "פלנ״ט", ""),
    row("12", "מספר", "שגוי", "פלנ״ט", ""),
  ]);

describe("planRoster", () => {
  let db: Db;
  let ids: Seeded["ids"];
  let r: Seeded["r"];
  let p: Seeded["p"];
  let as: Seeded["as"];
  const plan = (f: RosterFile, answers: RosterAnswers = {}, baseRoundId?: string) =>
    as(admin, (tx) => planRoster(tx, { planningRoundId: r.planning, baseRoundId, file: f, answers }));

  beforeAll(async () => {
    ({ db, ids, r, p, as } = await seed());
  });

  it("compares with the active round and puts every soldier in one group", async () => {
    const res = await plan(await list());
    expect(res).toMatchObject({ baseRoundId: r.active, comparedWith: "base", questions: [] });
    expect(res.diff.unchanged.map((x) => x.member.personId)).toEqual([p.p1]);
    expect(res.diff.changed.map((x) => [x.member.personId, x.fields])).toEqual([[p.p2, ["unit", "phone"]]]);
    expect(res.diff.changed[0]!.row.unitId).toBe(ids.plsr2);
    expect(res.diff.returning.map((x) => x.member.personId)).toEqual([p.p9]);
    expect(res.diff.added.map((x) => [x.personalNumber, x.unitId])).toEqual([["8000010", ids.plnt]]);
    expect(res.diff.missing.map((m) => m.personId).sort()).toEqual([p.p3, p.p4].sort());
    expect(res.diff.problems.map((x) => x.line)).toEqual([6, 7]);
  });

  it("knows who is in the active round (their company moves wait for activation)", async () => {
    const res = await plan(await list());
    expect([...res.inActiveRound].sort()).toEqual([p.p1, p.p2, p.p3, p.p4].sort());
  });

  it("compares with another round when asked", async () => {
    const res = await plan(await list(), {}, r.old);
    expect(res.baseRoundId).toBe(r.old);
    expect(res.diff.unchanged.map((x) => x.member.personId)).toEqual([p.p9]);
    expect(res.diff.returning.map((x) => x.member.personId).sort()).toEqual([p.p1, p.p2].sort());
  });

  it("an unknown company or platoon is a question, and its rows wait for the answer", async () => {
    const f = await file([row(8000001, "דנה", "בדויה", "פלס״ר", "מחלקה 7"), row(8000011, "גל", "בדוי", "פלוגה חדשה", "")]);
    const res = await plan(f);
    expect(res.questions).toEqual([
      expect.objectContaining({ kind: "platoon", key: `${ids.plsr}|מחלקה 7`, label: "פלס״ר · מחלקה 7", suggestion: "create" }),
      expect.objectContaining({ kind: "company", key: "פלוגה חדשה", suggestion: "ignore" }),
    ]);
    expect(res.waiting).toBe(2);
    expect(res.diff.problems).toEqual([]);
    const answered = await plan(f, { platoons: { [`${ids.plsr}|מחלקה 7`]: "company" }, companies: { "פלוגה חדשה": "ignore" } });
    expect(answered.questions).toEqual([]);
    expect(answered.diff.changed.map((x) => [x.member.personId, x.row.unitId])).toEqual([[p.p1, ids.plsr]]);
    expect(answered.warnings.some((w) => w.includes("פלוגה חדשה"))).toBe(true);
  });

  it("maps צפי הגעה to the planning round's list; an unknown value is a question", async () => {
    const f = await file(
      [
        [...row(8000001, "דנה", "בדויה", "פלס״ר", "מחלקה 1"), "לא  מגיע"],
        [...row(8000002, "רון", "ממציא", "פלס״ר", "מחלקה 1"), "אולי"],
      ],
      { headers: [...HEADERS, "צפי הגעה"] },
    );
    const res = await plan(f);
    expect(res.questions).toEqual([expect.objectContaining({ kind: "arrival", key: "אולי", suggestion: "create:arriving" })]);
    const [notArriving] = await db.select().from(options).where(eq(options.name, "לא מגיע"));
    expect(res.arrival.get("8000001")).toBe(notArriving!.id);
  });

  it("reads only: nothing is written", async () => {
    const before = await Promise.all([db.select({ n: count() }).from(people), db.select({ n: count() }).from(members), db.select({ n: count() }).from(doch1ImportMappings)]);
    await plan(await list(), { platoons: { x: "create" } });
    const after = await Promise.all([db.select({ n: count() }).from(people), db.select({ n: count() }).from(members), db.select({ n: count() }).from(doch1ImportMappings)]);
    expect(after).toEqual(before);
  });

  it("once the planning round has soldiers, a re-run compares with them", async () => {
    await db.insert(members).values([p.p1, p.p2].map((personId) => ({ roundId: r.planning, personId })));
    const res = await plan(await list());
    expect(res.comparedWith).toBe("planning");
    expect(res.diff.missing).toEqual([]);
    expect(res.diff.returning.map((x) => x.member.personId)).toEqual([p.p9]);
    await db.delete(members).where(eq(members.roundId, r.planning));
  });

  it("battalion admin only, and only for a round being planned", async () => {
    await expect(as(clerk, (tx) => planRoster(tx, { planningRoundId: r.planning, file: { rows: [], warnings: [] }, answers: {} }))).rejects.toThrow(RosterImportError);
    await expect(plan(await list(), {}, r.planning)).rejects.toThrow(RosterImportError);
    await expect(as(admin, (tx) => planRoster(tx, { planningRoundId: r.active, file: { rows: [], warnings: [] }, answers: {} }))).rejects.toThrow(RosterImportError);
  });
});

describe("applyRoster", () => {
  let db: Db;
  let ids: Seeded["ids"];
  let r: Seeded["r"];
  let p: Seeded["p"];
  let as: Seeded["as"];
  let planningOutpost = "";
  const apply = (f: RosterFile, decisions: RosterDecisions, answers: RosterAnswers = {}, u = admin) =>
    as(u, (tx) => applyRoster(tx, { planningRoundId: r.planning, file: f, answers, decisions }));
  const planned = async () => db.select().from(members).where(eq(members.roundId, r.planning));
  const person = async (id: string) => (await db.select().from(people).where(eq(people.id, id)))[0]!;

  beforeAll(async () => {
    ({ db, ids, r, p, as, planningOutpost } = await seed());
  });

  it("battalion admin only", async () => {
    await expect(apply(await list(), { add: [], take: {}, keepMissing: [] }, {}, clerk)).rejects.toThrow(RosterImportError);
  });

  it("first run: keep our values for רון, keep טל, leave the new soldier out", async () => {
    const counts = await apply(await list(), { add: ["8000009"], take: {}, keepMissing: [p.p3] });
    expect(counts).toMatchObject({ created: 0, updated: 0, members: 4, removed: 0, pendingMoves: 0 });
    expect((await planned()).map((m) => m.personId).sort()).toEqual([p.p1, p.p2, p.p9, p.p3].sort());
    expect(await person(p.p2)).toMatchObject({ unitId: ids.plsr1, phone: "0500000002" });
    // the base round's fields come along; the location is the planning round's of the same name
    const m1 = (await planned()).find((m) => m.personId === p.p1)!;
    expect(m1).toMatchObject({ callUpOn: "2027-03-08", dmhCategory: "לוחם", hasDisc: true, notes: "הערה", locationId: planningOutpost, plannedUnitId: null });
    // the running round is untouched
    expect(await db.select().from(members).where(eq(members.roundId, r.active))).toHaveLength(4);
  });

  it("re-run with the battalion's values: a move of a soldier in the running round waits; a dropped soldier leaves", async () => {
    const counts = await apply(await list(), { add: ["8000009", "8000010"], take: { "8000002": ["unit", "phone"] }, keepMissing: [] });
    expect(counts).toMatchObject({ created: 1, updated: 1, members: 4, removed: 1, pendingMoves: 1 });
    expect(await person(p.p2)).toMatchObject({ unitId: ids.plsr1, phone: "0509999999" });
    const rows = await planned();
    expect(rows.find((m) => m.personId === p.p2)!.plannedUnitId).toBe(ids.plsr2);
    expect(rows.some((m) => m.personId === p.p3)).toBe(false);
    const [fresh] = await db.select().from(people).where(eq(people.personalNumber, "8000010"));
    expect(fresh).toMatchObject({ fullName: "חדשה לגמרי", unitId: ids.plnt });
    expect(rows.find((m) => m.personId === fresh!.id)).toMatchObject({ callUpOn: "2027-03-08", plannedUnitId: null });
  });

  it("refuses with open questions", async () => {
    const f = await file([row(8000001, "דנה", "בדויה", "פלוגה חדשה", "")]);
    await expect(apply(f, { add: [], take: {}, keepMissing: [] })).rejects.toThrow(RosterImportError);
  });

  it("creates the platoons and צפי הגעה values it was told to, and remembers the answers", async () => {
    const f = await file(
      [
        [...row(8000001, "דנה", "בדויה", "פלס״ר", "מחלקה 7"), "לא מגיע"],
        [...row(8000009, "חוזר", "מסבב קודם", "פלנ״ט", ""), "אולי"],
      ],
      { headers: [...HEADERS, "צפי הגעה"] },
    );
    const answers: RosterAnswers = { platoons: { [`${ids.plsr}|מחלקה 7`]: "create" }, arrival: { אולי: "create:not_arriving" } };
    const decisions: RosterDecisions = { add: [], take: { "8000001": ["unit"] }, keepMissing: [p.p2, p.p9, (await db.select().from(people).where(eq(people.personalNumber, "8000010")))[0]!.id] };
    await expect(apply(f, decisions, answers, d1Only)).rejects.toThrow("ליצירת מחלקות צריך הרשאת מנהל ליבה");
    const counts = await apply(f, decisions, answers);
    expect(counts).toMatchObject({ platoonsCreated: 1, optionsCreated: 1 });
    const [platoon] = await db.select().from(units).where(eq(units.name, "מחלקה 7"));
    expect(platoon).toMatchObject({ parentId: ids.plsr, kind: "platoon" });
    // דנה is in the running round: the move to the new platoon waits
    const rows = await planned();
    expect(rows.find((m) => m.personId === p.p1)!.plannedUnitId).toBe(platoon!.id);
    const arrival = async (personId: string) =>
      (await db.select().from(options).where(eq(options.id, rows.find((m) => m.personId === personId)!.arrivalOptionId!)))[0];
    expect(await arrival(p.p1)).toMatchObject({ name: "לא מגיע", effect: "not_arriving" });
    expect(await arrival(p.p9)).toMatchObject({ name: "אולי", effect: "not_arriving" });
    const again = await as(admin, (tx) => planRoster(tx, { planningRoundId: r.planning, file: f, answers: {} }));
    expect(again.questions).toEqual([]);
    expect(await db.select().from(doch1ImportMappings).where(eq(doch1ImportMappings.roundId, r.planning))).toHaveLength(2);
  });
});

describe("copyFromRound", () => {
  let s: Seeded;
  beforeAll(async () => {
    s = await seed();
  });

  it("adds every soldier of the base round once, with the round's call-up day and their fields", async () => {
    const copy = () => s.as(admin, (tx) => copyFromRound(tx, { planningRoundId: s.r.planning }));
    expect(await copy()).toEqual({ members: 4 });
    expect(await copy()).toEqual({ members: 0 });
    const rows = await s.db.select().from(members).where(eq(members.roundId, s.r.planning));
    expect(rows.map((m) => m.personId).sort()).toEqual([s.p.p1, s.p.p2, s.p.p3, s.p.p4].sort());
    expect(rows.find((m) => m.personId === s.p.p1)).toMatchObject({ callUpOn: "2027-03-08", dmhCategory: "לוחם", locationId: s.planningOutpost });
    await expect(s.as(clerk, (tx) => copyFromRound(tx, { planningRoundId: s.r.planning }))).rejects.toThrow(RosterImportError);
  });
});

describe("the corrections file", () => {
  let s: Seeded;
  beforeAll(async () => {
    s = await seed();
  });

  it("lists every decision that disagrees with the battalion, and reads back as xlsx", async () => {
    const f = await list();
    const plan = await s.as(admin, (tx) => planRoster(tx, { planningRoundId: s.r.planning, file: f, answers: {} }));
    const decisions: RosterDecisions = { add: ["8000009"], take: { "8000002": ["phone"] }, keepMissing: [s.p.p3] };
    const names = new Map([
      [s.ids.plsr1, "פלס״ר / מחלקה 1"],
      [s.ids.plsr2, "פלס״ר / מחלקה 2"],
      [s.ids.plnt, "פלנ״ט"],
    ]);
    const rows = corrections(plan, decisions, (id) => names.get(id) ?? "");
    expect(rows.map((x) => [x.kind, x.personalNumber, x.field, x.battalion, x.ours])).toEqual([
      ["פרט שונה, נשאר אצלנו", "8000002", "פלוגה / מחלקה", "פלס״ר / מחלקה 2", "פלס״ר / מחלקה 1"],
      ["לא ברשימת הגדוד, נשאר בסבב", "8000003", "", "", "פלס״ר / מחלקה 1"],
      ["ברשימת הגדוד, לא נכלל בסבב", "8000010", "", "פלנ״ט", ""],
      ["שורה בעייתית בקובץ", "", "שורה 6", expect.stringContaining("פעמיים"), ""],
      ["שורה בעייתית בקובץ", "", "שורה 7", expect.stringContaining("שגוי"), ""],
    ]);
    const [sheet] = await readWorkbook(await correctionsWorkbook(rows));
    expect(sheet!.rows[0]).toEqual(["סוג", "מספר אישי", "שם", "שדה", "ברשימת הגדוד", "אצלנו"]);
    expect(sheet!.rows).toHaveLength(rows.length + 1);
  });
});

describe("the brigade's call-up list", () => {
  it("finds the header by מספר אישי; a status column is optional", () => {
    const grid = (rows: (string | number | null)[][]) => [{ name: "גיליון1", hidden: false, rows }];
    const withStatus = parseBrigadeList(
      grid([["דוח התייצבות"], ["מ\"א", "שם פרטי", "שם משפחה", "סטטוס"], [1234567, "דנה", "בדויה", "התייצב"], [null, "בלי", "מספר", ""], [7654321, "רון", "ממציא", "טרם התייצב"]]),
    );
    expect(withStatus.hasStatus).toBe(true);
    expect(withStatus.rows).toEqual([
      { line: 3, personalNumber: "1234567", name: "דנה בדויה", status: "התייצב" },
      { line: 5, personalNumber: "7654321", name: "רון ממציא", status: "טרם התייצב" },
    ]);
    expect(withStatus.warnings).toEqual(["1 שורות בלי מספר אישי לא נבדקו."]);
    const plain = parseBrigadeList(grid([["שם מלא", "מספר אישי"], ["טל דמיוני", "0001111111"]]));
    expect(plain).toMatchObject({ hasStatus: false, rows: [{ personalNumber: "0001111111", name: "טל דמיוני", status: "" }] });
    expect(() => parseBrigadeList(grid([["שם"], ["x"]]))).toThrow(/מספר אישי/);
  });
});
