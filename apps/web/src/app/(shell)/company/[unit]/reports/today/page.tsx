import { notFound } from "next/navigation";
import { z } from "zod";
import { TodayScreen } from "@/app/(shell)/doch1/today/today-screen";
import { requireCompanyScope } from "@/lib/company/access";
import { subtreeIds } from "@/lib/company/data";
import { doch1Access } from "@/lib/doch1/access";

export const metadata = { title: "דוח 1 של היום" };

const paramsSchema = z.object({ unit: z.uuid() });

/**
 * דוח 1 של היום inside the company app: דוח 1's own screen, limited to the company and its platoons,
 * filled with the דוח 1 roles (call 33). Soldiers open in the company app.
 */
export default async function CompanyToday({ params, searchParams }: { params: Promise<{ unit: string }>; searchParams: Promise<{ unit?: string; day?: string }> }) {
  const p = paramsSchema.safeParse(await params);
  const { s, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  const company = scope.company;
  const inCompany = new Set(subtreeIds(company.id, s.units));
  const d1 = doch1Access(s);
  if (![...inCompany].some((id) => d1.canReport(id)) && !scope.isAdmin) notFound();
  const base = `/company/${company.id}`;
  return (
    <TodayScreen
      s={s}
      sp={await searchParams}
      path={`${base}/reports/today`}
      only={(id) => inCompany.has(id)}
      soldierHref={`${base}/people`}
      datesHref={() => null}
    />
  );
}
