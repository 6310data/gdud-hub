import Link from "next/link";
import { z } from "zod";
import { withUser } from "@gdud/db";
import { Empty, PageHeader } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { companyStatus, groupBy, loadKesher, loadLastChecks } from "@/lib/kesher/data";
import { fmtCount, fmtWhen } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { CompanyDot, ReportChip } from "../_components/ui";
import { CheckScreen, Reminders } from "./check-screen";

export const metadata = { title: "דוח צ׳" };

const searchSchema = z.object({ unit: z.uuid().optional().catch(undefined) });

/**
 * דוח צ׳ (mockup #/check): a company's visual check. Without a company: the companies the user
 * covers with their last report. With one: every צ׳ on the company to tick as seen. Anyone covering
 * the company files it (kesher_checks_insert); the reporter is the signed-in user.
 */
export default async function KesherCheck({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  const f = searchSchema.parse(await searchParams);
  const now = new Date();

  if (!access.companies.length) {
    return (
      <>
        <PageHeader title="דוח צ׳" />
        <div className="tz-card">
          <Empty>אין לך פלוגה לדווח עליה.</Empty>
        </div>
      </>
    );
  }

  const company = access.companies.find((c) => c.id === f.unit) ?? (access.companies.length === 1 ? access.companies[0] : undefined);
  if (company) return <CheckScreen s={s} company={company} companies={access.companies} path="/kesher/check" />;

  const { data, lastChecks } = await withUser(s.claims, async (tx) => {
    const [data, lastChecks] = await Promise.all([loadKesher(tx, s.units), loadLastChecks(tx)]);
    return { data, lastChecks };
  });
  const byCompany = groupBy(
    data.serials.filter((x) => x.location === "company"),
    (x) => x.unitId,
  );
  return (
    <>
      <PageHeader title="דוח צ׳" sub="בדיקה בעין של הצ׳ שעל הפלוגה. בוחרים פלוגה:" />
      <div className="tz-group">
        {access.companies.map((c) => {
          const last = lastChecks.get(c.id);
          return (
            <Link key={c.id} href={`/kesher/check?unit=${c.id}`} className="tz-row no-underline">
              <CompanyDot color={c.color} />
              <span className="tz-row-body">
                <span className="tz-row-title">
                  {c.name}
                  <span className="tz-row-sub">
                    {fmtCount(byCompany.get(c.id)?.length ?? 0)} צ׳{last ? ` · דוח אחרון ${fmtWhen(last.at, now)}` : ""}
                  </span>
                </span>
                <ReportChip status={companyStatus(last, data.staleDays, now)} />
              </span>
            </Link>
          );
        })}
      </div>
      <Reminders />
    </>
  );
}

