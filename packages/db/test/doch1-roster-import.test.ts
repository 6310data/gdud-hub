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
import { parseRoster, planRoster, readRosterFile, RosterImportError, type RosterAnswers, type RosterFile } from "../src/doch1-roster-import/index";
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

describe("planRoster", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { units, people, appUsers, memberships, doch1Rounds: rounds, doch1Members: members, doch1FieldOptions: options, doch1ImportMappings } = schema;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const admin = { sub: randomUUID(), email: "roster-admin@example.com" };
  const clerk = { sub: randomUUID(), email: "roster-clerk@example.com" };
  const ids = { plsr: "", plsr1: "", plsr2: "", plnt: "" };
  const r = { old: "", active: "", planning: "" };
  const p = { p1: "", p2: "", p3: "", p4: "", p9: "", old: "" };
  const as = <T>(u: { sub: string; email: string }, fn: (tx: Tx) => Promise<T>) => runAsUser(db as never, { sub: u.sub, email: u.email }, fn);
  const plan = (f: RosterFile, answers: RosterAnswers = {}, baseRoundId?: string) =>
    as(admin, (tx) => planRoster(tx, { planningRoundId: r.planning, baseRoundId, file: f, answers }));

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

  beforeAll(async () => {
    const pg = new PGlite();
    await pg.exec(SUPABASE_SHIM_SQL);
    db = drizzle(pg, { schema });
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
    Object.assign(ids, { plsr: plsr!.id, plsr1: plsr1!.id, plsr2: plsr2!.id, plnt: plnt!.id });
    const us = await db
      .insert(appUsers)
      .values([
        { email: admin.email, authUserId: admin.sub },
        { email: clerk.email, authUserId: clerk.sub },
      ])
      .returning();
    await db.insert(memberships).values([
      { userId: us[0]!.id, module: "doch1", role: "admin", unitId: null },
      { userId: us[1]!.id, module: "doch1", role: "company_user", unitId: ids.plsr },
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
    [p.p1, p.p2, p.p3, p.p4, p.p9] = ppl.map((x) => x.id) as [string, string, string, string, string];
    const rs = await db
      .insert(rounds)
      .values([
        { name: "סבב 6", startsOn: "2026-01-01", endsOn: "2026-04-01", state: "closed" },
        { name: "סבב 7", startsOn: "2026-08-23", endsOn: "2026-12-10", state: "active" },
        { name: "סבב 8", startsOn: "2027-03-01", endsOn: "2027-06-30", state: "planning" },
      ])
      .returning();
    [r.old, r.active, r.planning] = rs.map((x) => x.id) as [string, string, string];
    await db.insert(members).values([
      ...[p.p1, p.p2, p.p3, p.p4].map((personId) => ({ roundId: r.active, personId })),
      { roundId: r.old, personId: p.p9 },
    ]);
    await db.insert(options).values([
      { roundId: r.planning, field: "arrival", name: "מגיע", effect: "arriving" },
      { roundId: r.planning, field: "arrival", name: "לא מגיע", effect: "not_arriving" },
    ]);
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
