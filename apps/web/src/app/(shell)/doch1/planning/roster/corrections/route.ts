/**
 * POST /doch1/planning/roster/corrections — "קובץ תיקונים לגדוד": the decisions that disagree with
 * the battalion's list, as xlsx. Battalion doch1 admin only; built on request, never stored.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withUser } from "@gdud/db";
import { corrections, correctionsWorkbook, planRoster } from "@gdud/db/doch1-roster-import";
import { unitNamer } from "@/lib/doch1/roster";
import { sameOrigin } from "@/lib/progress-stream";
import { doch1PlanningCtx, NO_PERMISSION } from "../../../_actions/common";
import { readRosterUpload, rosterError } from "../upload";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: NO_PERMISSION.error }, { status: 403 });
  const ctx = await doch1PlanningCtx();
  if (!ctx?.access.isAdmin) return NextResponse.json({ error: NO_PERMISSION.error }, { status: 403 });
  try {
    const upload = await readRosterUpload(await request.formData());
    const plan = await withUser(ctx.s.claims, (tx) =>
      planRoster(tx, { planningRoundId: ctx.round.id, baseRoundId: upload.baseRoundId, file: upload.file, answers: upload.answers }),
    );
    const bytes = await correctionsWorkbook(corrections(plan, upload.decisions, unitNamer(ctx.s.units, plan)));
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="corrections.xlsx"; filename*=UTF-8''${encodeURIComponent(`תיקונים לגדוד · ${ctx.round.name}.xlsx`)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: rosterError(err) }, { status: 400 });
  }
}
