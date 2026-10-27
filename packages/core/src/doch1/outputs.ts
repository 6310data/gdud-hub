/**
 * Texts the app hands to people: the brigade WhatsApp report (mockup screen 10)
 * and the copy-to-sheet column.
 */
import type { Summary } from "./counting";
import { hebrewDayLabel, type Day } from "./dates";

export interface BrigadeInput {
  battalionName: string;
  day: Day;
  /** whole battalion */
  total: Summary;
  /** in unit sort order */
  companies: Array<{ name: string; summary: Summary }>;
  missingNames?: Array<{ company: string; name: string }>;
}

/** Items two per line, joined with " · ". */
export function pairs(items: readonly string[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < items.length; i += 2) lines.push(items.slice(i, i + 2).join(" · "));
  return lines;
}

export function brigadeReportText(input: BrigadeInput, opts: { byCompany: boolean; missingNames: boolean }): string {
  const { total } = input;
  const partial = total.missing > 0 ? " (חלקי)" : "";
  const lines = [
    `*${input.battalionName} – דוח 1 · ${hebrewDayLabel(input.day)}${partial}*`,
    `בסד״כ: ${total.inSadak} מתוך ${total.roster}`,
    ...pairs([...total.groups.map((g) => `${g.name} ${g.count}`), `חסרי דיווח ${total.missing}`]),
  ];
  if (opts.byCompany && input.companies.length) {
    lines.push("*לפי פלוגה (בסד״כ / חסרים)*");
    lines.push(...pairs(input.companies.map((c) => `${c.name} ${c.summary.inSadak} / ${c.summary.missing}`)));
  }
  if (opts.missingNames && input.missingNames?.length) {
    const byCompany = new Map<string, string[]>();
    for (const m of input.missingNames) byCompany.set(m.company, [...(byCompany.get(m.company) ?? []), m.name]);
    lines.push("*חסרי דיווח*");
    for (const [company, names] of byCompany) lines.push(`${company}: ${names.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * One line per sheet row from the smallest to the largest `sheetRow` ("" where nobody sits),
 * ready to paste into the day's column. Soldiers without a sheet row are only counted.
 */
export function sheetColumnLines(rows: ReadonlyArray<{ sheetRow: number | null; value: string }>): {
  lines: string[];
  firstRow: number | null;
  notInSheet: number;
} {
  const byRow = new Map<number, string>();
  let notInSheet = 0;
  for (const r of rows) {
    if (r.sheetRow === null) notInSheet++;
    else byRow.set(r.sheetRow, r.value);
  }
  if (!byRow.size) return { lines: [], firstRow: null, notInSheet };
  const first = Math.min(...byRow.keys());
  const last = Math.max(...byRow.keys());
  const lines: string[] = [];
  for (let row = first; row <= last; row++) lines.push(byRow.get(row) ?? "");
  return { lines, firstRow: first, notInSheet };
}

const ANCHOR_EVERY = 10;

/**
 * Soldiers to check against the sheet before pasting: the first and last row and one every
 * `every` rows. If the sheet's rows moved since the last import, these names won't line up.
 */
export function sheetRowAnchors(
  rows: ReadonlyArray<{ sheetRow: number | null; name: string }>,
  every: number = ANCHOR_EVERY,
): Array<{ row: number; name: string }> {
  const byRow = new Map<number, string>();
  for (const r of rows) if (r.sheetRow !== null) byRow.set(r.sheetRow, r.name);
  if (!byRow.size) return [];
  const first = Math.min(...byRow.keys());
  const last = Math.max(...byRow.keys());
  const out: Array<{ row: number; name: string }> = [];
  for (const [row, name] of [...byRow].sort((a, b) => a[0] - b[0])) {
    if (row === first || row === last || (row - first) % every === 0) out.push({ row, name });
  }
  return out;
}
