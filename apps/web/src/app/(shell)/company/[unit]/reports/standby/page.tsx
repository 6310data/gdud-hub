import { notFound } from "next/navigation";
import { z } from "zod";
import { can } from "@gdud/auth";
import { StandbyScreen } from "@/app/(shell)/doch1/standby/standby-screen";
import { requireCompanyScope } from "@/lib/company/access";

export const metadata = { title: "שבצ״ק וכוננות" };

const paramsSchema = z.object({ unit: z.uuid() });

/**
 * שבצ״ק וכוננות of the company: its own teams and vehicles (the same rows דוח 1 shows, grouped there by
 * company). Edited by the company admin, or a דוח 1 admin / company user of the company.
 */
export default async function CompanyStandby({
  params,
  searchParams,
}: {
  params: Promise<{ unit: string }>;
  searchParams: Promise<{ view?: string; co?: string; check?: string; day?: string }>;
}) {
  const p = paramsSchema.safeParse(await params);
  const { s, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  const company = scope.company;
  if (!scope.isAdmin && !can(s.user, "doch1", "any", company.id, s.parents)) notFound();
  const sp = await searchParams;
  return <StandbyScreen s={s} sp={{ ...sp, co: undefined }} path={`/company/${company.id}/reports/standby`} company={company} />;
}
