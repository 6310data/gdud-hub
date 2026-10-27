import Link from "next/link";
import { z } from "zod";
import { byHe } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Empty, PageHeader } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { companyStatus, groupBy, loadKesher, loadLastChecks, loadLastSeen } from "@/lib/kesher/data";
import { fmtCount, fmtWhen } from "@/lib/logistics/format";
import { displayName, requireModule } from "@/lib/session";
import { CompanyDot, ReportChip, pillCount } from "../_components/ui";
import { CheckForm, type CheckGroup } from "./_components/check-form";

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

  const { data, lastChecks, lastSeen } = await withUser(s.claims, async (tx) => {
    const [data, lastChecks, lastSeen] = await Promise.all([loadKesher(tx, s.units), loadLastChecks(tx), loadLastSeen(tx)]);
    return { data, lastChecks, lastSeen };
  });
  const byCompany = groupBy(
    data.serials.filter((x) => x.location === "company"),
    (x) => x.unitId,
  );
  const company = access.companies.find((c) => c.id === f.unit) ?? (access.companies.length === 1 ? access.companies[0] : undefined);

  if (!company) {
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
      </>
    );
  }

  const mine = byCompany.get(company.id) ?? [];
  const groups: CheckGroup[] = [...groupBy(mine, (x) => x.itemName)]
    .sort(([a], [b]) => byHe(a, b))
    .map(([type, list]) => ({
      type,
      rows: list.map((x) => ({
        id: x.id,
        serial: x.serial,
        holder: [x.holder?.holder?.name, x.holder?.holderRole, x.holder?.frame].filter(Boolean).join(" · ") || null,
        missedLast: lastSeen.get(x.id)?.found === false,
      })),
    }));
  const last = lastChecks.get(company.id);

  return (
    <>
      {access.companies.length > 1 ? (
        <nav className="tz-pills" aria-label="פלוגות">
          {access.companies.map((c) => (
            <Link key={c.id} href={`/kesher/check?unit=${c.id}`} className="tz-pill" aria-current={c.id === company.id ? "page" : undefined}>
              <CompanyDot color={c.color} />
              {c.name} {pillCount(byCompany.get(c.id)?.length ?? 0)}
            </Link>
          ))}
        </nav>
      ) : null}
      <PageHeader
        title={`דוח צ׳ · ${company.name}`}
        sub={`${fmtCount(mine.length)} צ׳ על הפלוגה · מסמנים כל צ׳ שנראה בעין${last ? ` · דוח אחרון ${fmtWhen(last.at, now)}${last.reporterName ? ` (${last.reporterName})` : ""}` : ""}`}
      />
      {mine.length ? (
        <CheckForm key={company.id} unitId={company.id} companyName={company.name} reporter={displayName(s.user, s.claims)} groups={groups} />
      ) : (
        <div className="tz-card">
          <Empty>אין צ׳ על הפלוגה — אין מה לדווח.</Empty>
        </div>
      )}
    </>
  );
}
