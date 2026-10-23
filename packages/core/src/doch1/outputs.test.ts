import { expect, it } from "vitest";
import type { GroupCount } from "./counting";
import { brigadeReportText, sheetColumnLines, sheetRowAnchors } from "./outputs";

const sum = (inSadak: number, roster: number, missing: number, groups: GroupCount[]) =>
  ({ roster, reported: roster - missing, missing, inSadak, offDuty: 0, groups, completion: 0 });

it("brigade text matches the mockup format", () => {
  const text = brigadeReportText({
    battalionName: "גדס״ר", day: "2026-10-19",
    total: sum(492, 648, 60, [{ name: "עזה", color: "", count: 116 }, { name: "מיוערת", color: "", count: 117 }, { name: "רענון", color: "", count: 199 }]),
    companies: [{ name: "אגם", summary: sum(65, 78, 5, []) }, { name: "מסייעת", summary: sum(75, 94, 12, []) }, { name: "פלנט", summary: sum(87, 123, 14, []) }],
  }, { byCompany: true, missingNames: false });
  expect(text).toBe([
    "*גדס״ר – דוח 1 · יום ב׳ 19.10 (חלקי)*",
    "בסד״כ: 492 מתוך 648",
    "עזה 116 · מיוערת 117",
    "רענון 199 · חסרי דיווח 60",
    "*לפי פלוגה (בסד״כ / חסרים)*",
    "אגם 65 / 5 · מסייעת 75 / 12",
    "פלנט 87 / 14",
  ].join("\n"));
});

it("no (חלקי) when nothing is missing, and no company block when off", () => {
  const text = brigadeReportText(
    { battalionName: "גדוד", day: "2026-10-19", total: sum(10, 12, 0, [{ name: "עזה", color: "", count: 10 }]), companies: [{ name: "א", summary: sum(10, 12, 0, []) }] },
    { byCompany: false, missingNames: false },
  );
  expect(text).toBe(["*גדוד – דוח 1 · יום ב׳ 19.10*", "בסד״כ: 10 מתוך 12", "עזה 10 · חסרי דיווח 0"].join("\n"));
});

it("lists missing names per company when asked", () => {
  const text = brigadeReportText(
    {
      battalionName: "גדוד", day: "2026-10-19", total: sum(1, 4, 3, []), companies: [],
      missingNames: [{ company: "א", name: "דנה בדויה" }, { company: "ב", name: "רון ממציא" }, { company: "א", name: "טל דמיוני" }],
    },
    { byCompany: true, missingNames: true },
  );
  expect(text.split("\n").slice(-3)).toEqual(["*חסרי דיווח*", "א: דנה בדויה, טל דמיוני", "ב: רון ממציא"]);
});

it("sheet lines fill gaps and count app-only soldiers", () =>
  expect(sheetColumnLines([{ sheetRow: 6, value: "עזה" }, { sheetRow: 4, value: "0" }, { sheetRow: null, value: "רענון" }]))
    .toEqual({ lines: ["0", "", "עזה"], firstRow: 4, notInSheet: 1 }));

it("sheet lines with nobody in the sheet", () =>
  expect(sheetColumnLines([{ sheetRow: null, value: "x" }])).toEqual({ lines: [], firstRow: null, notInSheet: 1 }));

it("row anchors: the first and last soldier and one every N rows, to check against the sheet", () => {
  const rows = [4, 5, 6, 7, 9, 10, 12].map((r) => ({ sheetRow: r, name: `ח${r}` }));
  expect(sheetRowAnchors([...rows, { sheetRow: null, name: "לא בגיליון" }], 3)).toEqual([
    { row: 4, name: "ח4" },
    { row: 7, name: "ח7" },
    { row: 10, name: "ח10" },
    { row: 12, name: "ח12" },
  ]);
  expect(sheetRowAnchors([])).toEqual([]);
});
