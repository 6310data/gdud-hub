/**
 * The developer CLI import (scripts/logistics-import.ts → the shared diff + apply), run against
 * the real migrations on an in-memory Postgres (PGlite) with a small, made-up set of CSV exports.
 * It applies new rows only and never creates soldiers or units.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDiff, importLogistics, readSheets } from "../scripts/logistics-import";
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
    'פלנ"ט,,שרה מזרחי,5555555,M4 קצר,100,,',
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

beforeAll(async () => {
  ({ db, ids } = await createTestDb());
  await db.insert(people).values([
    { unitId: ids.plsr1, fullName: "דני כהן", personalNumber: "1234567" },
    { unitId: ids.plnt, fullName: "רון לוי", personalNumber: "7654321" },
  ]);
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

  it("reads sheet dates day-first as Israel time, rejects impossible ones", () => {
    expect(parseSheetDate("15/08/2026 10:30")).toEqual(new Date("2026-08-15T10:30:00+03:00"));
    expect(parseSheetDate("2026-08-15")).toEqual(new Date("2026-08-15T00:00:00+03:00"));
    expect(parseSheetDate("15/01/2026")).toEqual(new Date("2026-01-15T00:00:00+02:00")); // winter time
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

describe("importLogistics (CLI)", () => {
  it("--dry-run prints the full diff and writes nothing", async () => {
    const before = await tableCounts();
    const { diff, result } = await run(true);
    expect(await tableCounts()).toEqual(before);
    expect(result).toBeNull();
    expect(diff.lines.filter((l) => l.kind === "serial.add")).toHaveLength(6);
    expect(formatDiff(diff, result)).toContain("DRY RUN");
  });

  it("applies the new rows for soldiers the app has; never creates soldiers or units", async () => {
    const before = await tableCounts();
    const { diff, result } = await run(false);
    expect(await tableCounts()).toEqual({
      ...before,
      items: before.items + 3,
      kit: 2,
      serials: 6,
      assignments: 2,
      storage: 3,
    });
    expect(result!.applied.change).toBe(0);
    expect(result!.applied.appOnly).toBe(0);
    const errors = diff.lines.filter((l) => l.group === "error").map((l) => `${l.sheet}:${l.row}`);
    expect(errors.sort()).toEqual(["serials:7", "kit:4", "assignments:4", "assignments:5", "assignments:6", "storage:5", "storage:6"].sort());
    expect(diff.lines.find((l) => l.sheet === "assignments" && l.row === 6)).toMatchObject({
      personName: "שרה מזרחי",
      message: "החייל לא קיים באפליקציה — יש להוסיף אותו בדוח 1",
    });
    expect(formatDiff(diff, result)).toContain("Import committed");
  });

  it("maps statuses and kit text", async () => {
    const conditions = Object.fromEntries((await db.select().from(logisticsSerials)).map((s) => [s.serial, s.condition]));
    expect(conditions).toEqual({ "6620417": "ok", "100": "ok", "101": "broken", "200": "brigade", "300": "ok", "999": "ok" });

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
    expect(helmet).toMatchObject({ serialId: null, storedAt: new Date("2026-08-15T10:30:00+03:00"), releasedAt: new Date("2026-08-20T00:00:00+03:00") });
    expect(rows.filter((r) => r.serialId && !r.releasedAt)).toHaveLength(2);
  });

  it("a second run applies nothing", async () => {
    const before = await tableCounts();
    const { diff, result } = await run(false);
    expect(await tableCounts()).toEqual(before);
    expect(diff.lines.filter((l) => l.group === "new")).toEqual([]);
    expect(result!.applied).toEqual({ new: 0, change: 0, appOnly: 0, error: 0 });
  });

  it("a condition change is listed by --dry-run but not applied by a normal run", async () => {
    const changed: Sheets = {
      ...sheets,
      serials: sheets.serials!.map((r) => (r.cells[2] === "100" ? { ...r, cells: ["נשק", "M4 קצר", "100", "נשקייה תקול"] } : r)),
    };
    const dry = await importLogistics(db as never, changed, { dryRun: true });
    expect(formatDiff(dry.diff, dry.result)).toMatch(/טבלת צ row 3: .*serial\.condition.*תקין → תקול/);
    await importLogistics(db as never, changed, { dryRun: false });
    const [s100] = await db.select().from(logisticsSerials).where(eq(logisticsSerials.serial, "100"));
    expect(s100!.condition).toBe("ok");
  });
});
