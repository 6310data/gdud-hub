/**
 * The דוח 1 sheet import (src/doch1-import): parsing grids built in code, one real xlsx
 * round-trip through exceljs, and plan/apply against the real migrations on PGlite.
 * All names and numbers are invented.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applySheetImport,
  parseSheet,
  planSheetImport,
  readWorkbook,
  type Cell,
  type ImportMappings,
  type ParsedSheet,
  type SheetGrid,
} from "../src/doch1-import/index";
import { runAsUser, type Tx } from "../src/index";
import * as schema from "../src/schema/index";
import { SUPABASE_SHIM_SQL } from "./supabase-shim";

const d = (day: string) => new Date(`${day}T00:00:00Z`);

const HEADERS: Cell[] = [
  "פלוגה",
  "מסגרת",
  "מספר אישי",
  "שם פרטי",
  "שם משפחה",
  "תפקיד בפועל",
  'תפקיד לדמ"ח',
  "טלפון",
  "סטטוס הגעה על\nפי צפי גיוס",
  "תאריך גיוס על פי צפי גיוס",
  "סטטוס גיוס",
  "דיסקית",
  d("2026-10-20"),
  d("2026-10-21"),
  "אבוי למי שנוגע",
  "ימים",
  "הערות",
];

/** A company tab: row 1 = company name, row 2 empty, row 3 headers, soldiers from row 4. */
function companyTab(name: string, rows: Cell[][], headers: Cell[] = HEADERS): SheetGrid {
  return { name, hidden: false, rows: [[name], [], headers, ...rows] };
}

const soldier = (pn: Cell, first: string, last: string, platoon: string, days: [Cell, Cell], extra: Partial<Record<string, Cell>> = {}): Cell[] => [
  "פלוגה",
  platoon,
  pn,
  first,
  last,
  extra.role ?? "לוחם",
  extra.dmh ?? "לוחם",
  extra.phone ?? "0500000001",
  "מגיע מלא",
  d("2026-09-06"),
  "התייצב",
  extra.disc ?? "יש",
  days[0],
  days[1],
  null,
  42,
  extra.notes ?? null,
];

function dropdowns(): SheetGrid {
  const row1: Cell[] = [];
  row1[11] = d("2026-08-23");
  row1[13] = d("2026-12-10");
  return {
    name: "Dropdowns",
    hidden: true,
    rows: [
      row1,
      ["פלוגות", null, null, null, null, null, "סטטוס שנספר", "סטטוס כללי", "רענון", "סטטוס התארגנות", "סטטוס שלא נספר"],
      ["אגם", null, null, null, null, null, "עזה", "עיבוד", "רענון", "התארגנות", 0],
      ["פלסר", null, null, null, null, null, "מיוערת", "עזה", null, "יום התארגנות אחרון", "נפקד"],
      [null, null, null, null, null, null, null, "מיוערת"],
    ],
  };
}

describe("parseSheet", () => {
  it("reads soldiers and day cells by header, not position", () => {
    const swapped = [...HEADERS];
    [swapped[5], swapped[7]] = [swapped[7]!, swapped[5]!];
    const a = companyTab("פלסר", [soldier(1111111, "דנה", "בדויה", "מחלקה 1", ["עזה", "רענון"], { role: "קשר", phone: "0501234567" })]);
    const rowB = soldier(1111111, "דנה", "בדויה", "מחלקה 1", ["עזה", "רענון"], { role: "0501234567", phone: "קשר" });
    const b = companyTab("אגם", [rowB], swapped);
    const parsed = parseSheet([a, b]);
    const [ra, rb] = parsed.tabs.map((t) => t.rows[0]!);
    expect(ra).toMatchObject({ sheetRow: 4, personalNumber: "1111111", firstName: "דנה", lastName: "בדויה", roleTitle: "קשר", phone: "0501234567" });
    expect(rb).toMatchObject({ roleTitle: "קשר", phone: "0501234567" });
    expect(ra!.days.get("2026-10-20")).toBe("עזה");
    expect(ra).toMatchObject({ platoonText: "מחלקה 1", dmhCategory: "לוחם", arrivalForecast: "מגיע מלא", callUpOn: "2026-09-06", enlistmentStatus: "התייצב", hasDisc: true });
    expect(parsed.tabs[0]).toMatchObject({ tabName: "פלסר", key: "פלסר", firstDay: "2026-10-20", lastDay: "2026-10-21" });
  });

  it("treats numeric 0 as '0' and empty as ''", () => {
    const parsed = parseSheet([companyTab("פלסר", [soldier(1111111, "דנה", "בדויה", "", [0, null])])]);
    const row = parsed.tabs[0]!.rows[0]!;
    expect(row.days.get("2026-10-20")).toBe("0");
    expect(row.days.get("2026-10-21")).toBe("");
  });

  it("normalizes personal numbers and skips rows without one", () => {
    const parsed = parseSheet([
      companyTab("פלסר", [
        soldier(" 2222222.0 ", "רון", "ממציא", "", ["עזה", "עזה"]),
        soldier(null, "טל", "דמיוני", "", ["עזה", "עזה"]),
        soldier("#N/A", "", "", "", [null, null]),
      ]),
    ]);
    expect(parsed.tabs[0]!.rows.map((r) => r.personalNumber)).toEqual(["2222222"]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("פלסר");
    expect(parsed.warnings[0]).toContain("5");
  });

  it("stops at the sentinel column and reads notes after it", () => {
    const parsed = parseSheet([companyTab("פלסר", [soldier(1111111, "דנה", "בדויה", "", ["עזה", "עזה"], { notes: "הערה" })])]);
    const tab = parsed.tabs[0]!;
    expect(tab.lastDay).toBe("2026-10-21");
    expect([...tab.rows[0]!.days.keys()]).toEqual(["2026-10-20", "2026-10-21"]);
    expect(tab.rows[0]!.notes).toBe("הערה");
  });

  it("reads status groups and round dates from Dropdowns", () => {
    const parsed = parseSheet([dropdowns(), companyTab("פלסר", [])]);
    const hint = (v: string) => parsed.statusHints.find((h) => h.value === v)?.groups;
    expect(hint("עזה")).toEqual(["present", "general"]);
    expect(hint("0")).toEqual(["notCounted"]);
    expect(hint("רענון")).toEqual(["home"]);
    expect(hint("יום התארגנות אחרון")).toEqual(["org"]);
    expect(hint("מיוערת")).toEqual(["present", "general"]);
    expect(parsed.roundStart).toBe("2026-08-23");
    expect(parsed.roundEnd).toBe("2026-12-10");
    expect(parsed.tabs.map((t) => t.tabName)).toEqual(["פלסר"]);
  });

  it("accepts the old פלתצ column order", () => {
    const old: Cell[] = ["פלוגה", "מסגרת", "מספר אישי", "שם משפחה", "שם פרטי", "טלפון", "תפקיד בפועל", "סטטוס גיוס", d("2026-10-20"), d("2026-10-21"), "אבוי למי שנוגע"];
    const parsed = parseSheet([
      companyTab("פלתצ", [["פלתצ", "מפל״ג", 3333333, "בדוי", "אבי", "0500000003", "נהג", "התייצב", "עזה", null, null]], old),
    ]);
    expect(parsed.tabs[0]!.rows[0]).toMatchObject({ firstName: "אבי", lastName: "בדוי", roleTitle: "נהג", dmhCategory: "", phone: "0500000003", platoonText: "מפל״ג", hasDisc: null });
  });

  it("treats invalid dates as empty instead of failing", () => {
    const headers = [...HEADERS];
    headers.splice(13, 0, new Date(Number.NaN)); // a broken header date right after the first day
    const row = soldier(1111111, "דנה", "בדויה", "", ["עזה", "עזה"]);
    row[9] = new Date(Number.NaN); // call-up date
    const parsed = parseSheet([companyTab("פלסר", [row], headers)]);
    expect(parsed.tabs[0]!.rows[0]!.callUpOn).toBeNull();
    expect(parsed.tabs[0]!.firstDay).toBe("2026-10-20");
  });

  it("ignores tabs without a personal-number header or without dates", () => {
    const parsed = parseSheet([{ name: "דוחות", hidden: false, rows: [[], [], ["מספר אישי", "שם"]] }]);
    expect(parsed.tabs).toEqual([]);
  });
});

/** One tab like a Google export: row-3 day headers are formulas with cached date results. */
async function buildXlsx(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("פלסר");
  ws.getRow(1).getCell(1).value = "פלסר";
  ws.getRow(3).values = ["פלוגה", "מסגרת", "מספר אישי", "שם פרטי", "שם משפחה"];
  const c1 = ws.getRow(3).getCell(6);
  c1.value = { formula: "DATE(2026,10,20)", result: d("2026-10-20"), date1904: false };
  c1.numFmt = "dd/mm/yyyy";
  const c2 = ws.getRow(3).getCell(7);
  c2.value = { formula: "F3+1", result: d("2026-10-21"), date1904: false };
  c2.numFmt = "dd/mm/yyyy";
  ws.getRow(3).getCell(8).value = "אבוי למי שנוגע";
  ws.getRow(4).values = ["פלסר", "מחלקה 1", 4444444, "נועה", "סיפורית", "עזה", 0];
  ws.getRow(5).values = ["פלסר", "", { richText: [{ text: "55555" }, { text: "55" }] }, "גל", "אגדה", { formula: "F4", result: "עזה" }, { error: "#N/A" }];
  const hidden = wb.addWorksheet("מוסתר", { state: "hidden" });
  hidden.getCell("A1").value = "x";
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("readWorkbook", () => {
  it("round-trips through a real xlsx buffer", async () => {
    const grids = await readWorkbook(await buildXlsx());
    expect(grids.map((g) => [g.name, g.hidden])).toEqual([["פלסר", false], ["מוסתר", true]]);
    const tab = parseSheet(grids).tabs[0]!;
    expect(tab.firstDay).toBe("2026-10-20");
    expect(tab.lastDay).toBe("2026-10-21");
    expect(tab.rows.map((r) => [r.personalNumber, r.days.get("2026-10-20"), r.days.get("2026-10-21")])).toEqual([
      ["4444444", "עזה", "0"],
      ["5555555", "עזה", ""],
    ]);
  });
});

describe("plan and apply", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { units, people, appUsers, memberships, doch1Rounds, doch1RoundCompanies, doch1Statuses, doch1Members, doch1Days } = schema;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let roundId = "";
  const ids = { bat: "", plsr: "", plsr1: "", plnt: "", pltz: "" };
  const admin = { sub: randomUUID(), email: "import-admin@example.com" };
  const d1Only = { sub: randomUUID(), email: "import-d1-only@example.com" };

  // invented soldiers
  const S1 = (days: [Cell, Cell] = ["עזה", "רענון"]) => soldier(7000001, "דנה", "בדויה", "מחלקה 1", days);
  const S2 = (days: [Cell, Cell] = [0, "עזה"]) => soldier(7000002, "רון", "ממציא", "מפל״ג", days);
  const S3 = () => soldier(7000003, "טל", "דמיוני", "", ["רענון", null]);
  const sheet = (tabs: SheetGrid[]): ParsedSheet => parseSheet([dropdowns(), ...tabs]);
  const baseSheet = () => sheet([companyTab("פלסר", [S1(), S2()]), companyTab("פלנט", [S3()]), companyTab("גדודי", [S1(), S2(), S3()])]);
  const empty: ImportMappings = { tabs: {}, platoons: {}, statuses: {} };

  const asUser = <T>(u: { sub: string; email: string }, fn: (tx: Tx) => Promise<T>) =>
    runAsUser(db as never, { sub: u.sub, email: u.email }, fn);
  const plan = (parsed: ParsedSheet, m: Partial<ImportMappings> = {}) => asUser(admin, (tx) => planSheetImport(tx, roundId, parsed, m));
  const apply = (parsed: ParsedSheet, m: ImportMappings = empty) => asUser(admin, (tx) => applySheetImport(tx, roundId, parsed, m));
  const dayRow = async (pn: string, day: string) => {
    const [p] = await db.select().from(people).where(eq(people.personalNumber, pn));
    const [r] = await db.select().from(doch1Days).where(and(eq(doch1Days.personId, p!.id), eq(doch1Days.day, day)));
    return r;
  };
  const platoonKey = () => `${ids.plsr}|מפלג`;

  beforeAll(async () => {
    const pg = new PGlite();
    await pg.exec(SUPABASE_SHIM_SQL);
    db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: path.join(here, "../migrations") });
    const [bat] = await db.insert(units).values({ kind: "battalion", name: "גדוד" }).returning();
    const [plsr, plnt, pltz] = await db
      .insert(units)
      .values([
        { parentId: bat!.id, kind: "company", name: "פלס״ר", code: "plsr" },
        { parentId: bat!.id, kind: "company", name: "פלנ״ט", code: "plnt" },
        { parentId: bat!.id, kind: "company", name: "פלת״צ", code: "pltz" },
      ])
      .returning();
    const [plsr1] = await db.insert(units).values({ parentId: plsr!.id, kind: "platoon", name: "מחלקה 1" }).returning();
    Object.assign(ids, { bat: bat!.id, plsr: plsr!.id, plsr1: plsr1!.id, plnt: plnt!.id, pltz: pltz!.id });
    const users = await db
      .insert(appUsers)
      .values([
        { email: admin.email, authUserId: admin.sub },
        { email: d1Only.email, authUserId: d1Only.sub },
      ])
      .returning();
    await db.insert(memberships).values([
      { userId: users[0]!.id, module: "doch1", role: "admin", unitId: null },
      { userId: users[0]!.id, module: "core", role: "admin", unitId: null },
      { userId: users[1]!.id, module: "doch1", role: "admin", unitId: null },
    ]);
    const [round] = await db
      .insert(doch1Rounds)
      .values({ name: "סבב 7", startsOn: "2026-08-23", endsOn: "2026-12-10", active: true })
      .returning();
    roundId = round!.id;
    await db.insert(doch1RoundCompanies).values({ roundId, unitId: ids.pltz, active: false });
  });

  it("asks about unknown tabs, platoons and statuses, with suggestions", async () => {
    const p = await plan(baseSheet());
    const q = (kind: string, key: string) => p.questions.find((x) => x.kind === kind && x.key === key);
    expect(q("tab", "גדודי")?.suggestion).toBe("ignore");
    expect(q("platoon", platoonKey())?.suggestion).toBe("create");
    expect(p.questions.filter((x) => x.kind === "status")).toEqual([]); // no statuses yet → all created
    expect(p.questions.some((x) => x.kind === "tab" && x.key === "פלסר")).toBe(false); // matches פלס״ר
    // counts follow the answered mappings only: the open platoon question creates nothing yet
    expect(p.counts).toMatchObject({ newPeople: 3, statusesCreated: 3, platoonsCreated: 0, daysWritten: 5 });
  });

  it("platoon creation needs the core admin role", async () => {
    const m: ImportMappings = { tabs: { גדודי: "ignore" }, platoons: { [platoonKey()]: "create" }, statuses: {} };
    await expect(asUser(d1Only, (tx) => applySheetImport(tx, roundId, baseSheet(), m))).rejects.toThrow("ליצירת מחלקות צריך הרשאת מנהל ליבה");
  });

  it("imports people, members and days; '0' maps to the off-duty status", async () => {
    const progress: string[] = [];
    const m: ImportMappings = { tabs: { גדודי: "ignore" }, platoons: { [platoonKey()]: "create" }, statuses: {} };
    const counts = await asUser(admin, (tx) =>
      applySheetImport(tx, roundId, baseSheet(), m, (phase, done, total) => progress.push(total === undefined ? phase : `${phase} ${done}/${total}`)),
    );
    expect(counts).toMatchObject({ newPeople: 3, updatedPeople: 0, members: 3, daysWritten: 5, daysCleared: 0, statusesCreated: 3, platoonsCreated: 1 });
    expect(progress).toEqual(["match", "structure", "people 0/3", "people 3/3", "members 0/3", "members 3/3", "days 0/5", "days 5/5", "mappings"]);
    const zero = await dayRow("7000002", "2026-10-20");
    const [st] = await db.select().from(doch1Statuses).where(eq(doch1Statuses.id, zero!.statusId));
    expect(st).toMatchObject({ sheetValue: "0", offDuty: true, countsInSadak: false });
    const [gaza] = await db.select().from(doch1Statuses).where(eq(doch1Statuses.sheetValue, "עזה"));
    expect(gaza).toMatchObject({ countsInSadak: true, countsAsPresent: true, generalDay: true, displayGroup: "עזה", color: "#7a8699" });
    const [s2] = await db.select().from(people).where(eq(people.personalNumber, "7000002"));
    const [platoon] = await db.select().from(units).where(eq(units.id, s2!.unitId));
    expect(platoon).toMatchObject({ name: "מפל״ג", parentId: ids.plsr, kind: "platoon" });
    const [s1] = await db.select().from(people).where(eq(people.personalNumber, "7000001"));
    expect(s1).toMatchObject({ fullName: "דנה בדויה", unitId: ids.plsr1, roleTitle: "לוחם", phone: "0500000001" });
    const [m1] = await db.select().from(doch1Members).where(eq(doch1Members.personId, s1!.id));
    expect(m1).toMatchObject({ sheetTab: "פלסר", sheetRow: 4, dmhCategory: "לוחם", callUpOn: "2026-09-06", hasDisc: true, enlistmentStatus: "התייצב" });
    const rc = await db.select().from(doch1RoundCompanies).where(eq(doch1RoundCompanies.roundId, roundId));
    expect(rc.map((r) => r.unitId).sort()).toEqual([ids.plsr, ids.plnt, ids.pltz].sort());
  });

  it("is idempotent", async () => {
    const counts = await apply(baseSheet());
    expect(counts).toMatchObject({ newPeople: 0, updatedPeople: 0, members: 0, daysWritten: 0, daysCleared: 0, statusesCreated: 0, platoonsCreated: 0 });
  });

  it("reuses saved mappings on the next import", async () => {
    expect((await plan(baseSheet())).questions).toEqual([]);
  });

  it("an empty cell clears an existing entry", async () => {
    const counts = await apply(sheet([companyTab("פלסר", [S1(["עזה", null]), S2()]), companyTab("פלנט", [S3()])]));
    expect(counts).toMatchObject({ daysCleared: 1, daysWritten: 0 });
    expect(await dayRow("7000001", "2026-10-21")).toBeUndefined();
  });

  it("pilot company days from app_from are never touched", async () => {
    await db.update(doch1RoundCompanies).set({ appFrom: "2026-10-21" }).where(eq(doch1RoundCompanies.unitId, ids.plsr));
    const counts = await apply(sheet([companyTab("פלסר", [S1(["רענון", "עזה"]), S2([0, null])]), companyTab("פלנט", [S3()])]));
    expect(counts.daysSkippedPilot).toBe(2);
    expect(counts.daysWritten).toBe(1);
    expect(await dayRow("7000001", "2026-10-21")).toBeUndefined();
    expect((await dayRow("7000002", "2026-10-21"))?.statusId).toBeTruthy();
    const [st] = await db.select().from(doch1Statuses).where(eq(doch1Statuses.id, (await dayRow("7000001", "2026-10-20"))!.statusId));
    expect(st!.sheetValue).toBe("רענון");
    await db.update(doch1RoundCompanies).set({ appFrom: null }).where(eq(doch1RoundCompanies.unitId, ids.plsr));
  });

  it("a soldier in two tabs is imported once, into the active company", async () => {
    const p = await plan(sheet([companyTab("פלתצ", [S2()]), companyTab("פלסר", [S1(), S2()]), companyTab("פלנט", [S3()])]));
    expect(p.warnings.some((w) => w.includes("7000002") && w.includes("מופיע בשתי לשוניות"))).toBe(true);
    await apply(sheet([companyTab("פלתצ", [S2()]), companyTab("פלסר", [S1(), S2()]), companyTab("פלנט", [S3()])]));
    const [s2] = await db.select().from(people).where(eq(people.personalNumber, "7000002"));
    const rows = await db.select().from(doch1Members).where(eq(doch1Members.personId, s2!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sheetTab).toBe("פלסר");
  });

  it("on a first import (no round companies yet) a duplicate goes to the visible tab, not the hidden one", async () => {
    await db.delete(doch1RoundCompanies).where(eq(doch1RoundCompanies.unitId, ids.pltz));
    const hiddenFirst = { ...companyTab("פלתצ", [S2()]), hidden: true };
    await apply(sheet([hiddenFirst, companyTab("פלסר", [S1(), S2()]), companyTab("פלנט", [S3()])]));
    const [s2] = await db.select().from(people).where(eq(people.personalNumber, "7000002"));
    const [member] = await db.select().from(doch1Members).where(eq(doch1Members.personId, s2!.id));
    expect(member!.sheetTab).toBe("פלסר");
    const [unit] = await db.select().from(units).where(eq(units.id, s2!.unitId));
    expect(unit!.parentId).toBe(ids.plsr);
    await db.update(doch1RoundCompanies).set({ active: false }).where(eq(doch1RoundCompanies.unitId, ids.pltz));
  });

  it("soldiers missing from the file are listed, not removed", async () => {
    const parsed = sheet([companyTab("פלסר", [S1(), S2()]), companyTab("פלנט", [])]);
    const p = await plan(parsed);
    expect(p.notInSheet.map((x) => x.name)).toEqual(["טל דמיוני"]);
    expect(p.notInSheet[0]!.company).toBe("פלנ״ט");
    await apply(parsed);
    const [s3] = await db.select().from(people).where(eq(people.personalNumber, "7000003"));
    expect(await db.select().from(doch1Members).where(eq(doch1Members.personId, s3!.id))).toHaveLength(1);
  });

  it("an unknown status value is a question, suggestion create", async () => {
    const p = await plan(sheet([companyTab("פלסר", [S1(["קורס", "עזה"]), S2()]), companyTab("פלנט", [S3()])]));
    expect(p.questions).toEqual([expect.objectContaining({ kind: "status", key: "קורס", suggestion: "create" })]);
  });

  it("refuses to apply with open questions", async () => {
    await expect(apply(sheet([companyTab("לשונית חדשה", [S1()])]))).rejects.toThrow();
  });

  it("a re-import after a status got a new flags version keeps past days on the old version", async () => {
    // same file as the last import ("soldiers missing from the file…"): nothing to change
    const parsed = sheet([companyTab("פלסר", [S1(), S2()]), companyTab("פלנט", [])]);
    const [old] = await db.select().from(doch1Statuses).where(and(eq(doch1Statuses.sheetValue, "עזה"), eq(doch1Statuses.active, true)));
    await db.update(doch1Statuses).set({ active: false }).where(eq(doch1Statuses.id, old!.id));
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = old!;
    await db.insert(doch1Statuses).values({ ...rest, acrossBorder: true, replacesId: old!.id });
    const counts = await apply(parsed);
    expect(counts).toMatchObject({ daysWritten: 0, daysCleared: 0 });
    expect((await dayRow("7000001", "2026-10-20"))!.statusId).toBe(old!.id);
  });

  it("rejects mapping targets that are not valid for the question", async () => {
    const p = await plan(sheet([companyTab("לשונית חדשה", [S1()])]), { tabs: { "לשונית חדשה": ids.plsr1 } });
    expect(p.questions.some((q) => q.kind === "tab" && q.key === "לשונית חדשה")).toBe(true);
  });

  describe("a tab answered 'create'", () => {
    const S4 = () => soldier(7000004, "גל", "בדוי", "מחלקה 1", ["עזה", "רענון"]);
    const newTab = () => sheet([companyTab("פלסר", [S1(), S2()]), companyTab("פלנט", [S3()]), companyTab("פלוגה חדשה", [S4()])]);
    const newPlatoon = "new:פלוגה חדשה|מחלקה 1";
    const m = (): ImportMappings => ({ tabs: { "פלוגה חדשה": "create" }, platoons: { [newPlatoon]: "create" }, statuses: {} });

    it("previews the new company and asks about its platoons", async () => {
      const first = await plan(newTab());
      expect(first.questions).toEqual([expect.objectContaining({ kind: "tab", key: "פלוגה חדשה", suggestion: "ignore" })]);
      const p = await plan(newTab(), { tabs: { "פלוגה חדשה": "create" } });
      expect(p.questions).toEqual([
        expect.objectContaining({ kind: "platoon", key: newPlatoon, label: "פלוגה חדשה · מחלקה 1", suggestion: "create", options: [] }),
      ]);
      expect((await plan(newTab(), m())).counts).toMatchObject({ companiesCreated: 1, platoonsCreated: 1, newPeople: 1 });
    });

    it("needs the core admin role", async () => {
      await expect(asUser(d1Only, (tx) => applySheetImport(tx, roundId, newTab(), m()))).rejects.toThrow("ליצירת פלוגות צריך הרשאת מנהל ליבה");
    });

    it("creates the company under the battalion, joins it to the round and remembers it", async () => {
      const counts = await apply(newTab(), m());
      expect(counts).toMatchObject({ companiesCreated: 1, platoonsCreated: 1, newPeople: 1, members: 1 });
      const [company] = await db.select().from(units).where(and(eq(units.kind, "company"), eq(units.name, "פלוגה חדשה")));
      expect(company).toMatchObject({ parentId: ids.bat, active: true });
      const [s4] = await db.select().from(people).where(eq(people.personalNumber, "7000004"));
      const [platoon] = await db.select().from(units).where(eq(units.id, s4!.unitId));
      expect(platoon).toMatchObject({ name: "מחלקה 1", parentId: company!.id, kind: "platoon" });
      const rc = await db.select().from(doch1RoundCompanies).where(and(eq(doch1RoundCompanies.roundId, roundId), eq(doch1RoundCompanies.unitId, company!.id)));
      expect(rc).toHaveLength(1);
      expect((await plan(newTab())).questions).toEqual([]);
      expect(await apply(newTab())).toMatchObject({ companiesCreated: 0, platoonsCreated: 0, newPeople: 0 });
    });
  });
});
