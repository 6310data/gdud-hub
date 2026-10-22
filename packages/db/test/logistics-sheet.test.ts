/**
 * The shared logistics sheet core (src/logistics-sheet): reading an xlsx download, diffing it
 * against the app, and applying the selected lines — against the real migrations on PGlite.
 */
import { describe, expect, it } from "vitest";
import writeXlsxFile, { type SheetData } from "write-excel-file/node";
import { cellText, readXlsx, SheetFileError } from "../src/logistics-sheet/index";

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
