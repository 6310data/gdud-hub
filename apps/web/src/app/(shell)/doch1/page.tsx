import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@gdud/auth";
import { hebrewDayLabel, israelClock, israelToday, missingMembers, summarize } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { loadActiveRound, loadDays, loadMembers, loadRoundCompanies, loadStatuses } from "@/lib/doch1/data";
import { requireModule } from "@/lib/session";
import { CompanyTable, type CompanySummary } from "./_components/company-table";
import { CompositionBar } from "./_components/composition-bar";
import { KpiRow } from "./_components/kpi-row";
import { Panel } from "./_components/panel";

export const metadata = { title: "דוח 1 · סקירה" };

/** Battalion overview (mockup screens 01 / 06): KPIs, composition, per-company completion, who is missing. */
export default async function Doch1Overview({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  const s = await requireModule("doch1");
  if (!doch1Access(s).canOverview) redirect("/doch1/today");
  const sp = await searchParams;
  const now = new Date();
  const today = israelToday(now);

  const data = await withUser(s.claims, async (tx) => {
    const round = await loadActiveRound(tx);
    if (!round) return null;
    const [companies, members, statuses, days] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadStatuses(tx, round.id, { includeInactive: true }),
      loadDays(tx, round.id, [today]),
    ]);
    return { round, companies, members, statuses, day: days.get(today)! };
  });
  if (!data) return null; // the layout shows "אין סבב פעיל"

  const access = doch1Access(s, data.companies.filter((c) => c.active).map((c) => c.unitId));
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const companies = data.companies
    .filter((c) => c.active && unitById.has(c.unitId) && can(s.user, "doch1", "any", c.unitId, s.parents))
    .map((c) => unitById.get(c.unitId)!)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"));
  const rows: CompanySummary[] = companies.map((c) => ({
    unitId: c.id,
    name: c.name,
    summary: summarize(
      data.members.filter((m) => m.companyId === c.id),
      data.day,
      data.statuses,
    ),
  }));
  const visible = data.members.filter((m) => companies.some((c) => c.id === m.companyId));
  const total = summarize(visible, data.day, data.statuses);
  const scope = sp.unit && rows.some((r) => r.unitId === sp.unit) ? sp.unit : null;
  const scoped = scope ? rows.find((r) => r.unitId === scope)!.summary : total;
  const missingByCompany = companies
    .map((c) => ({ company: c, people: missingMembers(visible.filter((m) => m.companyId === c.id), data.day) }))
    .filter((x) => x.people.length);

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col">
        <span className="tz-footnote">
          {hebrewDayLabel(today)} · עודכן {israelClock(now)}
        </span>
        <h1 className="tz-title">סקירה גדודית</h1>
      </div>

      <nav className="tz-pills" aria-label="היקף">
        <Link href="/doch1" className="tz-pill" aria-current={scope ? undefined : "page"}>
          כל הגדוד <span className="tz-pill-count">{total.roster}</span>
        </Link>
        {rows.map((r) => (
          <Link key={r.unitId} href={`/doch1?unit=${r.unitId}`} className="tz-pill" aria-current={scope === r.unitId ? "page" : undefined}>
            {r.name} <span className="tz-pill-count">{r.summary.roster}</span>
          </Link>
        ))}
      </nav>

      <KpiRow summary={scoped} />

      <Panel title={`איפה כולם היום · ${scope ? rows.find((r) => r.unitId === scope)!.name : "כל הגדוד"}`}>
        <CompositionBar summary={scoped} />
      </Panel>

      <Panel title="מצב לפי פלוגה" footer="פלוגה שאינה פעילה בסבב אינה נספרת.">
        <CompanyTable rows={rows} total={total} groupNames={total.groups.map((g) => g.name)} isAdmin={access.isAdmin} />
      </Panel>

      <Panel title="דורש טיפול היום">
        {missingByCompany.length ? (
          missingByCompany.map(({ company, people }) => (
            <details key={company.id} className="border-b border-separator last:border-b-0">
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="font-semibold">{company.name}</span> · חסרים {people.length} דיווחים
                </span>
                <Link href={`/doch1/today?unit=${company.id}`} className="text-[13px] font-semibold text-primary no-underline">
                  לדוח הפלוגה
                </Link>
              </summary>
              <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-[14px]">
                {people.map((p) => (
                  <li key={p.personId}>
                    {p.name}
                    {p.platoonName ? <span className="tz-footnote"> · {p.platoonName}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ))
        ) : (
          <p className="m-0 p-4 text-ink-muted">כל הפלוגות דיווחו היום.</p>
        )}
      </Panel>
    </div>
  );
}
