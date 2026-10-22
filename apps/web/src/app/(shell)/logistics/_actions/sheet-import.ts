"use server";
/**
 * ייבוא מהגיליון: the logistics admin uploads the Google Sheet as .xlsx, picks tabs, previews the
 * changes and applies the lines they keep ticked. Nothing is stored between the steps: every call
 * re-sends the file, and apply re-diffs inside its transaction and aborts if the preview's
 * fingerprint no longer matches. The file is parsed in memory only; logs never contain cell values.
 */
import { z } from "zod";
import { withUser } from "@gdud/db";
import {
  applyLogistics,
  checkUploadFile,
  diffLogistics,
  readXlsx,
  SHEET_KEYS,
  SheetFileError,
  summarizeImport,
  toPreview,
  type ApplyResult,
  type PreviewLine,
  type SheetKey,
  type XlsxBook,
  type XlsxTab,
} from "@gdud/db/logistics-sheet";
import { dbErrorMessage, pgCode, UserError, type ActionOutcome } from "@/lib/action-result";
import { STALE_PREVIEW } from "../import/messages";
import { firstIssue, logEvents, logisticsCtx, NO_PERMISSION, revalidateLogistics } from "./common";

const MAX_SELECTED = 5000;

const tabsSchema = z
  .array(z.enum(SHEET_KEYS as [SheetKey, ...SheetKey[]], "לשונית לא מוכרת"))
  .min(1, "בחרו לפחות לשונית אחת")
  .transform((t) => [...new Set(t)]);
const applySchema = z.object({
  tabs: tabsSchema,
  selected: z.array(z.string().min(1).max(300)).max(MAX_SELECTED, "יותר מדי שורות"),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "תצוגה מקדימה לא תקינה — הציגו שוב"),
});

export interface PreviewData {
  lines: PreviewLine[];
  identical: Partial<Record<SheetKey, number>>;
  fingerprint: string;
}

/** Battalion-wide logistics admin (or super admin) only. */
async function importCtx() {
  const ctx = await logisticsCtx();
  return ctx?.access.isStockAdmin ? ctx : null;
}

/** The uploaded workbook, checked by type and size before parsing; parsed in memory and dropped. */
async function readUpload(form: FormData): Promise<{ fileName: string; book: XlsxBook }> {
  const file = form.get("file");
  if (!(file instanceof File)) throw new UserError("בחרו קובץ");
  const problem = checkUploadFile(file);
  if (problem) throw new UserError(problem);
  try {
    return { fileName: file.name, book: await readXlsx(new Uint8Array(await file.arrayBuffer())) };
  } catch (e) {
    if (e instanceof SheetFileError) {
      throw new UserError("הקובץ לא נקרא – ודאו שהורדתם אותו מ-Google Sheets כ-Microsoft Excel (.xlsx)");
    }
    throw e;
  }
}

/**
 * Like actionError, but never logs the error object: a failed query carries its parameters,
 * which here are cell values from the sheet.
 */
function importError(e: unknown): string {
  if (e instanceof UserError) return e.message;
  const code = pgCode(e);
  if (code) return dbErrorMessage({ code });
  console.error("logistics sheet import failed:", e instanceof Error ? e.name : typeof e);
  return "הייבוא נכשל ולא נשמר דבר. נסו שוב.";
}

/** Step 1: which tabs the file has, recognised or not, with row counts. */
export async function inspectSheetFile(form: FormData): Promise<ActionOutcome<{ fileName: string; tabs: XlsxTab[] }>> {
  const ctx = await importCtx();
  if (!ctx) return NO_PERMISSION;
  try {
    const { fileName, book } = await readUpload(form);
    if (!book.tabs.some((t) => t.key)) throw new UserError("לא נמצאה אף לשונית של גיליון הלוגיסטיקה בקובץ");
    return { ok: true, data: { fileName, tabs: book.tabs } };
  } catch (e) {
    return { error: importError(e) };
  }
}

/** Step 2: the line-by-line preview. Writes nothing. */
export async function previewSheetImport(form: FormData): Promise<ActionOutcome<PreviewData>> {
  const ctx = await importCtx();
  if (!ctx) return NO_PERMISSION;
  const tabs = tabsSchema.safeParse(form.getAll("tabs"));
  if (!tabs.success) return { error: firstIssue(tabs.error) };
  try {
    const { book } = await readUpload(form);
    const diff = await withUser(ctx.s.claims, (tx) => diffLogistics(tx, book.sheets, tabs.data));
    return { ok: true, data: { lines: diff.lines.map(toPreview), identical: diff.identical, fingerprint: diff.fingerprint } };
  } catch (e) {
    return { error: importError(e) };
  }
}

/** Step 3: re-diff, check the fingerprint, apply the ticked lines and log one event — one transaction. */
export async function applySheetImport(form: FormData): Promise<ActionOutcome<ApplyResult>> {
  const ctx = await importCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = applySchema.safeParse({
    tabs: form.getAll("tabs"),
    selected: form.getAll("selected"),
    fingerprint: form.get("fingerprint"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { tabs, fingerprint } = parsed.data;
  const selected = new Set(parsed.data.selected);
  if (!selected.size) return { error: "לא סומנו שינויים לייבוא" };
  let result: ApplyResult;
  try {
    const { fileName, book } = await readUpload(form);
    result = await withUser(ctx.s.claims, async (tx) => {
      const diff = await diffLogistics(tx, book.sheets, tabs);
      if (diff.fingerprint !== fingerprint) throw new UserError(STALE_PREVIEW);
      const applied = await applyLogistics(tx, diff, selected);
      const unticked = diff.lines.filter((l) => l.defaultOn && !selected.has(l.id)).length;
      await logEvents(tx, ctx.actorName, [{ kind: "sheet_import", details: summarizeImport(fileName, tabs, applied, unticked) }]);
      return applied;
    });
  } catch (e) {
    return { error: importError(e) };
  }
  revalidateLogistics();
  return { ok: true, data: result };
}
