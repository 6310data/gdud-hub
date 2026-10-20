import { z } from "zod";
import { withUser } from "@gdud/db";
import { companiesOf } from "@/lib/logistics/data";
import { requireModule } from "@/lib/session";
import { buildSummary, summaryCsv } from "../matrix";

/** GET /logistics/summary/export[?unit=<company>] → CSV of the summary table (through RLS, like the page). */
export async function GET(request: Request): Promise<Response> {
  const s = await requireModule("logistics");
  const unit = z.uuid().safeParse(new URL(request.url).searchParams.get("unit"));
  const company = unit.success ? companiesOf(s.units).find((c) => c.id === unit.data) : undefined;

  const m = await withUser(s.claims, (tx) => buildSummary(tx, s.units, company?.id));
  const name = `סיכום אמצעים${company ? ` - ${company.name}` : ""} ${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(summaryCsv(m, company ? "בפלוגה" : undefined), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="summary.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
