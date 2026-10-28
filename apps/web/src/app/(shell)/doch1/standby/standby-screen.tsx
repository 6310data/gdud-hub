import Link from "next/link";
import { scopesFor } from "@gdud/auth";
import { availableStatusIds, hebrewDayLabel, isAvailable, isDay, israelClock, israelToday, locationChecks, VEHICLE_STATE_LABEL } from "@gdud/core";
import { Icon, Serial } from "@gdud/ui";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { listedOn, loadDays, loadMembers, loadRoundCompanies, loadStatuses } from "@/lib/doch1/data";
import { doch1Rounds } from "@/lib/doch1/rounds";
import { loadLocations, loadStandbyTypes, loadTeams, loadVehicles, standbyCompanies, withReadiness } from "@/lib/doch1/standby";
import type { UnitNode } from "@gdud/core";
import type { Session } from "@/lib/session";
import { DayNav } from "../_components/day-nav";
import { LocationsBoard, type LocatedMemberVM } from "./_components/locations-board";
import { NewTeamForm } from "./_components/new-team-form";
import { gapText, ReadyChip, TeamCard } from "./_components/team-card";
import { VehiclesList, type VehicleRow } from "./_components/vehicles-list";

const VIEWS = [
  { id: "teams", label: "כוננות" },
  { id: "locations", label: "מיקומים" },
  { id: "vehicles", label: "רכבים" },
] as const;
type View = (typeof VIEWS)[number]["id"];

function Kpi({ label, value, foot, warn }: { label: string; value: number; foot: string; warn?: boolean }) {
  return (
    <div className="tz-card flex min-w-0 flex-col gap-1.5 p-4 lg:p-[18px]">
      <span className="tz-footnote truncate">{label}</span>
      <span className="tz-num text-[34px] font-bold leading-10 tracking-[-0.02em]" style={warn && value ? { color: "var(--status-broken)" } : undefined}>
        {value.toLocaleString("he-IL")}
      </span>
      <span className="tz-footnote">{foot}</span>
    </div>
  );
}

export interface StandbyScreenProps {
  s: Session;
  sp: { view?: string; co?: string; check?: string; day?: string };
  /** this screen's path; a team opens at `${path}/${teamId}` */
  path: string;
  /** the company app: only this company's own teams, vehicles and soldiers */
  company?: UnitNode;
}

/**
 * שבצ״ק וכוננות (mockup screens 03 desktop, 11 phone): standby teams and their readiness on a day (default
 * today), locations, vehicles. Shared by /doch1/standby (every team, grouped by owner) and ניהול פלוגה →
 * דוחות (one company's own teams and vehicles — the same rows, spec "Changes requested", item 4).
 */
export async function StandbyScreen({ s, sp, path, company }: StandbyScreenProps) {
  const now = new Date();
  const today = israelToday(now);

  const { active: round } = await doch1Rounds(s);
  if (!round) return company ? <p className="tz-card m-0 p-5 text-ink-muted">אין סבב פעיל בדוח 1.</p> : null; // /doch1's layout says so
  const data = await withUser(s.claims, async (tx) => {
    // teams, members and locations are current; availability and the checks follow `day`'s דוח 1
    const day = sp.day && isDay(sp.day) && sp.day >= round.startsOn && sp.day <= round.endsOn ? sp.day : today;
    const [companies, members, statuses, locations, types, vehicles, teams, days] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadStatuses(tx, round.id, { includeInactive: true }),
      loadLocations(tx, round.id),
      loadStandbyTypes(tx, round.id),
      loadVehicles(tx),
      loadTeams(tx, round.id),
      loadDays(tx, round.id, [day]),
    ]);
    // soldiers not called up yet or already released that day are not in the שבצ״ק lists
    return { round, shownDay: day, companies, members: listedOn(members, day), statuses, locations, types, vehicles, teams, day: days.get(day)! };
  });
  if (!data) return null; // the layout shows "אין סבב פעיל"

  const activeIds = data.companies.filter((c) => c.active).map((c) => c.unitId);
  const access = doch1Access(s, activeIds);
  const companies = company ? [company] : standbyCompanies(s, scopesFor(s.user, "doch1"), activeIds);
  if (!companies.length) return <p className="tz-card m-0 p-5 text-ink-muted">אין לך פלוגה בשבצ״ק של הסבב הפעיל.</p>;
  const companyIds = new Set(companies.map((c) => c.id));
  const battalionWide = !company && companies.length === activeIds.length && scopesFor(s.user, "doch1").includes(null);
  const canEdit = (t: { holderIds: string[]; unitId: string | null }) => access.canEditTeam(t.holderIds, t.unitId);

  const view: View = VIEWS.some((v) => v.id === sp.view) ? (sp.view as View) : "teams";
  const co = sp.co === "gaps" || (sp.co && companyIds.has(sp.co)) ? sp.co : "all";
  const shownDay = data.shownDay;
  const isToday = shownDay === today;
  const when = isToday ? "היום" : `של ${shownDay.slice(8, 10)}.${shownDay.slice(5, 7)}`;
  const qs = (v: View, c: string = co) => `${path}?view=${v}${c !== "all" ? `&co=${c}` : ""}${isToday ? "" : `&day=${shownDay}`}`;

  const available = availableStatusIds(data.statuses);
  const statusById = new Map(data.statuses.map((st) => [st.id, st]));
  const statusOf = (personId: string) => statusById.get(data.day.get(personId) ?? "") ?? null;
  const avail = (personId: string) => isAvailable(personId, data.day, available);

  // teams of the user's companies: held by one of them, or with one of their soldiers
  const inScope = data.members.filter((m) => companyIds.has(m.companyId));
  const scopedPeople = new Set(inScope.map((m) => m.personId));
  const allTeams = withReadiness(
    data.teams.filter((t) =>
      company ? t.unitId === company.id : battalionWide || t.holderIds.some((h) => companyIds.has(h)) || t.members.some((m) => scopedPeople.has(m.personId)),
    ),
    { day: data.day, statuses: data.statuses, units: s.units, locations: data.locations, vehicles: data.vehicles, types: data.types },
  );
  const memberCompany = new Map(data.members.map((m) => [m.personId, m.companyId]));
  const ofCompany = (id: string) => (t: (typeof allTeams)[number]) => t.holderIds.includes(id) || t.members.some((m) => memberCompany.get(m.personId) === id);
  const isGap = (t: (typeof allTeams)[number]) => t.active && t.readiness.state !== "full";
  const teams = allTeams.filter((t) => (co === "all" ? true : co === "gaps" ? isGap(t) : ofCompany(co)(t)));
  const activeTeams = allTeams.filter((t) => t.active);
  const onStandby = activeTeams.flatMap((t) => t.members);
  const shortTeams = activeTeams.filter(isGap);
  const awayOnShort = shortTeams.flatMap((t) => t.members).filter((m) => !avail(m.personId)).length;

  // locations: the soldiers of the selected company (or all of the user's)
  const locMembers = co !== "all" && co !== "gaps" ? inScope.filter((m) => m.companyId === co) : inScope;
  const locationById = new Map(data.locations.map((l) => [l.id, l]));
  const checks = locationChecks(
    locMembers.map((m) => ({ personId: m.personId, inReport: m.inReport, locationKind: (m.locationId && locationById.get(m.locationId)?.kind) || null })),
    data.day,
    data.statuses,
  );
  const unplaced = locMembers.filter((m) => m.inReport && !m.locationId);
  const unplacedBy = companies
    .map((c) => ({ name: c.name, n: unplaced.filter((m) => m.companyId === c.id).length }))
    .filter((x) => x.n)
    .map((x) => `${x.name} ${x.n}`)
    .join(" · ");
  const teamOf = new Map(data.teams.flatMap((t) => t.members.map((m) => [m.personId, t.name] as const)));

  const unitName = companies.length === 1 ? companies[0]!.name : battalionWide ? "כל הגדוד" : companies.map((c) => c.name).join(", ");
  const editableIds = s.units.filter((u) => u.kind === "company" && companyIds.has(u.id) && access.canEditCompanyStandby(u.id));
  // דוח 1: the teams grouped by owner — the battalion's shared teams, then each company's own
  const owners = company
    ? [{ key: company.id, title: null as string | null, list: teams }]
    : [
        { key: "battalion", title: "צוותים גדודיים", list: teams.filter((t) => !t.unitId) },
        ...companies.map((c) => ({ key: c.id, title: `צוותי ${c.name}`, list: teams.filter((t) => t.unitId === c.id) })),
      ].filter((g) => g.list.length);

  const pills: Array<{ id: string; label: string; n: number }> =
    companies.length > 1
      ? [
          { id: "all", label: battalionWide ? "כל הגדוד" : "הכל", n: allTeams.length },
          { id: "gaps", label: "חסרי כוח", n: shortTeams.length },
          ...companies.map((c) => ({ id: c.id, label: c.name, n: allTeams.filter(ofCompany(c.id)).length })),
        ]
      : [];

  const shownVehicles = company
    ? data.vehicles.filter((v) => v.unitId === company.id)
    : access.isAdmin
      ? data.vehicles
      : data.vehicles.filter((v) => allTeams.some((t) => t.vehicleId === v.id) || (v.unitId && companyIds.has(v.unitId)));
  const vehicleRows: VehicleRow[] = shownVehicles.map((v) => {
    const using = allTeams.filter((t) => t.vehicleId === v.id);
    return {
      ...v,
      teams: using.map((t) => `${t.name}${t.holders && !company ? ` · ${t.holders}` : ""}`).join(", "),
      company: v.unitId ? (s.units.find((u) => u.id === v.unitId)?.name ?? null) : null,
      editable: access.isAdmin || (!!v.unitId && access.canEditCompanyStandby(v.unitId)) || using.some(canEdit),
    };
  });

  const locatedMembers: LocatedMemberVM[] = locMembers.map((m) => ({
    personId: m.personId,
    name: m.name,
    sub: [m.platoonName, m.roleTitle].filter(Boolean).join(" · "),
    companyName: s.units.find((u) => u.id === m.companyId)?.name ?? "",
    inReport: m.inReport,
    locationId: m.locationId,
    team: teamOf.get(m.personId) ?? null,
    status: statusOf(m.personId),
    editable: access.canLocate(m.unitId),
  }));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="tz-footnote">
            {unitName} · {hebrewDayLabel(shownDay)}
          </span>
          <h1 className="tz-large-title">שבצ״ק וכוננות</h1>
          <span className="tz-footnote">
            {isToday ? `מחושב מהשבצ״ק ומדוח 1 של היום · ${israelClock(now)}` : `זמינות לפי דוח 1 ${when}. הצוותים, הרכבים והמיקומים הם של עכשיו.`}
          </span>
          <DayNav
            day={shownDay}
            today={today}
            min={data.round.startsOn}
            max={data.round.endsOn}
            path={path}
            params={{ view: view === "teams" ? null : view, co: co === "all" ? null : co }}
          />
        </div>
        <div className="tz-seg w-full max-w-[360px]" role="tablist" aria-label="תצוגה">
          {VIEWS.map((v) => (
            <Link key={v.id} href={qs(v.id)} role="tab" className="tz-seg-item grid place-items-center text-ink no-underline" aria-selected={view === v.id}>
              {v.label}
            </Link>
          ))}
        </div>
      </header>

      {!available.size ? (
        <p className="tz-alert m-0" style={{ background: "var(--status-broken-soft)", color: "var(--status-broken)" }}>
          אף סטטוס לא מסומן ״זמין לכוננות״, ולכן כל הצוותים נראים חסרים.{" "}
          {access.isMaster ? (
            <Link href="/doch1/settings#statuses" className="font-semibold text-inherit">
              לסמן בהגדרות › סטטוסים
            </Link>
          ) : (
            "מנהל ראשי צריך לסמן אותם בהגדרות."
          )}
        </p>
      ) : null}

      {pills.length && view !== "vehicles" ? (
        <nav className="tz-pills" aria-label="סינון">
          {pills
            .filter((p) => view === "teams" || p.id !== "gaps")
            .map((p) => (
              <Link key={p.id} href={qs(view, p.id)} className="tz-pill" aria-current={co === p.id ? "page" : undefined}>
                {p.label}
                {view === "teams" ? <span className="tz-pill-count tz-num">{p.n}</span> : null}
              </Link>
            ))}
        </nav>
      ) : null}

      {view === "teams" ? (
        <>
          <section aria-label="מדדי כוננות" className="hidden gap-3 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            <Kpi label="צוותי כוננות" value={activeTeams.length} foot={`${allTeams.length - activeTeams.length ? `${allTeams.length - activeTeams.length} לא פעילים` : "כולם פעילים"}`} />
            <Kpi label="חיילים בכוננות" value={onStandby.length} foot="בצוותים הפעילים" />
            <Kpi label="רכבים משובצים" value={new Set(activeTeams.map((t) => t.vehicleId).filter(Boolean)).size} foot="לפי צ׳ הרכב" />
            <Kpi label={isToday ? "זמינים עכשיו" : "זמינים"} value={onStandby.filter((m) => avail(m.personId)).length} foot={`לפי דוח 1 ${when}`} />
            <Kpi label="צוותים חסרי כוח" value={shortTeams.length} foot={awayOnShort ? (awayOnShort === 1 ? "חייל אחד לא זמין בהם" : `${awayOnShort} חיילים לא זמינים בהם`) : "כל הצוותים שלמים"} warn />
          </section>

          {/* phone (mockup 11): what is missing first, then the teams */}
          {shortTeams.filter((t) => teams.includes(t)).map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 rounded-group px-3.5 py-3 lg:hidden" style={{ background: "var(--status-broken-soft)" }}>
              <Icon name="alert" size={18} className="flex-none text-[var(--status-broken)]" />
              <span className="flex-1 text-[14px] leading-[19px]" style={{ color: "var(--status-broken)" }}>
                {t.name}
                {t.holders && companies.length > 1 ? ` · ${t.holders}` : ""}: {gapText(t)}
              </span>
              {canEdit(t) ? (
                <Link href={`${path}/${t.id}`} className="tz-btn tz-btn-plain tz-btn-sm font-semibold" style={{ color: "var(--status-broken)" }}>
                  {t.readiness.state === "short" ? "מחליף" : "עריכה"}
                </Link>
              ) : null}
            </div>
          ))}

          <div className="flex flex-wrap items-start gap-[22px]">
            <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
              {owners.map((g) => (
                <section key={g.key} aria-label={g.title ?? "צוותי כוננות"} className="flex flex-col gap-2">
                  {g.title && owners.length > 1 ? <h2 className="tz-section-header px-1">{g.title}</h2> : null}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-3.5">
                    {g.list.map((t) => (
                      <TeamCard key={t.id} team={t} statusOf={statusOf} isAvailable={avail} editable={canEdit(t)} when={when} href={`${path}/${t.id}`} />
                    ))}
                  </div>
                </section>
              ))}
              {!teams.length ? (
                <p className="tz-card m-0 p-5 text-ink-muted">{allTeams.length ? "אין צוותים בסינון הזה." : company ? "עוד אין לפלוגה צוותי כוננות בסבב." : "עוד אין צוותי כוננות בסבב."}</p>
              ) : null}
            </div>

            <aside className="flex min-w-0 flex-[1_1_330px] flex-col gap-1.5">
              {allTeams.length ? (
                <>
                  <h2 className="tz-section-header px-4">מבט מהיר · מי על איזה רכב</h2>
                  <div className="tz-group">
                    {allTeams.map((t) => {
                      const body = (
                        <span className="tz-row-body min-h-11 py-2">
                          <span className="tz-row-title text-[15px]">
                            {t.name}
                            <span className="tz-row-sub">{[t.holders, t.location?.name].filter(Boolean).join(" · ")}</span>
                          </span>
                          {t.vehicle ? (
                            <span className="text-[13px] text-ink-muted">
                              <Serial>{t.vehicle.number}</Serial>
                            </span>
                          ) : null}
                          <ReadyChip team={t} />
                        </span>
                      );
                      return canEdit(t) ? (
                        <Link key={t.id} href={`${path}/${t.id}`} className="tz-row">
                          {body}
                        </Link>
                      ) : (
                        <div key={t.id} className="tz-row">
                          {body}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}

              <h2 className="tz-section-header px-4 pt-[18px]">מיקומים בשבצ״ק</h2>
              <div className="tz-group">
                {data.locations
                  .filter((l) => l.active || locMembers.some((m) => m.locationId === l.id))
                  .map((l) => (
                    <Link key={l.id} href={`${qs("locations")}&check=loc:${l.id}`} className="tz-row">
                      <span className="tz-tile" style={{ background: l.kind === "outpost" ? "var(--bar-broken)" : l.kind === "camp" ? "var(--status-ok)" : "var(--tile-neutral)" }}>
                        <Icon name="pin" size={17} />
                      </span>
                      <span className="tz-row-body">
                        <span className="tz-row-title">{l.name}</span>
                        <span className="tz-row-value tz-num">{locMembers.filter((m) => m.inReport && m.locationId === l.id).length}</span>
                      </span>
                    </Link>
                  ))}
                <Link href={`${qs("locations")}&check=unplaced`} className="tz-row">
                  <span className="tz-tile" style={{ background: "var(--danger)" }}>
                    <Icon name="alert" size={17} />
                  </span>
                  <span className="tz-row-body">
                    <span className="tz-row-title">
                      לא נמצאו בשבצ״ק
                      {unplacedBy && companies.length > 1 ? <span className="tz-row-sub">{unplacedBy}</span> : null}
                    </span>
                    <span className="tz-row-value tz-num font-semibold" style={unplaced.length ? { color: "var(--danger)" } : undefined}>
                      {unplaced.length}
                    </span>
                  </span>
                </Link>
              </div>

              <h2 className="tz-section-header px-4 pt-[18px]">לטיפול בשבצ״ק</h2>
              <div className="tz-group">
                <Link href={`${qs("locations")}&check=no-outpost`} className="tz-row">
                  <span className="tz-row-body">
                    <span className="tz-row-title">
                      בסטטוס מוצב בלי מוצב
                      <span className="tz-row-sub">הסטטוס {when} דורש מוצב ואין מוצב בשבצ״ק</span>
                    </span>
                    <span className="tz-row-value tz-num font-semibold" style={checks.outpostStatusWithoutOutpost.length ? { color: "var(--danger)" } : undefined}>
                      {checks.outpostStatusWithoutOutpost.length}
                    </span>
                    <Icon name="chevron" size={17} className="tz-chevron" />
                  </span>
                </Link>
                <Link href={`${qs("locations")}&check=other-status`} className="tz-row">
                  <span className="tz-row-body">
                    <span className="tz-row-title">במוצב ולא בסטטוס מוצב</span>
                    <span className="tz-row-value tz-num">{checks.atOutpostOtherStatus.length}</span>
                    <Icon name="chevron" size={17} className="tz-chevron" />
                  </span>
                </Link>
              </div>
            </aside>
          </div>

          {editableIds.length ? (
            <details className="tz-group">
              <summary className="cursor-pointer px-4 py-3 font-semibold text-primary">צוות כוננות חדש</summary>
              <NewTeamForm
                companies={editableIds.map((u) => ({ id: u.id, name: u.name }))}
                types={data.types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }))}
                locations={data.locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))}
                canShare={access.isAdmin && !company}
              />
            </details>
          ) : null}
        </>
      ) : null}

      {view === "locations" ? (
        <LocationsBoard
          key={`${co}|${sp.check ?? ""}`}
          members={locatedMembers}
          locations={data.locations.filter((l) => l.active || locMembers.some((m) => m.locationId === l.id))}
          checks={{ noOutpost: checks.outpostStatusWithoutOutpost, otherStatus: checks.atOutpostOtherStatus }}
          initialFilter={sp.check ?? "all"}
          showCompany={companies.length > 1 && co === "all"}
        />
      ) : null}

      {view === "vehicles" ? (
        <>
          <VehiclesList
            rows={vehicleRows}
            companies={access.isAdmin && !company ? s.units.filter((u) => u.kind === "company" && u.active && activeIds.includes(u.id)).map((u) => ({ id: u.id, name: u.name })) : undefined}
          />
          <p className="tz-section-footer">
            רכב שאינו {VEHICLE_STATE_LABEL.ok} מסמן את הצוות שלו כלא כשיר.
            {access.isAdmin && !company
              ? " את מאגר הרכבים המלא מנהלים בהגדרות. רכב של פלוגה משמש רק את צוותי הפלוגה."
              : " צ׳ רכב לצוות משנים בעריכת הצוות. רכב חדש שמוסיפים לצוות של הפלוגה הוא של הפלוגה."}
          </p>
        </>
      ) : null}
    </div>
  );
}
