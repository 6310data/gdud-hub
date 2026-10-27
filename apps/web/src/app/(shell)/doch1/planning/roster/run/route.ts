/**
 * POST /doch1/planning/roster/run?mode=preview|apply — the battalion's soldier list compared with the
 * base round (preview), or the admin's decisions written into the round being planned (apply).
 * Battalion doch1 admin only. Streams its phases (lib/progress-stream.ts); the file is parsed in
 * memory on every call and never stored — the client sends it again with its answers and decisions.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq, schema, withUser } from "@gdud/db";
import { applyRoster, planRoster } from "@gdud/db/doch1-roster-import";
import { rosterPreview } from "@/lib/doch1/roster";
import { progressResponse, sameOrigin } from "@/lib/progress-stream";
import { doch1PlanningCtx, NO_PERMISSION, revalidateDoch1 } from "../../../_actions/common";
import { readRosterUpload, rosterError } from "../upload";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: NO_PERMISSION.error }, { status: 403 });
  const ctx = await doch1PlanningCtx();
  if (!ctx?.access.isAdmin) return NextResponse.json({ error: NO_PERMISSION.error }, { status: 403 });
  const mode = request.nextUrl.searchParams.get("mode") === "apply" ? "apply" : "preview";

  let fd: FormData;
  try {
    fd = await request.formData();
  } catch {
    return NextResponse.json({ error: "הקובץ לא הגיע לשרת. בדקו את החיבור ואת גודל הקובץ (עד 3.9MB)." }, { status: 400 });
  }

  return progressResponse(async (emit) => {
    emit.phase("read");
    const upload = await readRosterUpload(fd);
    emit.note("read", `${upload.file.rows.length.toLocaleString("he-IL")} שורות חיילים`);
    emit.phase("match");
    const input = { planningRoundId: ctx.round.id, baseRoundId: upload.baseRoundId, file: upload.file, answers: upload.answers };
    if (mode === "preview") {
      return withUser(ctx.s.claims, async (tx) => {
        const plan = await planRoster(tx, input);
        const [base] = plan.baseRoundId
          ? await tx.select({ name: schema.doch1Rounds.name }).from(schema.doch1Rounds).where(eq(schema.doch1Rounds.id, plan.baseRoundId))
          : [];
        return rosterPreview(plan, ctx.s.units, base?.name ?? null);
      });
    }
    emit.phase("apply");
    const counts = await withUser(ctx.s.claims, (tx) => applyRoster(tx, { ...input, decisions: upload.decisions }));
    revalidateDoch1();
    return counts;
  }, rosterError);
}
