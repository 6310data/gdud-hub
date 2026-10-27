import { redirect } from "next/navigation";
import { israelClock } from "@gdud/core";
import { doch1Access } from "@/lib/doch1/access";
import { loadReportsData } from "@/lib/doch1/reports";
import { requireModule } from "@/lib/session";
import { ReportsView } from "./_components/reports-view";

export const metadata = { title: "דוח 1 · דוחות" };

/**
 * דוחות (mockup screen 04): the sheet's דוחות tab, built from דוח 1 and the שבצ״ק of `?day=`.
 * Admin and viewers see the battalion; a company user their company (RLS).
 */
export default async function Doch1Reports({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const s = await requireModule("doch1");
  const access = doch1Access(s);
  if (!access.canReports) redirect("/doch1/today");
  const sp = await searchParams;
  const data = await loadReportsData(s, sp.day);
  if (!data) return null; // the layout shows "אין סבב פעיל"
  return <ReportsView data={data} isAdmin={access.isAdmin} isMaster={access.isMaster} clock={israelClock(new Date())} />;
}
