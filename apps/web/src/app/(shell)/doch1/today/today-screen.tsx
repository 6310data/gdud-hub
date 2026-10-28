/**
 * דוח 1 של היום — the screen, shared by /doch1/today and ניהול פלוגה → דוחות (spec "Changes requested
 * 2026-10-28", item 3): the same data, rules and actions; the company app limits it to the company's
 * units and keeps its links inside the company app.
 */
import Link from "next/link";
import { can, scopesFor } from "@gdud/auth";
import { addDays, dayRange, hebrewDayLabel, isDay, isDayWritable, israelToday } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { listedOn, loadDays, loadMembers, loadRoundCompanies, loadStatuses, membersUnder } from "@/lib/doch1/data";
import { doch1Rounds } from "@/lib/doch1/rounds";
import type { Session } from "@/lib/session";
import { DayNav } from "../_components/day-nav";
import { PushToggle } from "../_components/push-toggle";
import { TodayList, type DaysByDay, type TodayMember } from "./_components/today-list";

/** Days after the screen's day loaded for the group update's "planned days" warning. */
const PLAN_DAYS = 30;

export interface TodayScreenProps {
  s: Session;
  sp: { unit?: string; day?: string };
  /** this screen's path: day navigation, unit pills and the way back keep to it */
  path: string;
  /** only these units may be opened (the company app: the company and its platoons) */
  only?: (unitId: string) => boolean;
  /** where a soldier opens (default: the דוח 1 soldier card) */
  soldierHref?: string;
  /** where "לתאריכי הגיוס" points (null = not shown) */
  datesHref?: (companyId: string | null) => string | null;
}

export async function TodayScreen({ s, sp, path, only, soldierHref, datesHref = (c) => `/doch1/soldiers${c ? `?unit=${c}` : ""}` }: TodayScreenProps) {

  const { active: round } = await doch1Rounds(s);
  if (!round) return only ? <p className="tz-card m-0 p-5 text-ink-muted">אין סבב פעיל בדוח 1.</p> : null; // /doch1's layout says so
  const unitById = new Map(s.units.map((u) => [u.id, u]));

  const now = new Date();
  const today = israelToday(now);
  const day = sp.day && isDay(sp.day) && sp.day >= round.startsOn && sp.day <= round.endsOn ? sp.day : today;
  const yesterday = addDays(day, -1);
  const lastDay = [addDays(day, PLAN_DAYS), round.endsOn].sort()[0]!;

  // one transaction: companies, members and statuses in one batch, then the chosen unit's days
  const data = await withUser(s.claims, async (tx) => {
    const [companies, all, statuses] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadStatuses(tx, round.id, { includeInactive: true }),
    ]);
    const companyIds = companies.filter((c) => c.active).map((c) => c.unitId);
    const access = doch1Access(s, companyIds);
    // units this user can open here: where they report, plus read-only (viewer) scopes
    const viewer = scopesFor(s.user, "doch1", ["viewer"]);
    const viewerUnits = viewer.includes(null) ? companyIds : viewer.filter((u): u is string => u !== null);
    const scopes = [...new Set([...access.reportScopes, ...viewerUnits])]
      .filter((id) => unitById.has(id) && (!only || only(id)))
      .sort((a, b) => unitById.get(a)!.sortOrder - unitById.get(b)!.sortOrder);
    if (!scopes.length) return null;
    const unitId = sp.unit && scopes.includes(sp.unit) ? sp.unit : scopes[0]!;
    const under = membersUnder(all, unitId, s.units);
    // only soldiers called up by `day` and not released before it
    const members = listedOn(under, day);
    const loaded = await loadDays(tx, round.id, dayRange(yesterday, lastDay), { personIds: members.map((m) => m.personId) });
    return { access, scopes, unitId, members, statuses, loaded, hidden: under.length - members.length, companyId: under[0]?.companyId ?? null };
  });
  if (!data) {
    return <p className="tz-card m-0 p-5 text-ink-muted">אין לך פלוגה או מחלקה בדוח של הסבב הפעיל.</p>;
  }
  const { access, scopes, unitId } = data;
  const unit = unitById.get(unitId)!;

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
        {data.hidden ? (
          <p className="tz-footnote m-0">
            {data.hidden === 1 ? "חייל אחד לא מוצג" : `${data.hidden} חיילים לא מוצגים`} ביום הזה: בלי תאריך גיוס, לפני הגיוס או אחרי השחרור.{" "}
            {datesHref(data.companyId) ? (
              <Link href={datesHref(data.companyId)!} className="text-primary no-underline">
                לתאריכי הגיוס
              </Link>
            ) : null}
          </p>
        ) : null}
        <DayNav day={day} today={today} min={round.startsOn} max={round.endsOn} path={path} params={{ unit: unitId }} />
      </div>
      {scopes.length > 1 ? (
        <nav className="tz-pills" aria-label="מסגרת">
          {scopes.map((id) => (
            <Link key={id} href={`${path}?unit=${id}${day !== today ? `&day=${day}` : ""}`} className="tz-pill" aria-current={id === unitId ? "page" : undefined}>
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
        backHref={`${path}?unit=${unitId}${day === today ? "" : `&day=${day}`}`}
        soldierHref={soldierHref}
      />
    </div>
  );
}
