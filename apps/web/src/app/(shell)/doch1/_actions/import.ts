"use server";
/**
 * Import of the round's Google Sheet (.xlsx export) — battalion doch1 admin only.
 * The file is parsed in memory on every call and never written to disk or storage;
 * the client sends the same File again with its answers to the mapping questions.
 */
import { z } from "zod";
import { withUser } from "@gdud/db";
import {
  applySheetImport as applyImport,
  parseSheet,
  planSheetImport,
  readWorkbook,
  SheetImportError,
  type ImportCounts,
  type ImportMappings,
  type ParsedSheet,
  type SheetImportPlan,
} from "@gdud/db/doch1-import";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { doch1Ctx, firstIssue, NO_PERMISSION, revalidateDoch1, type Doch1Ctx } from "./common";

/** Vercel rejects request bodies over 4.5 MB; leave room for the rest of the form. */
const MAX_FILE_BYTES = 3.9 * 1024 * 1024;
const MAX_ANSWERS = 1000;

const target = z.string().min(1).max(200);
const answers = z.record(z.string().max(200), target).refine((r) => Object.keys(r).length <= MAX_ANSWERS, "יותר מדי תשובות");
const mappingsInput = z.object({
  tabs: answers.optional(),
  platoons: answers.optional(),
  statuses: answers.optional(),
});

/** The importer's own checks (open questions, missing core role) carry messages meant for the admin. */
function importError(err: unknown): string {
  return err instanceof SheetImportError ? err.message : actionError(err);
}

async function adminCtx(): Promise<Doch1Ctx | null> {
  const ctx = await doch1Ctx();
  return ctx?.access.isAdmin ? ctx : null;
}

/** Validate the upload and the answers, then read and parse the workbook. */
async function readUpload(fd: FormData): Promise<{ parsed: ParsedSheet; mappings: Partial<ImportMappings> }> {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) throw new UserError("צריך קובץ xlsx");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new UserError("צריך קובץ xlsx");
  if (file.size > MAX_FILE_BYTES) throw new UserError("הקובץ גדול מדי (עד 3.9MB)");

  let raw: unknown = {};
  try {
    raw = JSON.parse(String(fd.get("mappings") ?? "{}"));
  } catch {
    throw new UserError("המיפוי לא תקין");
  }
  const m = mappingsInput.safeParse(raw);
  if (!m.success) throw new UserError(firstIssue(m.error));

  let grids;
  try {
    grids = await readWorkbook(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new UserError("לא הצלחנו לקרוא את הקובץ. ודאו שזה ייצוא xlsx של הגיליון.");
  }
  const parsed = parseSheet(grids);
  if (!parsed.tabs.length) throw new UserError("לא נמצאו בקובץ לשוניות של פלוגות (שורת כותרת 3 עם ״מספר אישי״ ותאריכים).");
  return { parsed, mappings: m.data };
}

export async function previewSheetImport(fd: FormData): Promise<ActionOutcome<SheetImportPlan>> {
  const ctx = await adminCtx();
  if (!ctx) return NO_PERMISSION;
  try {
    const { parsed, mappings } = await readUpload(fd);
    const plan = await withUser(ctx.s.claims, (tx) => planSheetImport(tx, ctx.round.id, parsed, mappings));
    return { ok: true, data: plan };
  } catch (err) {
    return { error: importError(err) };
  }
}

export async function applySheetImport(fd: FormData): Promise<ActionOutcome<ImportCounts>> {
  const ctx = await adminCtx();
  if (!ctx) return NO_PERMISSION;
  try {
    const { parsed, mappings } = await readUpload(fd);
    const full: ImportMappings = { tabs: mappings.tabs ?? {}, platoons: mappings.platoons ?? {}, statuses: mappings.statuses ?? {} };
    const counts = await withUser(ctx.s.claims, (tx) => applyImport(tx, ctx.round.id, parsed, full));
    revalidateDoch1();
    return { ok: true, data: counts };
  } catch (err) {
    return { error: importError(err) };
  }
}
