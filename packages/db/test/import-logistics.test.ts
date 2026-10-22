/**
 * The logistics sheet import (scripts/logistics-import.ts), run against the real migrations
 * on an in-memory Postgres (PGlite) with a small, made-up set of CSV exports.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatReport, importLogistics, readSheets, type ImportReport } from "../scripts/logistics-import";
import { parseCsv, parseSheetDate, statusToCondition, type Sheets } from "../src/logistics-sheet/index";
import * as schema from "../src/schema/index";
import { createTestDb, type PgliteDb, type TestIds } from "./pglite";

const { units, people, logisticsItems, logisticsKitItems, logisticsSerials, logisticsAssignments, logisticsStorage } = schema;

/** Fake exports, named the way Google Sheets names a CSV download. */
const CSV: Record<string, string> = {
  Dropdowns: [
    'פלוגות,,קטגוריה,תת קטגוריה,מק"ט,פריט',
    '"פלס""ר",,נשק,רובה,111,M4 קצר',
    'פלנ"ט,,נשק,רובה,222,M16',
    "מפקדה,,אופטיקה,כוונת,333,מפרו",
  ].join("\r\n"),
  "אלפון גדודי": [
    "שם מלא,מספר אישי,שם פרטי,שם משפחה,פלוגה,מחלקה,מספר טלפון",
    'דני כהן,12-34567,דני,כהן,פלס"ר,מחלקה 1,0501111111',
    ',7654321,רון,לוי,פלנ"ט,מחלקה 2,0502222222',
    "שרה מזרחי,5555555,שרה,מזרחי,גדוד הקודם,,",
  ].join("\n"),
  "טבלת צ": [
    "קטגוריה,פריט,צ,סטטוס",
    "נשק,M4 קצר,66-204 17,חתום",
    "נשק,M4 קצר,100,נשקייה תקין",
    "נשק,M4 קצר,101,נשקייה תקול",
    "נשק,M16,200,נשקייה חטיבה",
    "אופטיקה,משקפת,300,",
    "נשק,M16,201,אבוד",
    ",,,",
  ].join("\n"),
  "תקן ציוד משלים": ["פריט צ,שם פריט,כמות", "M4 קצר,מחסנית,3", "M4 קצר,רצועה,", "לא קיים,משהו,1"].join("\n"),
  "גדודי": [
    "פלוגה,מחלקה,שם מלא,מספר אישי,פריט,צ,הערות,ציוד משלים",
    'פלס"ר,מחלקה 1,דני כהן,1234567,M4 קצר,6620417,חדש,"3 מחסניות, רצועה"',
    'פלנ"ט,מחלקה 2,רון לוי,7654321,מפרו,999,,',
    'פלנ"ט,#N/A,רון לוי,7654321,M4 קצר,6620417,,',
    'פלס"ר,,,,M4 קצר,,,',
  ].join("\n"),
  "אפסון": [
    "פלוגה,שם מלא,מספר אישי,פריט,צ,תאריך אפסון,תאריך הוצאה מאפסון",
    'פלס"ר,דני כהן,1234567,M4 קצר,66-204-17,01/09/2026,',
    'פלנ"ט,רון לוי,7654321,קסדה,0,15/08/2026 10:30,20/08/2026',
    'פלס"ר,דני כהן,1234567,M4 קצר,100,02/09/2026,',
    'פלס"ר,דני כהן,1234567,M4 קצר,404,02/09/2026,',
    'פלס"ר,דני כהן,1234567,M4 קצר,101,,',
  ].join("\n"),
};

let db: PgliteDb;
let ids: TestIds;
let folder: string;
let sheets: Sheets;

const run = (dryRun: boolean) => importLogistics(db as never, sheets, { dryRun });
const total = async (table: PgTable) => (await db.select({ n: count() }).from(table))[0]!.n;
const tableCounts = async () => ({
  units: await total(units),
  people: await total(people),
  items: await total(logisticsItems),
  kit: await total(logisticsKitItems),
  serials: await total(logisticsSerials),
  assignments: await total(logisticsAssignments),
  storage: await total(logisticsStorage),
});
const messages = (r: ImportReport, list: "skipped" | "warnings") => r[list].map((i) => `${i.sheet}:${i.row}`);

beforeAll(async () => {
  ({ db, ids } = await createTestDb());
  await db.insert(people).values({ unitId: ids.plsr1, fullName: "דני כהן", personalNumber: "1234567" });
  await db.insert(logisticsItems).values({ name: "M4 קצר" });

  folder = mkdtempSync(path.join(tmpdir(), "logistics-import-"));
  for (const [sheet, text] of Object.entries(CSV)) writeFileSync(path.join(folder, `לוגיסטיקה - ${sheet}.csv`), `﻿${text}`, "utf8");
  writeFileSync(path.join(folder, "notes.txt"), "not a sheet");
  const read = readSheets(folder);
  expect(read.missing).toEqual([]);
  sheets = read.sheets;
});

afterAll(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("parsing helpers", () => {
  it("parses quoted CSV cells (commas, newlines, escaped quotes, CRLF, BOM)", () => {
    expect(parseCsv('﻿a,"b, c","say ""hi""\nthere"\r\n1,,3')).toEqual([
      ["a", "b, c", 'say "hi"\nthere'],
      ["1", "", "3"],
    ]);
  });

  it("maps old statuses to conditions", () => {
    expect(["", "חתום", "נשקייה תקין", "נשקייה תקול", "נשקייה חטיבה", "אבוד"].map(statusToCondition)).toEqual([
      "ok",
      "ok",
      "ok",
      "broken",
      "brigade",
      undefined,
    ]);
  });

  it("reads sheet dates day-first, rejects impossible ones", () => {
    expect(parseSheetDate("15/08/2026 10:30")).toEqual(new Date(2026, 7, 15, 10, 30));
    expect(parseSheetDate("2026-08-15")).toEqual(new Date(2026, 7, 15));
    expect(parseSheetDate("31/02/2026")).toBeUndefined();
    expect(parseSheetDate("אתמול")).toBeUndefined();
  });

  it("finds each sheet's CSV by its name, not by a suffix of another sheet", () => {
    // 'גדודי' must not pick up 'אלפון גדודי' (and vice versa)
    expect(sheets.assignments?.[0]?.cells[2]).toBe("דני כהן");
    expect(sheets.people?.[0]?.cells[6]).toBe("0501111111");
    expect(sheets.serials).toHaveLength(6); // the blank row is dropped
  });
});

describe("importLogistics", () => {
  it("--dry-run reports what it would do and writes nothing", async () => {
    const before = await tableCounts();
    const report = await run(true);
    expect(await tableCounts()).toEqual(before);
    expect(report.dryRun).toBe(true);
    expect(report.counts.serials.created).toBe(6);
    expect(report.skipped.length).toBeGreaterThan(0);
    expect(formatReport(report)).toContain("DRY RUN");
  });

  it("imports the sheets", async () => {
    const report = await run(false);
    expect(report.counts).toEqual({
      platoons: { created: 1, existing: 0 },
      people: { created: 1, existing: 1 },
      items: { created: 3, existing: 1 },
      kitItems: { created: 2, existing: 0 },
      serials: { created: 6, existing: 0 },
      assignments: { created: 2, existing: 0 },
      storage: { created: 3, existing: 0 },
    });
    expect(report.unknownCompanies.sort()).toEqual(["גדוד הקודם", "מפקדה"].sort());
    expect(messages(report, "skipped").sort()).toEqual(
      ["אלפון גדודי:4", "טבלת צ:7", "תקן ציוד משלים:4", "גדודי:4", "גדודי:5", "אפסון:5", "אפסון:6"].sort(),
    );
    expect(messages(report, "warnings").sort()).toEqual(["Dropdowns:4", "טבלת צ:6", "גדודי:3", "אפסון:4"].sort());
  });

  it("maps statuses, people, platoons and kit text", async () => {
    const conditions = Object.fromEntries(
      (await db.select().from(logisticsSerials)).map((s) => [s.serial, s.condition]),
    );
    expect(conditions).toEqual({ "6620417": "ok", "100": "ok", "101": "broken", "200": "brigade", "300": "ok", "999": "ok" });

    const [ron] = await db.select().from(people).where(eq(people.personalNumber, "7654321"));
    expect(ron).toMatchObject({ fullName: "רון לוי", phone: "0502222222" });
    const [platoon] = await db.select().from(units).where(eq(units.id, ron!.unitId));
    expect(platoon).toMatchObject({ kind: "platoon", name: "מחלקה 2", parentId: ids.plnt });

    const [binoculars] = await db.select().from(logisticsItems).where(eq(logisticsItems.name, "משקפת"));
    expect(binoculars?.category).toBe("אופטיקה");
    const kit = await db.select().from(logisticsKitItems).orderBy(logisticsKitItems.sortOrder);
    expect(kit.map((k) => [k.name, k.qty])).toEqual([["מחסנית", 3], ["רצועה", 1]]);

    const [m4] = await db.select().from(logisticsSerials).where(eq(logisticsSerials.serial, "6620417"));
    const [signed] = await db.select().from(logisticsAssignments).where(eq(logisticsAssignments.serialId, m4!.id));
    expect(signed).toMatchObject({ notes: "חדש", returnedAt: null, kit: [{ name: "מחסניות", qty: 3 }, { name: "רצועה", qty: 1 }] });
    const [dani] = await db.select().from(people).where(eq(people.personalNumber, "1234567"));
    expect(signed!.personId).toBe(dani!.id);
  });

  it("imports storage rows; a filled out-date means released", async () => {
    const rows = await db.select().from(logisticsStorage);
    const helmet = rows.find((r) => r.itemName === "קסדה");
    expect(helmet).toMatchObject({ serialId: null, storedAt: new Date(2026, 7, 15, 10, 30), releasedAt: new Date(2026, 7, 20) });
    expect(rows.filter((r) => r.serialId && !r.releasedAt)).toHaveLength(2);
  });

  it("is idempotent: a second run creates nothing", async () => {
    const before = await tableCounts();
    const report = await run(false);
    expect(await tableCounts()).toEqual(before);
    for (const c of Object.values(report.counts)) expect(c.created).toBe(0);
    expect(report.counts).toMatchObject({
      people: { existing: 2 },
      serials: { existing: 5 },
      assignments: { existing: 2 },
      storage: { existing: 3 },
      kitItems: { existing: 2 },
    });
  });
});
