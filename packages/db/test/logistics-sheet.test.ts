/**
 * The shared logistics sheet core (src/logistics-sheet): reading an xlsx download, diffing it
 * against the app, and applying the selected lines — against the real migrations on PGlite.
 */
import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import writeXlsxFile, { type SheetData } from "write-excel-file/node";
import { runAsUser, type JwtClaims, type Tx } from "../src/index";
import {
  applyLogistics,
  cellText,
  diffLogistics,
  readXlsx,
  SheetFileError,
  summarizeImport,
  type ChangeLine,
  type SheetDiff,
  type SheetKey,
  type SheetRow,
  type Sheets,
} from "../src/logistics-sheet/index";
import * as schema from "../src/schema/index";
import { createTestDb, type PgliteDb, type TestIds } from "./pglite";

const { people, appUsers, memberships, logisticsItems, logisticsKitItems, logisticsSerials, logisticsAssignments, logisticsStorage, logisticsEvents } =
  schema;

/** Data rows numbered from 2 (row 1 is the header). */
const rows = (...cells: string[][]): SheetRow[] => cells.map((c, i) => ({ row: i + 2, cells: c }));
const byId = (lines: ChangeLine[], id: string) => lines.find((l) => l.id === id);

/** Builds an .xlsx in memory: tab name → rows. */
async function xlsx(tabs: Record<string, unknown[][]>): Promise<Uint8Array> {
  const sheets = Object.entries(tabs).map(([sheet, data]) => ({ sheet, data: data as SheetData, dateFormat: "dd/mm/yyyy" }));
  return new Uint8Array(await writeXlsxFile(sheets).toBuffer());
}

describe("readXlsx", () => {
  it("lists every tab, recognises the logistics ones, and reads rows", async () => {
    const book = await readXlsx(
      await xlsx({
        "טבלת צ": [
          ["קטגוריה", "פריט", "צ", "סטטוס"],
          ["נשק", "M4 קצר", "7710432", "נשקייה תקין"],
          ["", "", "", ""],
        ],
        "אפסון": [
          ["פלוגה", "שם מלא", "מספר אישי", "פריט", "צ", "תאריך אפסון", "תאריך הוצאה מאפסון"],
          ['פלס"ר', "דני כהן", 1234567, "M4 קצר", "100", new Date(Date.UTC(2026, 8, 1)), null],
        ],
        "הערות": [["x"]],
      }),
    );
    expect(book.tabs).toEqual([
      { name: "טבלת צ", key: "serials", rows: 1 },
      { name: "אפסון", key: "storage", rows: 1 },
      { name: "הערות", key: null, rows: 0 },
    ]);
    expect(book.sheets.serials![0]).toEqual({ row: 2, cells: ["נשק", "M4 קצר", "7710432", "נשקייה תקין"] });
    expect(book.sheets.storage![0]!.cells.slice(2, 7)).toEqual(["1234567", "M4 קצר", "100", "01/09/2026", ""]);
  });

  it("rejects a file that is not xlsx", async () => {
    await expect(readXlsx(new TextEncoder().encode("a,b\n1,2"))).rejects.toBeInstanceOf(SheetFileError);
  });

  it("cellText formats dates with time", () => {
    expect(cellText(new Date(Date.UTC(2026, 7, 15, 10, 30)))).toBe("15/08/2026 10:30");
  });
});

/* ── diff ─────────────────────────────────────────────────────────────────── */

interface Seeded {
  db: PgliteDb;
  ids: TestIds;
  dani: string;
  ron: string;
  item: string;
}

/**
 * Item M4 קצר; serials 7710432 (ok), 7710433 (broken, signed to דני כהן), 9990001 (ok, never used),
 * 9990002 (ok, signed once and returned); soldiers דני כהן 1234567 and רון לוי 7654321.
 */
async function seed(): Promise<Seeded> {
  const { db, ids } = await createTestDb();
  const [dani, ron] = await db
    .insert(people)
    .values([
      { unitId: ids.plsr1, fullName: "דני כהן", personalNumber: "1234567" },
      { unitId: ids.plnt, fullName: "רון לוי", personalNumber: "7654321" },
    ])
    .returning();
  const [item] = await db.insert(logisticsItems).values({ name: "M4 קצר", category: "נשק" }).returning();
  const ss = await db
    .insert(logisticsSerials)
    .values([
      { itemId: item!.id, serial: "7710432" },
      { itemId: item!.id, serial: "7710433", condition: "broken" },
      { itemId: item!.id, serial: "9990001" },
      { itemId: item!.id, serial: "9990002" },
    ])
    .returning();
  await db.insert(logisticsAssignments).values([
    { serialId: ss[1]!.id, personId: dani!.id },
    { serialId: ss[3]!.id, personId: ron!.id, returnedAt: new Date(2026, 7, 1) },
  ]);
  return { db, ids, dani: dani!.id, ron: ron!.id, item: item!.id };
}

/** Every app serial, as טבלת צ lists them when nothing changed. */
const SERIALS = [
  ["נשק", "M4 קצר", "7710432", "נשקייה תקין"],
  ["נשק", "M4 קצר", "7710433", "חתום"],
  ["נשק", "M4 קצר", "9990001", "נשקייה תקין"],
  ["נשק", "M4 קצר", "9990002", "נשקייה תקין"],
];

describe("diffLogistics: catalogue and serials", () => {
  let s: Seeded;
  const diff = (sheets: Sheets, tabs: SheetKey[]) => diffLogistics(s.db as unknown as Tx, sheets, tabs);

  beforeAll(async () => {
    s = await seed();
  });

  it("a new צ׳ of a new item → item.add + serial.add that depends on it", async () => {
    const { lines } = await diff({ serials: rows(...SERIALS, ["נשק", "נגב", "8000001", "נשקייה תקין"]) }, ["serials"]);
    const item = byId(lines, "serials:item.add:נגב");
    const serial = byId(lines, "serials:serial.add:8000001");
    expect(item).toMatchObject({ group: "new", defaultOn: true, selectable: true, row: 6, message: "פריט לא היה ב-Dropdowns" });
    expect(item!.op).toEqual({ t: "item.add", name: "נגב", category: "נשק", subcategory: null, sku: null });
    expect(serial).toMatchObject({ group: "new", defaultOn: true, dependsOn: [item!.id], item: "נגב", serial: "8000001" });
    expect(serial!.op).toEqual({ t: "serial.add", serial: "8000001", itemName: "נגב", category: "נשק", condition: "ok" });
    expect(lines.filter((l) => l.group !== "appOnly")).toHaveLength(2);
  });

  it("a new item in Dropdowns is created there; a serial of it depends on that line", async () => {
    const { lines } = await diff(
      {
        dropdowns: rows(["", "", "נשק", "מקלע", "444", "נגב"], ["", "", "נשק", "רובה", "", "M4 קצר"]),
        serials: rows(...SERIALS, ["נשק", "נגב", "8000001", ""]),
      },
      ["dropdowns", "serials"],
    );
    expect(byId(lines, "dropdowns:item.add:נגב")!.op).toEqual({ t: "item.add", name: "נגב", category: "נשק", subcategory: "מקלע", sku: "444" });
    expect(byId(lines, "serials:serial.add:8000001")!.dependsOn).toEqual(["dropdowns:item.add:נגב"]);
    expect(byId(lines, "dropdowns:item.update:M4 קצר")).toMatchObject({
      group: "change",
      before: "נשק / — / —",
      after: "נשק / רובה / —",
    });
  });

  it("a condition change → serial.condition", async () => {
    const sheet = SERIALS.map((r) => (r[2] === "7710432" ? ["נשק", "M4 קצר", "7710432", "נשקייה תקול"] : r));
    const { lines } = await diff({ serials: rows(...sheet) }, ["serials"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: "serials:serial.condition:7710432",
      group: "change",
      kind: "serial.condition",
      before: "תקין",
      after: "תקול",
      defaultOn: true,
    });
  });

  it("חתום carries no condition: a broken signed-out serial is identical", async () => {
    const { lines, identical } = await diff({ serials: rows(...SERIALS) }, ["serials"]);
    expect(lines.filter((l) => l.serial === "7710433")).toEqual([]);
    expect(lines).toEqual([]);
    expect(identical.serials).toBe(4);
  });

  it("a different item for a known צ׳ is never applied → error", async () => {
    const sheet = SERIALS.map((r) => (r[2] === "7710432" ? ["נשק", "M16", "7710432", "נשקייה תקין"] : r));
    const { lines } = await diff({ serials: rows(...sheet) }, ["serials"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "error", group: "error", row: 2, selectable: false, op: null, message: "סוג הפריט שונה מהאפליקציה — לתיקון ידני" });
  });

  it("the same צ׳ twice → the later row is an error naming the first", async () => {
    const { lines } = await diff({ serials: rows(...SERIALS, ["נשק", "M4 קצר", "77-104 32", "נשקייה תקול"]) }, ["serials"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ group: "error", row: 6, serial: "7710432", message: "הצ׳ מופיע פעמיים (גם בשורה 2)" });
  });

  it("serials only in the app: never-used → deletable (unticked); used → listed, not removable", async () => {
    const { lines } = await diff({ serials: rows(SERIALS[0]!, SERIALS[1]!) }, ["serials"]);
    expect(byId(lines, "serials:serial.delete:9990001")).toMatchObject({
      group: "appOnly",
      row: null,
      selectable: true,
      defaultOn: false,
      op: { t: "serial.delete" },
    });
    expect(byId(lines, "serials:serial.delete:9990002")).toMatchObject({
      group: "appOnly",
      selectable: false,
      defaultOn: false,
      op: null,
      message: "בשימוש – לא ניתן למחוק",
    });
  });

  it("an unknown status → error", async () => {
    const { lines } = await diff({ serials: rows(...SERIALS, ["נשק", "M4 קצר", "8000002", "אבוד"]) }, ["serials"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ group: "error", message: 'סטטוס לא מוכר "אבוד" (צ׳ 8000002)' });
  });

  it("kit lines are added and removed by item + name", async () => {
    await s.db.insert(logisticsKitItems).values({ itemId: s.item, name: "רצועה", qty: 1 });
    const { lines } = await diff(
      { kit: rows(["M4 קצר", "מחסנית", "3"], ["לא קיים", "משהו", "1"]) },
      ["kit"],
    );
    expect(byId(lines, "kit:kit.add:M4 קצר|מחסנית")!.op).toEqual({ t: "kit.add", itemName: "M4 קצר", name: "מחסנית", qty: 3, sortOrder: 0 });
    expect(byId(lines, "kit:kit.remove:M4 קצר|רצועה")).toMatchObject({ group: "appOnly", defaultOn: false, selectable: true });
    expect(lines.find((l) => l.row === 3)).toMatchObject({ group: "error", message: 'פריט "לא קיים" לא קיים בקטלוג' });
  });

  it("only the chosen tabs produce lines", async () => {
    const sheet = SERIALS.map((r) => (r[2] === "7710432" ? ["נשק", "M4 קצר", "7710432", "נשקייה תקול"] : r));
    const { lines } = await diff({ serials: rows(...sheet), kit: rows() }, ["kit"]);
    expect(lines.filter((l) => l.sheet === "serials")).toEqual([]);
  });
});

/** A גדודי row: company, platoon, name, personal number, item, serial, notes, kit text. */
const signed = (name: string, pid: string, serial: string, kit = "") => ["פלס\"ר", "", name, pid, "M4 קצר", serial, "", kit];
/** An אפסון row: company, name, personal number, item, serial, in date, out date. */
const stored = (name: string, pid: string, item: string, serial: string, inDate: string, outDate = "") => ["פלס\"ר", name, pid, item, serial, inDate, outDate];

describe("diffLogistics: assignments and storage", () => {
  let s: Seeded;
  const diff = (sheets: Sheets, tabs: SheetKey[]) => diffLogistics(s.db as unknown as Tx, sheets, tabs);

  beforeAll(async () => {
    s = await seed();
    const [serial] = await s.db.select().from(logisticsSerials).where(eq(logisticsSerials.serial, "7710433"));
    await s.db.insert(logisticsStorage).values([
      { personId: s.dani, serialId: serial!.id, itemName: "M4 קצר", storedAt: new Date(2026, 8, 1) },
      { personId: s.ron, itemName: "קסדה", storedAt: new Date(2026, 7, 15, 10, 30), releasedAt: new Date(2026, 7, 20) },
    ]);
  });

  it("the same holder with a differently formatted personal number → identical", async () => {
    const { lines, identical } = await diff({ assignments: rows(signed("דני כהן", "12-34567", "7710433")) }, ["assignments"]);
    expect(lines).toEqual([]);
    expect(identical.assignments).toBe(1);
  });

  it("another holder → assignment.transfer", async () => {
    const { lines } = await diff({ assignments: rows(signed("רון לוי", "7654321", "7710433")) }, ["assignments"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: "assignments:assignment.transfer:7710433",
      group: "change",
      before: "דני כהן",
      after: "רון לוי",
      personName: "רון לוי",
      defaultOn: true,
    });
  });

  it("a serial nobody holds → assignment.add; a kit difference → assignment.kit", async () => {
    const { lines } = await diff(
      { assignments: rows(signed("רון לוי", "7654321", "7710432"), signed("דני כהן", "1234567", "7710433", "3 מחסניות")) },
      ["assignments"],
    );
    expect(byId(lines, "assignments:assignment.add:7710432")).toMatchObject({ group: "new", defaultOn: true, personName: "רון לוי" });
    expect(byId(lines, "assignments:assignment.add:7710432")!.op).toEqual({
      t: "assignment.add",
      serial: "7710432",
      personId: s.ron,
      notes: null,
      kit: [],
    });
    expect(byId(lines, "assignments:assignment.kit:7710433")).toMatchObject({ group: "change", before: "", after: "3 מחסניות" });
  });

  it("a soldier the app doesn't have → error; no soldier is created", async () => {
    const before = (await s.db.select({ n: count() }).from(people))[0]!.n;
    const { lines } = await diff(
      { assignments: rows(signed("דני כהן", "1234567", "7710433"), signed("שרה מזרחי", "5555555", "7710432")) },
      ["assignments"],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ group: "error", row: 3, personName: "שרה מזרחי", message: "החייל לא קיים באפליקציה — יש להוסיף אותו בדוח 1" });
    expect((await s.db.select({ n: count() }).from(people))[0]!.n).toBe(before);
  });

  it("the same צ׳ for two soldiers → the later row is an error", async () => {
    const { lines } = await diff(
      { assignments: rows(signed("דני כהן", "1234567", "7710433"), signed("רון לוי", "7654321", "77104-33")) },
      ["assignments"],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ group: "error", row: 3, message: "הצ׳ מופיע פעמיים (גם בשורה 2)" });
  });

  it("an open assignment the sheet doesn't list → assignment.return, unticked", async () => {
    const { lines } = await diff({ assignments: rows(signed("רון לוי", "7654321", "7710432")) }, ["assignments"]);
    expect(byId(lines, "assignments:assignment.return:7710433")).toMatchObject({
      group: "appOnly",
      row: null,
      selectable: true,
      defaultOn: false,
      personName: "דני כהן",
    });
  });

  it("a serial only in גדודי is created on the fly; the assignment depends on it", async () => {
    const { lines } = await diff({ assignments: rows(signed("רון לוי", "7654321", "8000009")) }, ["assignments"]);
    const serial = byId(lines, "assignments:serial.add:8000009");
    expect(serial).toMatchObject({ group: "new", message: "צ׳ לא היה בטבלת צ" });
    expect(byId(lines, "assignments:assignment.add:8000009")!.dependsOn).toEqual([serial!.id]);
  });

  it("storage: an out-date releases an open row; reopening a released row is an error", async () => {
    const { lines } = await diff(
      {
        storage: rows(
          stored("דני כהן", "1234567", "M4 קצר", "7710433", "01/09/2026", "20/09/2026"),
          stored("רון לוי", "7654321", "קסדה", "0", "15/08/2026 10:30"),
        ),
      },
      ["storage"],
    );
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.row === 2)).toMatchObject({ group: "change", kind: "storage.release", before: "באפסון" });
    expect(lines.find((l) => l.row === 2)!.op).toMatchObject({ t: "storage.release", releasedAt: new Date(2026, 8, 20).toISOString() });
    expect(lines.find((l) => l.row === 3)).toMatchObject({ group: "error", message: "שוחרר באפליקציה – לא ניתן להחזיר לאפסון" });
  });

  it("storage: a new row → storage.add; an open app row the sheet doesn't list → release, unticked", async () => {
    const { lines } = await diff({ storage: rows(stored("רון לוי", "7654321", "קסדה", "", "15/08/2026 10:30", "20/08/2026"), stored("רון לוי", "7654321", "אפוד", "", "01/10/2026")) }, ["storage"]);
    expect(lines.filter((l) => l.group === "new")).toHaveLength(1);
    expect(lines.find((l) => l.group === "new")!.op).toEqual({
      t: "storage.add",
      personId: s.ron,
      serial: null,
      itemName: "אפוד",
      storedAt: new Date(2026, 9, 1).toISOString(),
      releasedAt: null,
    });
    expect(lines.find((l) => l.group === "appOnly")).toMatchObject({ kind: "storage.release", defaultOn: false, serial: "7710433", personName: "דני כהן" });
  });

  it("the fingerprint is stable and changes when the app changes", async () => {
    const sheets: Sheets = { assignments: rows(signed("רון לוי", "7654321", "7710432")), serials: rows(...SERIALS) };
    const tabs: SheetKey[] = ["serials", "assignments"];
    const a = await diff(sheets, tabs);
    const b = await diff(sheets, tabs);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(b.fingerprint).toBe(a.fingerprint);
    const [serial] = await s.db.select().from(logisticsSerials).where(eq(logisticsSerials.serial, "7710432"));
    await s.db.insert(logisticsAssignments).values({ serialId: serial!.id, personId: s.dani });
    expect((await diff(sheets, tabs)).fingerprint).not.toBe(a.fingerprint);
  });
});

describe("applyLogistics", () => {
  let s: Seeded;
  const admin = { sub: randomUUID(), email: "log-admin@example.com" };
  const companyAdmin = { sub: randomUUID(), email: "plsr-admin@example.com" };
  const claims = (u: { sub: string; email: string }): JwtClaims => ({
    ...u,
    app_metadata: { provider: "google" },
    user_metadata: { email_verified: true },
  });
  const defaults = (d: SheetDiff) => d.lines.filter((l) => l.defaultOn).map((l) => l.id);
  /** diff + apply in one transaction as `u`, like the Server Action */
  const importAs = (u: typeof admin, sheets: Sheets, tabs: SheetKey[], pick: (d: SheetDiff) => string[] = defaults) =>
    runAsUser(s.db as never, claims(u), async (tx) => {
      const diff = await diffLogistics(tx, sheets, tabs);
      return { diff, result: await applyLogistics(tx, diff, new Set(pick(diff))) };
    });
  const serialRow = async (serial: string) => (await s.db.select().from(logisticsSerials).where(eq(logisticsSerials.serial, serial)))[0];
  const assignmentsOf = async (serial: string) => {
    const row = await serialRow(serial);
    return s.db.select().from(logisticsAssignments).where(eq(logisticsAssignments.serialId, row!.id));
  };

  const sheets: Sheets = {
    serials: rows(
      ...SERIALS.map((r) => (r[2] === "7710432" ? ["נשק", "M4 קצר", "7710432", "נשקייה תקול"] : r)),
      ["נשק", "נגב", "8000001", "נשקייה תקין"],
    ),
    assignments: rows(signed("רון לוי", "7654321", "7710433")),
  };
  const tabs: SheetKey[] = ["serials", "assignments"];

  beforeAll(async () => {
    s = await seed();
    const users = await s.db
      .insert(appUsers)
      .values([
        { email: admin.email, authUserId: admin.sub },
        { email: companyAdmin.email, authUserId: companyAdmin.sub },
      ])
      .returning();
    await s.db.insert(memberships).values([
      { userId: users[0]!.id, module: "logistics", role: "admin", unitId: null },
      { userId: users[1]!.id, module: "logistics", role: "admin", unitId: s.ids.plsr },
    ]);
  });

  it("applies every default line as a battalion logistics admin", async () => {
    const { result } = await importAs(admin, sheets, tabs);
    expect(result).toEqual({ applied: { new: 2, change: 2, appOnly: 0, error: 0 }, blocked: [] });
    const history = await assignmentsOf("7710433");
    expect(history.find((a) => a.personId === s.dani)!.returnedAt).not.toBeNull();
    expect(history.find((a) => a.personId === s.ron)!.returnedAt).toBeNull();
    expect((await serialRow("7710432"))!.condition).toBe("broken");
    const [negev] = await s.db.select().from(logisticsItems).where(eq(logisticsItems.name, "נגב"));
    expect((await serialRow("8000001"))!.itemId).toBe(negev!.id);
  });

  it("re-importing the same sheet right after finds nothing new or changed", async () => {
    const diff = await runAsUser(s.db as never, claims(admin), (tx) => diffLogistics(tx, sheets, tabs));
    expect(diff.lines.filter((l) => l.group === "new" || l.group === "change")).toEqual([]);
  });

  it("a line whose dependency is unticked is blocked, not applied", async () => {
    const more: Sheets = { serials: rows(["נשק", "מאג", "8000002", "נשקייה תקין"]) };
    const { result } = await importAs(admin, more, ["serials"], (d) => d.lines.filter((l) => l.kind === "serial.add").map((l) => l.id));
    expect(result.blocked).toEqual([{ id: "serials:serial.add:8000002", reason: "תלוי בשורה שלא סומנה" }]);
    expect(await serialRow("8000002")).toBeUndefined();
  });

  it("an app-only assignment is returned only when ticked", async () => {
    const other: Sheets = { assignments: rows(signed("דני כהן", "1234567", "7710432")) };
    await importAs(admin, other, ["assignments"]);
    expect((await assignmentsOf("7710433")).filter((a) => !a.returnedAt)).toHaveLength(1);
    const { result } = await importAs(admin, other, ["assignments"], (d) => d.lines.map((l) => l.id));
    expect(result.applied.appOnly).toBe(1);
    expect((await assignmentsOf("7710433")).filter((a) => !a.returnedAt)).toHaveLength(0);
  });

  it("a company-scoped logistics admin can't apply catalogue changes (RLS)", async () => {
    await expect(importAs(companyAdmin, { serials: rows(["נשק", "M4 קצר", "8000003", ""]) }, ["serials"])).rejects.toThrow();
    expect(await serialRow("8000003")).toBeUndefined();
  });

  it("summarizes the import without cell values", () => {
    const result = { applied: { new: 7, change: 6, appOnly: 1, error: 0 }, blocked: [] };
    expect(summarizeImport("לוגיסטיקה.xlsx", ["serials", "assignments"], result, 3)).toBe(
      "לוגיסטיקה.xlsx · לשוניות: טבלת צ, גדודי · חדשים 7 · שינויים 6 · הוסרו 1 · לא סומנו 3",
    );
  });

  it("a battalion logistics admin can log a sheet_import event with no soldier", async () => {
    const rowsIn = await runAsUser(s.db as never, claims(admin), (tx) =>
      tx.insert(logisticsEvents).values({ kind: "sheet_import", details: "x" }).returning(),
    );
    expect(rowsIn).toHaveLength(1);
  });
});
