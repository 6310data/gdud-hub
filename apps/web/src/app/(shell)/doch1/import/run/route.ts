/**
 * POST /doch1/import/run?mode=preview|apply — import of the round's Google Sheet (.xlsx export),
 * battalion doch1 admin only. The response streams the import's phases (lib/progress-stream.ts)
 * so the screen can show where a long first import is. The file is parsed in memory on every
 * call and never written to disk or storage; the client sends the same File again with its
 * answers to the mapping questions.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withUser } from "@gdud/db";
import {
  applySheetImport,
  parseSheet,
  planSheetImport,
  readWorkbook,
  SheetImportError,
  type ImportMappings,
  type ParsedSheet,
} from "@gdud/db/doch1-import";
import { actionError, UserError } from "@/lib/action-result";
import { progressResponse, sameOrigin, type ProgressEmitter } from "@/lib/progress-stream";
import { doch1Ctx, firstIssue, NO_PERMISSION, revalidateDoch1 } from "../../_actions/common";

// The first import of a round writes tens of thousands of day cells in one transaction.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

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

/** Validate the upload and the answers, then read and parse the workbook. */
async function readUpload(fd: FormData, emit: ProgressEmitter): Promise<{ parsed: ParsedSheet; mappings: Partial<ImportMappings> }> {
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

  emit.phase("read");
  let grids;
  try {
    grids = await readWorkbook(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new UserError("לא הצלחנו לקרוא את הקובץ. ודאו שזה ייצוא xlsx של הגיליון.");
  }
  const parsed = parseSheet(grids);
  if (!parsed.tabs.length) throw new UserError("לא נמצאו בקובץ לשוניות של פלוגות (שורת כותרת 3 עם ״מספר אישי״ ותאריכים).");
  const rows = parsed.tabs.reduce((n, t) => n + t.rows.length, 0);
  emit.note("read", `${parsed.tabs.length} לשוניות · ${rows.toLocaleString("he-IL")} שורות חיילים`);
  return { parsed, mappings: m.data };
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: NO_PERMISSION.error }, { status: 403 });
  const ctx = await doch1Ctx();
  if (!ctx?.access.isAdmin) return NextResponse.json({ error: NO_PERMISSION.error }, { status: 403 });
  const mode = request.nextUrl.searchParams.get("mode") === "apply" ? "apply" : "preview";

  let fd: FormData;
  try {
    fd = await request.formData();
  } catch {
    return NextResponse.json({ error: "הקובץ לא הגיע לשרת. בדקו את החיבור ואת גודל הקובץ (עד 3.9MB)." }, { status: 400 });
  }

  return progressResponse(async (emit) => {
    const { parsed, mappings } = await readUpload(fd, emit);
    if (mode === "preview") {
      emit.phase("match");
      return withUser(ctx.s.claims, (tx) => planSheetImport(tx, ctx.round.id, parsed, mappings));
    }
    const full: ImportMappings = { tabs: mappings.tabs ?? {}, platoons: mappings.platoons ?? {}, statuses: mappings.statuses ?? {} };
    const counts = await withUser(ctx.s.claims, (tx) => applySheetImport(tx, ctx.round.id, parsed, full, emit.phase));
    revalidateDoch1();
    return counts;
  }, importError);
}
