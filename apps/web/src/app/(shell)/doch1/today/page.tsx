import Link from "next/link";
import { can, scopesFor } from "@gdud/auth";
import { addDays, dayRange, hebrewDayLabel, isDay, isDayWritable, israelToday } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { loadActiveRound, loadDays, loadMembers, loadRoundCompanies, loadStatuses, membersUnder } from "@/lib/doch1/data";
import { requireModule } from "@/lib/session";
import { PushToggle } from "../_components/push-toggle";
import { TodayList, type DaysByDay, type TodayMember } from "./_components/today-list";

export const metadata = { title: "דוח 1 של היום" };

/** Days after the screen's day loaded for the group update's "planned days" warning. */
const PLAN_DAYS = 30;

export default async function Doch1Today({ searchParams }: { searchParams: Promise<{ unit?: string; day?: string }> }) {
  const s = await requireModule("doch1");
  const sp = await searchParams;

  const base = await withUser(s.claims, async (tx) => {
    const round = await loadActiveRound(tx);
    return round ? { round, companies: await loadRoundCompanies(tx, round.id) } : null;
  });
  if (!base) return null; // the layout shows "אין סבב פעיל"
  const { round } = base;
  const companyIds = base.companies.filter((c) => c.active).map((c) => c.unitId);
  const access = doch1Access(s, companyIds);

  // units this user can open here: where they report, plus read-only (viewer) scopes
  const viewer = scopesFor(s.user, "doch1", ["viewer"]);
  const viewerUnits = viewer.includes(null) ? companyIds : viewer.filter((u): u is string => u !== null);
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const scopes = [...new Set([...access.reportScopes, ...viewerUnits])]
    .filter((id) => unitById.has(id))
    .sort((a, b) => unitById.get(a)!.sortOrder - unitById.get(b)!.sortOrder);
  if (!scopes.length) {
    return <p className="tz-card m-0 p-5 text-ink-muted">אין לך פלוגה או מחלקה בדוח של הסבב הפעיל.</p>;
  }
  const unitId = sp.unit && scopes.includes(sp.unit) ? sp.unit : scopes[0]!;
  const unit = unitById.get(unitId)!;

  const now = new Date();
  const today = israelToday(now);
  const day = sp.day && isDay(sp.day) && sp.day >= round.startsOn && sp.day <= round.endsOn ? sp.day : today;
  const yesterday = addDays(day, -1);
  const lastDay = [addDays(day, PLAN_DAYS), round.endsOn].sort()[0]!;

  const data = await withUser(s.claims, async (tx) => {
    const [all, statuses] = await Promise.all([loadMembers(tx, round.id, s.units), loadStatuses(tx, round.id, { includeInactive: true })]);
    const members = membersUnder(all, unitId, s.units);
    const loaded = await loadDays(tx, round.id, dayRange(yesterday, lastDay), { personIds: members.map((m) => m.personId) });
    return { members, statuses, loaded };
  });

  const platoonOrder = (id: string | null) => (id ? (unitById.get(id)?.sortOrder ?? 0) + 1 : 0);
  const members: TodayMember[] = data.members
    .map((m) => ({
      personId: m.personId,
      name: m.name,
      roleTitle: m.roleTitle,
      companyId: m.companyId,
      platoonId: m.platoonId,
      platoonName: m.platoonName,
      inReport: m.inReport,
    }))
    .sort((a, b) => platoonOrder(a.platoonId) - platoonOrder(b.platoonId) || (a.platoonName ?? "").localeCompare(b.platoonName ?? "", "he"));
  const days: DaysByDay = Object.fromEntries([...data.loaded].map(([d, m]) => [d, Object.fromEntries(m)]));

  const canEdit = access.canReport(unitId);
  const writable = canEdit && isDayWritable({ day, now, lockAt: round.lockAt, isAdmin: access.isAdmin });
  const dayLabel = hebrewDayLabel(day);

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="tz-footnote">
          {unit.name} · {dayLabel}
        </span>
        <h1 className="tz-large-title">{day === today ? "דוח 1 של היום" : `דוח 1 · ${dayLabel}`}</h1>
        {access.reportScopes.length ? <PushToggle /> : null}
        {day !== today ? (
          <Link href={`/doch1/today?unit=${unitId}`} className="text-[15px] text-primary no-underline">
            חזרה להיום
          </Link>
        ) : null}
      </div>
      {scopes.length > 1 ? (
        <nav className="tz-pills" aria-label="מסגרת">
          {scopes.map((id) => (
            <Link key={id} href={`/doch1/today?unit=${id}${day !== today ? `&day=${day}` : ""}`} className="tz-pill" aria-current={id === unitId ? "page" : undefined}>
              {unitById.get(id)!.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <TodayList
        key={`${unitId}|${day}`}
        unitId={unitId}
        unitName={unit.name}
        isCompany={unit.kind === "company"}
        day={day}
        isToday={day === today}
        dayLabel={dayLabel}
        yesterday={yesterday}
        lastDay={lastDay}
        lockAt={round.lockAt}
        canEdit={canEdit}
        writable={writable}
        canEditMembers={can(s.user, "doch1", ["admin", "company_user"], unitId, s.parents)}
        members={members}
        statuses={data.statuses}
        days={days}
      />
    </div>
  );
}
