/**
 * Developer import of the logistics Google Sheet (CSV exports) on top of the shared diff + apply
 * in src/logistics-sheet. The CLI is scripts/import-logistics.ts; this half has no side effects at
 * load time so test/import-logistics.test.ts can run it against PGlite.
 *
 * It applies the "new" lines only — the old "add what's missing" behaviour — so a developer run
 * never overwrites or removes app data, and never creates soldiers or units (דוח 1 owns soldiers).
 * Changes and app-only rows are printed; the in-app import (/logistics/import) applies those.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Db, Tx } from "../src/index";
import {
  applyLogistics,
  diffLogistics,
  LINE_GROUPS,
  parseCsv,
  SHEET_KEYS,
  SHEET_NAMES,
  toSheetRows,
  type ApplyResult,
  type ChangeLine,
  type LineGroup,
  type SheetDiff,
  type SheetKey,
  type Sheets,
} from "../src/logistics-sheet/index";

/**
 * Finds each sheet's CSV in `folder`. Google Sheets names a download
 * "<spreadsheet> - <sheet>.csv"; a file named just "<sheet>.csv" works too.
 */
export function readSheets(folder: string): { sheets: Sheets; found: Partial<Record<SheetKey, string>>; missing: SheetKey[] } {
  const files = readdirSync(folder).filter((f) => /\.csv$/i.test(f));
  const sheets: Sheets = {};
  const found: Partial<Record<SheetKey, string>> = {};
  const missing: SheetKey[] = [];
  for (const key of SHEET_KEYS) {
    const name = SHEET_NAMES[key];
    const file = files.find((f) => {
      const base = f.normalize("NFC").replace(/\.csv$/i, "").trim();
      return base === name || base.endsWith(` - ${name}`);
    });
    if (!file) {
      missing.push(key);
      continue;
    }
    found[key] = file;
    sheets[key] = toSheetRows(parseCsv(readFileSync(path.join(folder, file), "utf8")));
  }
  return { sheets, found, missing };
}

/** Diffs every tab found and, unless `dryRun`, applies the new lines — in one transaction. */
export async function importLogistics(
  db: { transaction: Db["transaction"] },
  sheets: Sheets,
  opts: { dryRun: boolean },
): Promise<{ diff: SheetDiff; result: ApplyResult | null }> {
  const tabs = SHEET_KEYS.filter((k) => sheets[k]);
  return db.transaction(async (t) => {
    const tx = t as Tx;
    const diff = await diffLogistics(tx, sheets, tabs);
    if (opts.dryRun) return { diff, result: null };
    const fresh = diff.lines.filter((l) => l.group === "new" && l.defaultOn).map((l) => l.id);
    return { diff, result: await applyLogistics(tx, diff, new Set(fresh)) };
  });
}

/* ── output ──────────────────────────────────────────────────────────────── */

const GROUP_TITLE: Record<LineGroup, string> = {
  new: "New",
  change: "Changed in the sheet (not applied by the CLI — use /logistics/import)",
  appOnly: "Only in the app (not removed by the CLI)",
  error: "Rows that can't be read",
};

function describeLine(l: ChangeLine): string {
  const where = l.row === null ? `${SHEET_NAMES[l.sheet]} (app)` : `${SHEET_NAMES[l.sheet]} row ${l.row}`;
  const what = [l.kind, l.item, l.serial, l.personName].filter(Boolean).join(" ");
  const change = l.before !== null || l.after !== null ? ` ${l.before ?? ""} → ${l.after ?? ""}` : "";
  return `  ${where}: ${what}${change}${l.message ? ` — ${l.message}` : ""}`;
}

export function formatDiff(diff: SheetDiff, result: ApplyResult | null): string {
  const out = [result ? "Import committed" : "DRY RUN — nothing was written", ""];
  for (const g of LINE_GROUPS) {
    const n = diff.lines.filter((l) => l.group === g).length;
    out.push(`  ${g.padEnd(8)} ${String(n).padStart(5)}${result && g === "new" ? `   applied ${result.applied.new}` : ""}`);
  }
  const identical = SHEET_KEYS.map((k) => (diff.identical[k] ? `${SHEET_NAMES[k]} ${diff.identical[k]}` : "")).filter(Boolean);
  if (identical.length) out.push(`  identical: ${identical.join(", ")}`);
  for (const g of LINE_GROUPS) {
    const lines = diff.lines.filter((l) => l.group === g);
    if (!lines.length) continue;
    out.push("", `${GROUP_TITLE[g]} (${lines.length}):`, ...lines.map(describeLine));
  }
  if (result?.blocked.length) {
    out.push("", `Blocked (${result.blocked.length}):`, ...result.blocked.map((b) => `  ${b.id}: ${b.reason}`));
  }
  return out.join("\n");
}
