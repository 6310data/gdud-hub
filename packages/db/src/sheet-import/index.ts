/** Shared by the sheet imports (logistics, kesher): reading the xlsx and the preview bookkeeping. */
import { createHash } from "node:crypto";

export * from "./xlsx";
export * from "./preview";

/** sha256 over what the preview showed: changes when the app (or the file) changes the lines. */
export function fingerprintLines(lines: readonly { id: string; before: string | null; after: string | null; message: string | null }[]): string {
  const shown = [...lines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l) => [l.id, l.before, l.after, l.message]);
  return createHash("sha256").update(JSON.stringify(shown)).digest("hex");
}

/** An update that touches no row means RLS hid it or the app changed: abort the whole import. */
export function expectRow<T>(rows: T[], what: string): T {
  if (!rows[0]) throw new Error(`Sheet import: ${what} was not updated`);
  return rows[0];
}

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
