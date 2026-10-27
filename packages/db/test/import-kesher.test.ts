/**
 * The kesher sheet import (src/kesher-sheet): reading the xlsx, diffing it against the app and
 * applying the ticked lines — on the real migrations (PGlite), as a battalion kesher admin through
 * RLS. All names and צ׳ are invented.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import writeXlsxFile, { type SheetData } from "write-excel-file/node";
import { runAsUser, type JwtClaims, type Tx } from "../src/index";
import {
  applyKesher,
  bookFromTabs,
  diffKesher,
  MSG,
  readKesherBook,
  SheetFileError,
  summarizeImport,
  type ChangeLine,
  type KesherSheetKey,
  type KesherSheets,
  type SheetDiff,
} from "../src/kesher-sheet/index";
import * as schema from "../src/schema/index";
import { createTestDb, type PgliteDb, type TestIds } from "./pglite";

const { people, appUsers, memberships, kesherSerials, kesherHolders, kesherItems, kesherStock, kesherKitItems, kesherEvents, kesherChecks, kesherCheckLines } =
  schema;

/** Builds an .xlsx in memory: tab name → rows. */
async function xlsx(tabs: Record<string, unknown[][]>): Promise<Uint8Array> {
  const sheets = Object.entries(tabs).map(([sheet, data]) => ({ sheet, data: data as SheetData, dateFormat: "dd/mm/yyyy hh:mm" }));
  return new Uint8Array(await writeXlsxFile(sheets).toBuffer());
}

const d1 = new Date(Date.UTC(2026, 9, 20, 10, 0));
const d2 = new Date(Date.UTC(2026, 9, 21, 9, 0));
const pad = (n = 10) => Array.from({ length: n }, () => "");
/** A company tab: a title row, the header (F = צ׳), then E:I. */
const companyTab = (...rows: [string, string, string?, string?, string?][]) => [
  ["דוח פלוגתי"],
  ["סה״כ", "", "", "", "מכשיר", "צ׳", "חתום", "תפקיד", "מסגרת"],
  ...rows.map(([type, serial, name = "", role = "", frame = ""]) => ["", "", "", "", type, serial, name, role, frame]),
];

const PIZUR = [
  ["סוג מכשיר", "צ", "מדבקה", "מיקום", "פלוגה", "תפקיד", "מי חתום", "", "", "הערות", "האמר"],
  ["710", "489 001", "", "", 'פלס"ר', "קשר מ״פ", "דני כהן", "#N/A", "", "", "12-345"],
  ["710", "489002", "", "", "פלס״ר", "", "לא קיים בכלל"],
  ["אולר", "1100001", "", "", "במחסן", "", "", "", "", "בתיקון"],
  ["אולר", "1100002", "", "", "עיט", "", "מישהו"],
  ["אולר", "1100003", "", "", "פלנ״ט", "", "דני כהן"],
  ["710", "489003", "", "", "פלס״ר", "", "משה פרץ"],
  ["710", "489004", "", "", ""],
  ["710", "489004", "", "", "במחסן"],
  ["710", "489005", "", "", "פלס״ר", "", "גיל אור"],
];

const GENERAL = [
  ["ציוד משלים"],
  ["קטגוריה", "", "פריט", "במחסן", 'פלס"ר', "פלנ״ט", "עיט", "מלאי כללי", "", "", "", "", "", "מלאי קבלות חטיבה", "", "עזר"],
  ["#REF!", "", "סוללות קטנות", 40, 8, 4, 2, 54, "", "", "", "", "", 60, "", "x"],
  ["#REF!", "", "מגבר", 2, 1, null, null, 3, "", "", "", "", "", 3],
  ["", "", "710", 1],
];

const KIT = [
  ["תקן"],
  ["", "פריט אב", "ציוד משלים", "כמות ליחידה"],
  ["", "710", "סוללות קטנות", 4],
  ["", "710", "מגבר", 1],
  ["", "מגבר", "סוללות קטנות", 2],
  ["", "מגבר", "710", 1],
  ["", "סוללות קטנות", "מגבר", 1],
  ["", "לא קיים", "מגבר", 1],
  ["", "אולר", "מגבר", "x"],
];

const LOG = [
  ["זמן", "פלוגה", "חייל", "תפקיד", "מחתים", "פעולה", "סוג רשומה", "פריט", "צ", "כמות", "בוצע ע״י"],
  [d1, "פלס״ר", "דני כהן", "קשר מ״פ", "טל ברק", "אתר — החתמה", "ציוד עם צ׳", "710", "489001", 1, "someone@example.com"],
  [d1, "פלס״ר", "דני כהן", "קשר מ״פ", "טל ברק", "אתר — החתמה", "ציוד עם צ׳", "710", "489001", 1, "someone@example.com"],
  [d1, "פלס״ר", "דני כהן", "קשר מ״פ", "טל ברק", "אתר — החתמה · תאריך 19/10/2026", "ציוד משלים", "סוללות קטנות", "", 4],
  [d2],
  [d2, "עיט", "מישהו", "", "טל ברק", "אתר — זיכוי"],
  [d2, "במחסן", "", "", "טל ברק", "סנכרון ידני"],
];

const REPORTS = [
  ["תאריך ושעה", "פלוגה", "מדווח", "אימייל", "סה״כ צ׳", "נבדקו", "לא נמצאו", "פירוט הלא־נמצאו", "הערות", "סטטוס"],
  [d1, "פלס״ר", "יוסי לוי", "reporter@example.com", 3, 2, 1, "489002 (710), 489005 (710)", "הערה", "⚠ 1 לא נמצאו"],
  [d2, "עיט", "מישהו", "", 1, 1, 0, "", "", ""],
];

const CHECKS = [
  ["צ׳", "סוג מכשיר", "פלוגה", "תאריך בדיקה", "נבדק ע״י", "סטטוס"],
  ["489001", "710", "פלס״ר", d1, "יוסי לוי", "נמצא"],
  ["489005", "710", "פלס״ר", d1, "יוסי לוי", "נמצא"],
  ["1100003", "אולר", "פלנ״ט", d2, "רון שמש", "נמצא"],
];

const BOOK = {
  "פיזור צ כללי": PIZUR,
  'פלס"ר': companyTab(["710", "489001", "יוסי לוי", "קשר מ״מ", "חפ״ק"], ["אולר", "1100001", "יוסי לוי"], ["710", "489002", "", "", "צוות 1"]),
  "עיט": companyTab(["710", "489099", "מישהו"]),
  "כללי": GENERAL,
  "תקן ציוד משלים": KIT,
  "יומן חתימות": LOG,
  "דוחות צ'": REPORTS,
  "בדיקות צ׳": CHECKS,
  "הרשאות אתר": [["שם", "קוד גישה", "הרשאה", "אימייל"], ["מישהו", "ABCD1234", "מנהל", "a@example.com"]],
  "הערות": [["משהו"]],
};
const ALL_TABS: KesherSheetKey[] = ["pizur", "companies", "general", "kit", "log", "reports", "checks"];

describe("readKesherBook", () => {
  it("lists every tab, collapses the company tabs, and never imports הרשאות אתר", async () => {
    const book = await readKesherBook(await xlsx(BOOK));
    expect(book.tabs.map((t) => [t.name, t.key])).toEqual([
      ["פיזור צ כללי", "pizur"],
      ["גיליונות הפלוגות", "companies"],
      ["כללי", "general"],
      ["תקן ציוד משלים", "kit"],
      ["יומן חתימות", "log"],
      ["דוחות צ'", "reports"],
      ["בדיקות צ׳", "checks"],
      ["הרשאות אתר", null],
      ["הערות", null],
    ]);
    expect(book.tabs[1]!.note).toBe('פלס"ר, עיט');
    expect(book.tabs.find((t) => t.name === "הרשאות אתר")!.note).toMatch(/קודי הגישה/);
    expect(JSON.stringify(book.sheets)).not.toContain("ABCD1234");
    expect(book.sheets.pizur!.rows[0]!.cells.slice(0, 2)).toEqual(["710", "489 001"]);
    expect(book.sheets.companies![0]!.rows[0]).toMatchObject({ row: 3 });
    expect(book.sheets.general!.rows[0]).toMatchObject({ row: 3 });
  });

  it("rejects a file that is not xlsx", async () => {
    await expect(readKesherBook(new TextEncoder().encode("a,b"))).rejects.toBeInstanceOf(SheetFileError);
  });
});

interface Seeded {
  db: PgliteDb;
  ids: TestIds;
  dani: string;
  yossi: string;
  moshe1: string;
  moshe2: string;
}

/** Soldiers: דני כהן, יוסי לוי, two משה פרץ (פלס״ר); גיל אור (פלס״ר, inactive); רון שמש (פלנ״ט). */
async function seed(): Promise<Seeded> {
  const { db, ids } = await createTestDb();
  const ppl = await db
    .insert(people)
    .values([
      { unitId: ids.plsr1, fullName: "דני כהן" },
      { unitId: ids.plsr, fullName: "יוסי לוי" },
      { unitId: ids.plsr, fullName: "משה פרץ" },
      { unitId: ids.plsr1, fullName: "משה  פרץ" },
      { unitId: ids.plsr, fullName: "גיל אור", active: false },
      { unitId: ids.plnt, fullName: "רון שמש" },
    ])
    .returning();
  return { db, ids, dani: ppl[0]!.id, yossi: ppl[1]!.id, moshe1: ppl[2]!.id, moshe2: ppl[3]!.id };
}

const admin = { sub: randomUUID(), email: "kesher-admin@example.com" };
const claims = (u: { sub: string; email: string }): JwtClaims => ({ ...u, app_metadata: { provider: "google" }, user_metadata: { email_verified: true } });
const defaults = (d: SheetDiff) => d.lines.filter((l) => l.defaultOn).map((l) => l.id);
const byKind = (d: SheetDiff, kind: string) => d.lines.filter((l) => l.kind === kind);
const errors = (d: SheetDiff, sheet: KesherSheetKey) => d.lines.filter((l) => l.group === "error" && l.sheet === sheet);
const find = (d: SheetDiff, pred: (l: ChangeLine) => boolean) => d.lines.find(pred);

describe("kesher import", () => {
  let s: Seeded;
  let sheets: KesherSheets;
  const as = <T>(fn: (tx: Tx) => Promise<T>) => runAsUser(s.db as never, claims(admin), fn);
  const diff = (sh: KesherSheets, tabs = ALL_TABS, picks = new Map<string, string>()) => as((tx) => diffKesher(tx, sh, tabs, picks));
  /** diff + apply in one transaction, like the Server Action */
  const importAll = (sh: KesherSheets, tabs = ALL_TABS, picks = new Map<string, string>(), choose: (d: SheetDiff) => string[] = defaults) =>
    as(async (tx) => {
      const d = await diffKesher(tx, sh, tabs, picks);
      return { diff: d, result: await applyKesher(tx, d, new Set(choose(d))) };
    });
  const serial = async (n: string) => (await s.db.select().from(kesherSerials).where(eq(kesherSerials.serial, n)))[0];
  const holder = async (n: string) => {
    const row = await serial(n);
    return row ? (await s.db.select().from(kesherHolders).where(eq(kesherHolders.serialId, row.id)))[0] : undefined;
  };

  beforeAll(async () => {
    s = await seed();
    const [u] = await s.db.insert(appUsers).values({ email: admin.email, authUserId: admin.sub }).returning();
    await s.db.insert(memberships).values({ userId: u!.id, module: "kesher", role: "admin", unitId: null });
    sheets = (await readKesherBook(await xlsx(BOOK))).sheets;
  });

  describe("diff", () => {
    let d: SheetDiff;
    beforeAll(async () => {
      d = await diff(sheets);
    });

    it("פיזור: new serials with their place and signer; serial numbers normalized", () => {
      const add = find(d, (l) => l.id === "pizur:serial.add:489001");
      expect(add).toMatchObject({ group: "new", item: "710", personName: "דני כהן" });
      expect(add!.op).toMatchObject({ location: "company", unitId: s.ids.plsr, vehicle: "12-345", signer: { personId: s.dani, role: "קשר מ״פ" } });
      expect(find(d, (l) => l.id === "pizur:serial.add:1100001")!.op).toMatchObject({ location: "warehouse", unitId: null, notes: "בתיקון" });
      expect(find(d, (l) => l.id === "pizur:serial.add:489004")!.op).toMatchObject({ location: "none" });
      expect(byKind(d, "item.add").map((l) => l.item).sort()).toEqual(["710", "אולר", "מגבר", "סוללות קטנות"].sort());
    });

    it("an unknown company (עיט) is never created: its rows are errors", () => {
      expect(find(d, (l) => l.serial === "1100002")).toMatchObject({ group: "error", message: MSG.noCompany("עיט") });
      expect(find(d, (l) => l.id === "companies:error:tab:עיט")).toBeDefined();
      expect(find(d, (l) => l.id === "general:error:col:עיט")).toBeDefined();
      expect(find(d, (l) => l.id === "log:error:company:עיט")!.message).toMatch(/1 שורות ביומן/);
      expect(find(d, (l) => l.id === "reports:error:company:עיט")).toBeDefined();
    });

    it("soldiers: unmatched, another company's, inactive → error, and the צ׳ still imports without a signer", () => {
      for (const [n, name] of [["489002", "לא קיים בכלל (פלס״ר)"], ["1100003", "דני כהן (פלנ״ט)"], ["489005", "גיל אור (פלס״ר)"]] as const) {
        expect(find(d, (l) => l.id === `pizur:error:${n}:signer`)).toMatchObject({ message: MSG.noSoldier, personName: name });
        expect((find(d, (l) => l.id === `pizur:serial.add:${n}`)!.op as { signer: unknown }).signer).toMatchObject({ personId: null });
      }
    });

    it("an ambiguous name lists the candidates; a pick resolves it for this import", async () => {
      const amb = find(d, (l) => l.id === "pizur:error:489003:signer")!;
      expect(amb.message).toMatch(/יש 2 חיילים בשם "משה פרץ"/);
      expect(amb.pick!.choices.map((c) => c.id).sort()).toEqual([s.moshe1, s.moshe2].sort());
      expect(amb.pick!.choices[0]!.label).toMatch(/פלס״ר/);
      const picked = await diff(sheets, ALL_TABS, new Map([[amb.pick!.key, s.moshe2]]));
      expect(find(picked, (l) => l.id === "pizur:error:489003:signer")).toBeUndefined();
      const line = find(picked, (l) => l.id === "pizur:serial.add:489003")!;
      expect(line.op).toMatchObject({ signer: { personId: s.moshe2 } });
      expect(line.pick?.chosen).toBe(s.moshe2);
      expect(picked.fingerprint).not.toBe(d.fingerprint);
      // a pick that isn't one of the candidates is ignored
      const bogus = await diff(sheets, ALL_TABS, new Map([[amb.pick!.key, s.dani]]));
      expect(find(bogus, (l) => l.id === "pizur:error:489003:signer")).toBeDefined();
    });

    it("the same צ׳ twice: the first row wins", () => {
      expect(errors(d, "pizur").find((l) => l.row === 9)!.message).toMatch(/פעמיים \(גם בשורה 8\)/);
    });

    it("company tabs: holders depend on the serial line; a צ׳ פיזור puts elsewhere is an error", () => {
      const h = find(d, (l) => l.id === 'companies:holder.set:פלס"ר:489001')!;
      expect(h.op).toMatchObject({ personId: s.yossi, role: "קשר מ״מ", frame: "חפ״ק" });
      expect(h.dependsOn).toEqual(["pizur:serial.add:489001"]);
      expect(find(d, (l) => l.id === 'companies:holder.set:פלס"ר:489002')!.op).toMatchObject({ personId: null, frame: "צוות 1" });
      expect(find(d, (l) => l.serial === "1100001" && l.sheet === "companies")!.message).toBe("הצ׳ רשום על במחסן ולא על פלס״ר");
    });

    it("כללי: columns by header name, error cells empty, 'מלאי כללי' mismatch is a warning", () => {
      const batteries = find(d, (l) => l.id === "general:stock.set:סוללות קטנות")!;
      expect(batteries.op).toMatchObject({ cells: [{ unitId: null, qty: 40 }, { unitId: s.ids.plsr, qty: 8 }, { unitId: s.ids.plnt, qty: 4 }] });
      expect(batteries.message).toBe('"מלאי כללי" בגיליון 54, סכום העמודות 52');
      expect(find(d, (l) => l.id === "general:item.add:סוללות קטנות")!.op).toMatchObject({ kind: "bulk", brigadeQty: 60, category: null });
      expect(find(d, (l) => l.id === "general:stock.set:מגבר")!.op).toMatchObject({ cells: [{ unitId: null, qty: 2 }, { unitId: s.ids.plsr, qty: 1 }] });
      expect(errors(d, "general").find((l) => l.item === "710")!.message).toMatch(/סוג מכשיר ולא כציוד משלים/);
    });

    it("תקן: cycles, unknown parents, non-bulk children and bad quantities are errors", () => {
      expect(byKind(d, "kit.add").map((l) => l.item).sort()).toEqual(["710 ← מגבר", "710 ← סוללות קטנות", "מגבר ← סוללות קטנות"].sort());
      const msgs = errors(d, "kit").map((l) => l.message);
      expect(msgs).toEqual(expect.arrayContaining(['"710" אינו ציוד משלים', expect.stringMatching(/מעגלי/), expect.stringMatching(/"לא קיים" לא קיים/), expect.stringMatching(/כמות ליחידה/)]));
    });

    it("יומן: one line for all new rows; soldiers linked within the company; emails never read", () => {
      const log = byKind(d, "log.add");
      expect(log).toHaveLength(1);
      const events = (log[0]!.op as { events: { kind: string; personId: string | null; backdated: boolean; sheetActor: string | null; details: string | null }[] }).events;
      expect(events.map((e) => e.kind)).toEqual(["sign", "sign", "sign", "legacy"]);
      expect(events[0]).toMatchObject({ personId: s.dani, sheetActor: "טל ברק", backdated: false });
      expect(events[2]!.backdated).toBe(true);
      expect(events[3]!.details).toBe("סנכרון ידני");
      expect(log[0]!.message).toMatch(/1 שורות עם תאריך בלבד דולגו/);
      expect(JSON.stringify(d.lines)).not.toContain("@example.com");
    });

    it("דוחות צ׳ and בדיקות צ׳: report lines from both tabs, synthetic reports per company and day", () => {
      const reports = find(d, (l) => l.sheet === "reports" && l.kind === "checks.add")!;
      const op = reports.op as { checks: { reporterName: string; total: number; found: number }[]; lines: { serial: string; found: boolean }[] };
      expect(op.checks).toEqual([expect.objectContaining({ reporterName: "יוסי לוי", total: 3, found: 2, note: "הערה" })]);
      // 489005 is in the report's "not found" text, but בדיקות צ׳ says נמצא for the same report
      expect(op.lines).toEqual([expect.objectContaining({ serial: "489002", found: false })]);
      const checks = find(d, (l) => l.sheet === "checks" && l.kind === "checks.add")!;
      const cop = checks.op as { checks: { unitId: string; total: number }[]; lines: { serial: string; found: boolean }[] };
      expect(cop.lines.map((l) => [l.serial, l.found])).toEqual([["489001", true], ["489005", true], ["1100003", true]]);
      expect(cop.checks).toEqual([expect.objectContaining({ unitId: s.ids.plnt, total: 1, found: 1 })]);
      expect(checks.dependsOn).toEqual([reports.id]);
    });

    it("picks nothing from tabs that weren't chosen", async () => {
      const only = await diff(sheets, ["general"]);
      expect(new Set(only.lines.map((l) => l.sheet))).toEqual(new Set(["general"]));
    });
  });

  describe("apply", () => {
    it("writes the ticked lines through RLS; re-importing the same file finds nothing new", async () => {
      const { diff: first, result } = await importAll(sheets);
      expect(result.blocked).toEqual([]);
      expect(result.logEvents).toBe(4);

      const h1 = await holder("489001");
      expect(h1).toMatchObject({ unitId: s.ids.plsr, signerPersonId: s.dani, signerRole: "קשר מ״פ", holderPersonId: s.yossi, holderRole: "קשר מ״מ", frame: "חפ״ק" });
      expect(await holder("489002")).toMatchObject({ signerPersonId: null, holderPersonId: null, frame: "צוות 1" });
      expect(await holder("1100001")).toBeUndefined();
      expect(await serial("1100002")).toBeUndefined();
      expect(await serial("489001")).toMatchObject({ vehicle: "12-345" });

      const stock = await s.db.select().from(kesherStock);
      expect(stock).toHaveLength(5);
      expect(await s.db.select().from(kesherKitItems)).toHaveLength(3);
      const [batteries] = await s.db.select().from(kesherItems).where(eq(kesherItems.name, "סוללות קטנות"));
      expect(batteries).toMatchObject({ kind: "bulk", brigadeQty: 60 });

      const events = await s.db.select().from(kesherEvents);
      expect(events).toHaveLength(4);
      expect(events[0]).toMatchObject({ actorName: admin.email, personName: "דני כהן", company: "פלס״ר", unitId: s.ids.plsr });

      const checks = await s.db.select().from(kesherChecks);
      expect(checks).toHaveLength(2);
      expect(checks.every((c) => c.notifiedAt !== null && c.byUser === null)).toBe(true);
      const lines = await s.db.select().from(kesherCheckLines);
      expect(lines).toHaveLength(4);
      expect(lines.every((l) => l.serialId !== null)).toBe(true);

      const again = await diff(sheets);
      expect(again.lines.filter((l) => l.selectable && (l.group === "new" || l.group === "change")).map((l) => l.id)).toEqual([]);
      // the "מלאי כללי" warning stays, for information
      expect(again.lines.filter((l) => l.kind === "info").map((l) => l.id)).toEqual(["general:info:סוללות קטנות"]);
      expect(again.lines.filter((l) => l.group === "error").length).toBe(first.lines.filter((l) => l.group === "error").length);
      expect(summarizeImport("קשר.xlsx", ALL_TABS, result, 0)).toMatch(/^קשר\.xlsx · לשוניות: פיזור צ כללי, גיליונות הפלוגות/);
    });

    it("the sheet wins on the next import: an app-only holder change shows as a change back", async () => {
      const row = await serial("489002");
      await s.db.update(kesherHolders).set({ frame: "חפ״ק" }).where(eq(kesherHolders.serialId, row!.id));
      const d = await diff(sheets);
      expect(find(d, (l) => l.id === 'companies:holder.set:פלס"ר:489002')).toMatchObject({ group: "change", before: "ללא חותם · חפ״ק", after: "ללא חותם · צוות 1" });
    });

    it("a צ׳ that moves to another company drops its holder row and gets the new signer", async () => {
      const moved = { ...sheets, pizur: { ...sheets.pizur!, rows: sheets.pizur!.rows.map((r) => (r.cells[1] === "489 001" ? { ...r, cells: ["710", "489001", "", "", "פלנ״ט", "", "רון שמש"] } : r)) } };
      const { diff: d } = await importAll(moved, ["pizur"]);
      expect(find(d, (l) => l.id === "pizur:serial.update:489001")!.message).toMatch(/השיוך הקודם/);
      const h = await holder("489001");
      expect(h).toMatchObject({ unitId: s.ids.plnt, holderPersonId: null, frame: null });
      expect(h!.signerPersonId).not.toBe(s.dani);
    });

    it("unticking a new serial blocks the holder line that depends on it", async () => {
      const extra = {
        pizur: { ...sheets.pizur!, rows: [...sheets.pizur!.rows, { row: 99, cells: ["710", "489777", "", "", "פלס״ר"] }] },
        companies: [{ ...sheets.companies![0]!, rows: [{ row: 3, cells: ["", "", "", "", "710", "489777", "יוסי לוי"] }] }],
      };
      const { result } = await importAll(extra, ["pizur", "companies"], new Map(), (d) => defaults(d).filter((id) => id !== "pizur:serial.add:489777"));
      expect(result.blocked).toEqual([{ id: 'companies:holder.set:פלס"ר:489777', reason: "תלוי בשורה שלא סומנה" }]);
      expect(await serial("489777")).toBeUndefined();
    });

    it("an app-only serial is offered for removal (unticked) unless it is on a company", async () => {
      const d = await diff({ pizur: { ...sheets.pizur!, rows: [] } }, ["pizur"]);
      const appOnly = d.lines.filter((l) => l.group === "appOnly");
      expect(appOnly.find((l) => l.serial === "1100001")).toMatchObject({ kind: "serial.delete", selectable: true, defaultOn: false });
      expect(appOnly.find((l) => l.serial === "489002")).toMatchObject({ kind: "info", selectable: false });
    });

    it("bookFromTabs reads cached text only (a formula's error value is empty)", () => {
      const book = bookFromTabs([{ name: "פיזור צ כללי", rows: [["h"], ["#REF!", "#N/A"], ["710", "1"]] }]);
      expect(book.sheets.pizur!.rows).toEqual([{ row: 3, cells: ["710", "1"] }]);
    });
  });
});
