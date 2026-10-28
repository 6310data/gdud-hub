import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckScreen } from "@/app/(shell)/kesher/check/check-screen";
import { requireCompanyScope } from "@/lib/company/access";
import { kesherAccess } from "@/lib/kesher/access";

export const metadata = { title: "דוח צ׳" };

const paramsSchema = z.object({ unit: z.uuid() });

/** דוח צ׳ of the company inside the company app: kesher's own form, filed with a kesher role (call 33). */
export default async function CompanyCheck({ params }: { params: Promise<{ unit: string }> }) {
  const p = paramsSchema.safeParse(await params);
  const { s, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  const company = scope.company;
  if (!kesherAccess(s).covers(company.id)) notFound();
  const reports = `/company/${company.id}/reports`;
  return <CheckScreen s={s} company={company} companies={[]} path={`${reports}/check`} done={{ href: reports, label: "לדוחות הפלוגה" }} />;
}
