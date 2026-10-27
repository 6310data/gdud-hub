import { notFound } from "next/navigation";
import { writeWorkbook } from "@gdud/db/xlsx";
import { doch1Access } from "@/lib/doch1/access";
import { reportSheets } from "@/lib/doch1/reports-export";
import { loadReportsData } from "@/lib/doch1/reports";
import { requireModule } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /doch1/reports/export[?day=] → the reports screen as .xlsx (through RLS, like the page). */
export async function GET(request: Request): Promise<Response> {
  const s = await requireModule("doch1");
  if (!doch1Access(s).canReports) notFound();
  const data = await loadReportsData(s, new URL(request.url).searchParams.get("day") ?? undefined);
  if (!data) return new Response("אין סבב פעיל", { status: 404 });

  const xlsx = await writeWorkbook(reportSheets(data));
  const name = `דוחות ${data.day}.xlsx`;
  return new Response(xlsx as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reports-${data.day}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
