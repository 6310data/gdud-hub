/**
 * The kesher Google Sheet ("פיזור ושליטה מחלקת קשר") mapping used by the in-app import:
 * read (xlsx → tabs) → diff (tabs + app → change lines) → apply (ticked lines → writes).
 */
export * from "./sheet";
export * from "./types";
export * from "./preview";
export { diffKesher } from "./diff";
export { applyKesher, summarizeImport } from "./apply";
export { SheetFileError } from "../sheet-import/xlsx";
