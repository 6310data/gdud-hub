import { redirect } from "next/navigation";
import { can } from "@gdud/auth";
import { addDays, dayRange, hebrewDayLabel, isDay, israelClock, israelToday, missingMembers, summarize } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { listedOn, loadActiveRound, loadDays, loadMembers, loadRoundCompanies, loadStatuses } from "@/lib/doch1/data";
import { requireModule } from "@/lib/session";
import type { CompanySummary } from "./_components/company-table";
import { OverviewView } from "./_components/overview-view";
import type { TrendPoint } from "./_components/trend-chart";

export const metadata = { title: "דוח 1 · סקירה" };

/** The trend chart samples a day every TREND_STEP days, TREND_POINTS days back from the shown day. */
const TREND_STEP = 3;
const TREND_POINTS = 15;

/** Battalion overview (mockup screens 01 / 06): KPIs, composition, per-company completion, who is missing, trend — of today or `?day=`. */
export default async function Doch1Overview({ searchParams }: { searchParams: Promise<{ unit?: string; day?: string }> }) {
  const s = await requireModule("doch1");
  if (!doch1Access(s).canOverview) redirect("/doch1/today");
  const sp = await searchParams;
  const now = new Date();
  const today = israelToday(now);

  const data = await withUser(s.claims, async (tx) => {
    const round = await loadActiveRound(tx);
    if (!round) return null;
    const day = sp.day && isDay(sp.day) && sp.day >= round.startsOn && sp.day <= round.endsOn ? sp.day : today;
    const sampled = dayRange(addDays(day, -TREND_STEP * (TREND_POINTS - 1)), day)
      .filter((_, i, all) => (all.length - 1 - i) % TREND_STEP === 0)
      .filter((d) => d >= round.startsOn && d <= round.endsOn);
    const [companies, members, statuses, days] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadStatuses(tx, round.id, { includeInactive: true }),
      loadDays(tx, round.id, sampled.includes(day) ? sampled : [...sampled, day]),
    ]);
    return { round, day, companies, members, statuses, days, sampled };
  });
  if (!data) return null; // the layout shows "אין סבב פעיל"

  const access = doch1Access(s, data.companies.filter((c) => c.active).map((c) => c.unitId));
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const companies = data.companies
    .filter((c) => c.active && unitById.has(c.unitId) && can(s.user, "doch1", "any", c.unitId, s.parents))
    .map((c) => unitById.get(c.unitId)!)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"));
  const { day } = data;
  const dayStatuses = data.days.get(day)!;
  const listed = listedOn(data.members, day);
  const ofCompany = (id: string) => listed.filter((m) => m.companyId === id);
  const rows: CompanySummary[] = companies.map((c) => ({ unitId: c.id, name: c.name, summary: summarize(ofCompany(c.id), dayStatuses, data.statuses) }));
  const visible = data.members.filter((m) => companies.some((c) => c.id === m.companyId));
  const total = summarize(listedOn(visible, day), dayStatuses, data.statuses);
  const scope = sp.unit && rows.some((r) => r.unitId === sp.unit) ? sp.unit : null;
  const scopedMembers = scope ? visible.filter((m) => m.companyId === scope) : visible;

  const missing = companies
    .filter((c) => !scope || c.id === scope)
    .map((c) => ({ unitId: c.id, name: c.name, people: missingMembers(ofCompany(c.id), dayStatuses) }))
    .filter((x) => x.people.length);

  const trend: TrendPoint[] = data.sampled.map((d) => {
    const sum = summarize(listedOn(scopedMembers, d), data.days.get(d)!, data.statuses);
    return {
      day: d,
      label: `${d.slice(8, 10)}.${d.slice(5, 7)}`,
      isToday: d === day,
      total: sum.inSadak,
      segments: [
        ...sum.groups.map((g) => ({ key: g.name, color: g.color, n: g.count })),
        { key: "out", color: "var(--line-strong)", n: sum.roster - sum.inSadak },
      ],
    };
  });

  const roundDay = dayRange(data.round.startsOn, day).length;
  const dateLine = [
    `${hebrewDayLabel(day)}.${day.slice(0, 4)}`,
    roundDay > 0 && day <= data.round.endsOn ? `יום ${roundDay} בסבב` : null,
    day > today ? "תכנון" : null,
    `עודכן ${israelClock(now)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <OverviewView
      dateLine={dateLine}
      dayNav={{ day, today, min: data.round.startsOn, max: data.round.endsOn, params: { unit: scope } }}
      when={day === today ? "היום" : `ב־${day.slice(8, 10)}.${day.slice(5, 7)}`}
      dayQuery={day === today ? "" : `&day=${day}`}
      rows={rows}
      total={total}
      scope={scope}
      missing={missing}
      trend={trend}
      isAdmin={access.isAdmin}
      canCopy={access.canCopy}
    />
  );
}
