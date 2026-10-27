"use server";
/**
 * ייבוא מהגיליון: the battalion kesher admin uploads "פיזור ושליטה מחלקת קשר" as .xlsx, picks tabs,
 * previews the changes and applies the lines they keep ticked. Nothing is stored between the
 * steps: every call re-sends the file, and apply re-diffs inside its transaction and aborts if the
 * preview's fingerprint no longer matches. The file is parsed in memory only; logs never contain
 * cell values. Emails and access codes in the sheet are never read.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@gdud/auth";
import { schema, withUser } from "@gdud/db";
import {
  applyKesher,
  diffKesher,
  KESHER_SHEET_KEYS,
  readKesherBook,
  SheetFileError,
  summarizeImport,
  toPreview,
  type ApplyResult,
  type KesherBook,
  type KesherSheetKey,
  type PreviewLine,
} from "@gdud/db/kesher-sheet";
import { checkUploadFile, STALE_PREVIEW, type ImportTab } from "@gdud/db/sheet-import/preview";
import { dbErrorMessage, pgCode, UserError, type ActionOutcome } from "@/lib/action-result";
import { getSession } from "@/lib/session";

const NO_PERMISSION = { error: "אין לך הרשאה לפעולה הזו." } as const;
const MAX_SELECTED = 5000;
const MAX_PICKS = 500;

const tabsSchema = z
  .array(z.enum(KESHER_SHEET_KEYS, "לשונית לא מוכרת"))
  .min(1, "בחרו לפחות לשונית אחת")
  .transform((t) => [...new Set(t)]);
/** "companyId|nameKey=personId" — a soldier the admin picked for an ambiguous name */
const picksSchema = z
  .array(z.string().regex(/^[0-9a-f-]{36}\|[^=]{1,120}=[0-9a-f-]{36}$/, "בחירת חייל לא תקינה"))
  .max(MAX_PICKS)
  .transform((list) => new Map(list.map((p) => [p.slice(0, p.lastIndexOf("=")), p.slice(p.lastIndexOf("=") + 1)])));
const applySchema = z.object({
  tabs: tabsSchema,
  picks: picksSchema,
  selected: z.array(z.string().min(1).max(300)).max(MAX_SELECTED, "יותר מדי שורות"),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "תצוגה מקדימה לא תקינה — הציגו שוב"),
});

export interface PreviewData {
  lines: PreviewLine[];
  identical: Partial<Record<KesherSheetKey, number>>;
  fingerprint: string;
}

const firstIssue = (err: z.ZodError) => err.issues[0]?.message ?? "קלט לא תקין";

/** Battalion-wide kesher admin (or super admin) only. */
async function importCtx() {
  const s = await getSession();
  return s && can(s.user, "kesher", ["admin"], null) ? s : null;
}

/** The uploaded workbook, checked by type and size before parsing; parsed in memory and dropped. */
async function readUpload(form: FormData): Promise<{ fileName: string; book: KesherBook }> {
  const file = form.get("file");
  if (!(file instanceof File)) throw new UserError("בחרו קובץ");
  const problem = checkUploadFile(file);
  if (problem) throw new UserError(problem);
  try {
    return { fileName: file.name, book: await readKesherBook(new Uint8Array(await file.arrayBuffer())) };
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
  console.error("kesher sheet import failed:", e instanceof Error ? e.name : typeof e);
  return "הייבוא נכשל ולא נשמר דבר. נסו שוב.";
}

/** Step 1: which tabs the file has, recognised or not, with row counts. */
export async function inspectKesherFile(form: FormData): Promise<ActionOutcome<{ fileName: string; tabs: ImportTab[] }>> {
  if (!(await importCtx())) return NO_PERMISSION;
  try {
    const { fileName, book } = await readUpload(form);
    if (!book.tabs.some((t) => t.key)) throw new UserError("לא נמצאה אף לשונית של גיליון מחלקת הקשר בקובץ");
    return { ok: true, data: { fileName, tabs: book.tabs } };
  } catch (e) {
    return { error: importError(e) };
  }
}

/** Step 2: the line-by-line preview. Writes nothing. */
export async function previewKesherImport(form: FormData): Promise<ActionOutcome<PreviewData>> {
  const s = await importCtx();
  if (!s) return NO_PERMISSION;
  const tabs = tabsSchema.safeParse(form.getAll("tabs"));
  const picks = picksSchema.safeParse(form.getAll("pick"));
  if (!tabs.success) return { error: firstIssue(tabs.error) };
  if (!picks.success) return { error: firstIssue(picks.error) };
  try {
    const { book } = await readUpload(form);
    const diff = await withUser(s.claims, (tx) => diffKesher(tx, book.sheets, tabs.data, picks.data));
    return { ok: true, data: { lines: diff.lines.map(toPreview), identical: diff.identical, fingerprint: diff.fingerprint } };
  } catch (e) {
    return { error: importError(e) };
  }
}

/** Step 3: re-diff, check the fingerprint, apply the ticked lines and log one event — one transaction. */
export async function applyKesherImport(form: FormData): Promise<ActionOutcome<ApplyResult>> {
  const s = await importCtx();
  if (!s) return NO_PERMISSION;
  const parsed = applySchema.safeParse({
    tabs: form.getAll("tabs"),
    picks: form.getAll("pick"),
    selected: form.getAll("selected"),
    fingerprint: form.get("fingerprint"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { tabs, picks, fingerprint } = parsed.data;
  const selected = new Set(parsed.data.selected);
  if (!selected.size) return { error: "לא סומנו שינויים לייבוא" };
  let result: ApplyResult;
  try {
    const { fileName, book } = await readUpload(form);
    result = await withUser(s.claims, async (tx) => {
      const diff = await diffKesher(tx, book.sheets, tabs, picks);
      if (diff.fingerprint !== fingerprint) throw new UserError(STALE_PREVIEW);
      const applied = await applyKesher(tx, diff, selected);
      const unticked = diff.lines.filter((l) => l.defaultOn && !selected.has(l.id)).length;
      // actor_name is set by the kesher_events_actor trigger
      await tx.insert(schema.kesherEvents).values({ kind: "import", details: summarizeImport(fileName, tabs, applied, unticked) });
      return applied;
    });
  } catch (e) {
    return { error: importError(e) };
  }
  revalidatePath("/kesher", "layout");
  return { ok: true, data: result };
}
