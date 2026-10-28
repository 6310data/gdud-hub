import { notFound } from "next/navigation";
import { z } from "zod";
import { can } from "@gdud/auth";
import { TeamScreen } from "@/app/(shell)/doch1/standby/[teamId]/team-screen";
import { requireCompanyScope } from "@/lib/company/access";

export const metadata = { title: "עריכת צוות כוננות" };

const paramsSchema = z.object({ unit: z.uuid(), teamId: z.string() });

/** A team of the company's own כוננות, in דוח 1's team editor. */
export default async function CompanyStandbyTeam({ params }: { params: Promise<{ unit: string; teamId: string }> }) {
  const p = paramsSchema.safeParse(await params);
  if (!p.success) notFound();
  const { s, scope } = await requireCompanyScope(p.data.unit);
  const company = scope.company;
  if (!scope.isAdmin && !can(s.user, "doch1", "any", company.id, s.parents)) notFound();
  return <TeamScreen s={s} teamId={p.data.teamId} basePath={`/company/${company.id}/reports/standby`} company={company} />;
}
