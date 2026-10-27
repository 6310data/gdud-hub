import { describe, expect, it } from "vitest";
import { readWorkbook } from "../src/doch1-import/read";
import { writeWorkbook } from "../src/xlsx";

describe("writeWorkbook", () => {
  it("writes tables one under the other, values only, and keeps text from turning into a formula", async () => {
    const data = await writeWorkbook([
      {
        name: "דוח: א/ב",
        tables: [
          { title: "15א", head: ["פלוגה", "סה״כ"], rows: [["פלסר", 3], ["=1+1", null]], foot: ["סה״כ", 3] },
          { head: ["x"], rows: [] },
        ],
      },
      { name: "דוח: א/ב", tables: [] },
    ]);
    const sheets = await readWorkbook(data);
    expect(sheets.map((s) => s.name)).toEqual(["דוח  א ב", "דוח  א ב 2"]);
    expect(sheets[0]!.rows.slice(0, 7)).toEqual([["15א"], ["פלוגה", "סה״כ"], ["פלסר", 3], ["'=1+1"], ["סה״כ", 3], [], ["x"]]);
  });
});
