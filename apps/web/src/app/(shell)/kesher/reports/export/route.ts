import { notFound } from "next/navigation";
import { z } from "zod";
import { writeWorkbook } from "@gdud/db/xlsx";
import { loadKesherReport, REPORT_KINDS } from "@/lib/kesher/reports";
import { requireModule } from "@/lib/session";

export const dynamic = "force-dynamic";

const querySchema = z.object({ r: z.enum(REPORT_KINDS), unit: z.uuid().optional() });

/** GET /kesher/reports/export?r=brigade|company[&unit=] → the report as .xlsx (through RLS, like the print page). */
export async function GET(request: Request): Promise<Response> {
  const s = await requireModule("kesher");
  const q = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!q.success) notFound();
  const report = await loadKesherReport(s, q.data.r, q.data.unit);
  if (!report) notFound();

  const xlsx = await writeWorkbook(report.sheets.map((sh) => ({ name: sh.name, tables: [{ title: report.title, head: [report.sub], rows: [] }, ...sh.tables] })));
  const name = `${report.title}.xlsx`;
  return new Response(xlsx as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${report.file}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
