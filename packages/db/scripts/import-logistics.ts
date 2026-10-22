/**
 * Developer import of the logistics Google Sheet (CSV exports, one file per sheet). Applies new rows
 * only; changes and app-only rows are printed (admins apply those in the app, /logistics/import).
 * Never creates soldiers or units. How to export and run it: docs/ADDING_A_MODULE.md → "Logistics import".
 *
 *   pnpm --filter @gdud/db exec tsx scripts/import-logistics.ts <folder-of-csv-exports> [--dry-run]
 *
 * Uses MIGRATION_DATABASE_URL (bypasses RLS, like bootstrap-admin). Safe to re-run: only missing rows are added.
 * Real personal data: check with ביטחון מידע first (docs/SECURITY.md).
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/schema/index";
import { SHEET_NAMES } from "../src/logistics-sheet/index";
import { loadRootEnv } from "./env";
import { formatDiff, importLogistics, readSheets } from "./logistics-import";

loadRootEnv();

const USAGE = "Usage: pnpm --filter @gdud/db exec tsx scripts/import-logistics.ts <folder-of-csv-exports> [--dry-run]";

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));
  const [folder, ...extra] = args.filter((a) => !a.startsWith("--"));
  if (!folder || extra.length || flags.some((f) => f !== "--dry-run")) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!existsSync(folder)) throw new Error(`Folder not found: ${folder}`);
  const dryRun = flags.includes("--dry-run");

  const { sheets, found, missing } = readSheets(folder);
  for (const [key, file] of Object.entries(found)) console.log(`  ${SHEET_NAMES[key as keyof typeof SHEET_NAMES]} ← ${file}`);
  for (const key of missing) console.log(`  ${SHEET_NAMES[key]} — no CSV found, skipped`);
  if (!Object.keys(found).length) throw new Error("No sheet CSVs found in that folder");

  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set MIGRATION_DATABASE_URL (or DATABASE_URL)");
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    const { diff, result } = await importLogistics(drizzle(client, { schema }), sheets, { dryRun });
    console.log(`\n${formatDiff(diff, result)}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
