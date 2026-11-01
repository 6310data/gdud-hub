import Link from "next/link";
import { z } from "zod";
import { can } from "@gdud/auth";
import { addDays, availableStatusIds, hebrewDayLabel, isAtBase, isAvailable, israelClock, israelToday, missingMembers, type StatusDef } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Chip, Icon } from "@gdud/ui";
import { Empty, Kpi, PageHeader, Panel, SmallTile } from "@/components/page-parts";
import { StatusChip } from "@/app/(shell)/doch1/_components/status-chip";
import { TeamCard } from "@/app/(shell)/doch1/standby/_components/team-card";
import { coversPerson, requireCompanyScope } from "@/lib/company/access";
import { loadActivities, loadActivityPeople, loadSoldierNames, timeRange, type ActivityRow } from "@/lib/company/data";
import { doch1Access } from "@/lib/doch1/access";
import { listedOn, loadDays, loadMembers, loadStatuses, membersUnder, type MemberVM } from "@/lib/doch1/data";
import { doch1Rounds } from "@/lib/doch1/rounds";
import { loadLocations, loadStandbyTypes, loadTeams, loadVehicles, withReadiness } from "@/lib/doch1/standby";
import { fmtCount } from "@/lib/logistics/format";
import { Participants } from "../../_components/activity-forms";
import { CompanyPills } from "../../_components/ui";

export const metadata = { title: "לוח בקרה" };

const paramsSchema = z.object({ unit: z.uuid() });

type Phase = "now" | "later" | "done";
const PHASE_ORDER: Record<Phase, number> = { now: 0, later: 1, done: 2 };

/** Where an activity of today stands at `clock` ("HH:MM"); no times = all day. */
const phaseOf = (a: ActivityRow, clock: string): Phase =>
  a.startsAt && clock < a.startsAt.slice(0, 5) ? "later" : a.endsAt && clock >= a.endsAt.slice(0, 5) ? "done" : "now";

function PhaseChip({ phase }: { phase: Phase }) {
  if (phase === "now") return <Chip tone="ok">עכשיו</Chip>;
  if (phase === "later") return <Chip tone="signed">בהמשך היום</Chip>;
  return <Chip tone="brigade">הסתיימה</Chip>;
}

/**
 * לוח בקרה: the company today at a glance — its own כוננות teams with today's readiness, today's
 * פעילות and who goes, and who is in the base by today's דוח 1 (a status that counts as present and
 * is neither a home day nor off duty: `isAtBase`). The כוננות and דוח 1 parts are read under the
 * department's RLS, so they show to the company admin and to users with a דוח 1 role (a platoon
 * commander: their platoon); activities come through app.company_activity_people.
 */
export default async function CompanyDashboard({ params }: { params: Promise<{ unit: string }> }) {
  const p = paramsSchema.safeParse(await params);
  const { s, access, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  const company = scope.company;
  const now = new Date();
  const today = israelToday(now);
  const clock = israelClock(now);
  const base = `/company/${company.id}`;
  // same gates as פעילויות (new activity) and שבצ״ק וכוננות (the team editor)
  const canCreate = scope.isAdmin || scope.platoons.length > 0;
  const seesDoch1 = scope.isAdmin || can(s.user, "doch1", "any");
  const seesStandbyPage = scope.isAdmin || can(s.user, "doch1", "any", company.id, s.parents);
  const round = seesDoch1 ? (await doch1Rounds(s)).active : null;

  const data = await withUser(s.claims, async (tx) => {
    const [activities, soldiers] = await Promise.all([loadActivities(tx, company.id, { from: today, to: addDays(today, 1) }), loadSoldierNames(tx, company.id)]);
    const [people, doch1] = await Promise.all([
      Promise.all(activities.map((a) => loadActivityPeople(tx, a.id))),
      round
        ? Promise.all([
            loadMembers(tx, round.id, s.units),
            loadStatuses(tx, round.id, { includeInactive: true }),
            loadLocations(tx, round.id),
            loadStandbyTypes(tx, round.id),
            loadVehicles(tx),
            loadTeams(tx, round.id),
            loadDays(tx, round.id, [today]),
          ]).then(([members, statuses, locations, types, vehicles, teams, days]) => ({ members, statuses, locations, types, vehicles, teams, day: days.get(today)! }))
        : Promise.resolve(null),
    ]);
    return { activities, soldiers, people, doch1 };
  });

  const platoonName = (unitId: string) => s.units.find((u) => u.id === unitId && u.kind === "platoon")?.name ?? "מפקדה";
  const nameOf = (personId: string | null) => data.soldiers.find((x) => x.id === personId)?.name ?? null;
  const todays = data.activities
    .map((a, i) => ({ a, people: data.people[i]!, phase: phaseOf(a, clock) }))
    .sort((x, y) => PHASE_ORDER[x.phase] - PHASE_ORDER[y.phase] || (x.a.startsAt ?? "").localeCompare(y.a.startsAt ?? ""));

  // דוח 1 of today: the company's listed soldiers (what RLS lets the user see) and their statuses
  const d = data.doch1;
  const statusById = new Map((d?.statuses ?? []).map((st) => [st.id, st]));
  const statusOf = (personId: string): StatusDef | null => statusById.get(d?.day.get(personId) ?? "") ?? null;
  const listed = d ? listedOn(membersUnder(d.members, company.id, s.units), today) : [];
  const atBase = listed.filter((m) => isAtBase(statusOf(m.personId)));
  const missing = d ? missingMembers(listed, d.day).length : 0;
  const sortOf = new Map(s.units.map((u) => [u.id, u.sortOrder]));
  const groups = [...new Map(atBase.map((m) => [m.platoonId ?? "", m.platoonName])).entries()]
    .sort(([a], [b]) => (a ? (sortOf.get(a) ?? 0) : -Infinity) - (b ? (sortOf.get(b) ?? 0) : -Infinity))
    .map(([id, name]) => ({ key: id || "hq", name: id ? (name ?? "") : `${company.name} · מפקדה`, rows: atBase.filter((m) => (m.platoonId ?? "") === id) }));

  // the company's own active כוננות teams, with today's readiness
  const d1 = doch1Access(s);
  const available = availableStatusIds(d?.statuses ?? []);
  const teams = d
    ? withReadiness(
        d.teams.filter((t) => t.unitId === company.id && t.active),
        { day: d.day, statuses: d.statuses, units: s.units, locations: d.locations, vehicles: d.vehicles, types: d.types },
      )
    : [];
  const onStandby = teams.flatMap((t) => t.members);
  const avail = (personId: string) => (d ? isAvailable(personId, d.day, available) : false);

  const noDoch1 = seesDoch1 ? "אין סבב פעיל בדוח 1." : "דוח 1 והכוננות של הפלוגה מוצגים למנהל הפלוגה ולמי שיש לו הרשאה בדוח 1.";

  return (
    <>
      <CompanyPills companies={access.companies} current={company.id} path="/dashboard" />
      <PageHeader
        title="לוח בקרה"
        sub={`${company.name} · ${hebrewDayLabel(today)} · ${clock}`}
        actions={
          canCreate ? (
            <Link href={`${base}/activities?tab=new&day=${today}`} className="tz-btn tz-btn-filled tz-btn-sm">
              <Icon name="plus" size={16} />
              פעילות חדשה
            </Link>
          ) : null
        }
      />

      <Panel>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {d ? <Kpi value={fmtCount(atBase.length)} label="במוצב עכשיו" tile={<SmallTile color="var(--primary)" icon="pin" />} /> : null}
          {d ? <Kpi value={fmtCount(onStandby.length)} label={`בכוננות · ${fmtCount(onStandby.filter((m) => avail(m.personId)).length)} זמינים`} tile={<SmallTile color="var(--tile-brigade)" icon="shield" />} /> : null}
          <Kpi href={`${base}/activities`} value={fmtCount(todays.length)} label="פעילויות היום" tile={<SmallTile color="var(--tile-neutral)" icon="calendar" />} />
          {d ? <Kpi value={fmtCount(missing)} label="בלי דוח 1 היום" tile={<SmallTile color="var(--danger)" icon="alert" />} /> : null}
        </div>
      </Panel>

      <div className="grid items-start gap-[22px] lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-[22px]">
          <section aria-label="מי בכוננות" className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 px-1">
              <h2 className="tz-panel-title">מי בכוננות</h2>
              {d && seesStandbyPage ? (
                <Link href={`${base}/reports/standby`} className="tz-footnote">
                  שבצ״ק וכוננות
                </Link>
              ) : null}
            </div>
            {!d ? (
              <div className="tz-card">
                <Empty>{noDoch1}</Empty>
              </div>
            ) : teams.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-3.5">
                {teams.map((t) => (
                  <TeamCard
                    key={t.id}
                    team={t}
                    statusOf={statusOf}
                    isAvailable={avail}
                    editable={seesStandbyPage && d1.canEditTeam(t.holderIds, t.unitId)}
                    href={`${base}/reports/standby/${t.id}`}
                  />
                ))}
              </div>
            ) : (
              <div className="tz-card">
                <Empty>אין לפלוגה צוותי כוננות פעילים בסבב.</Empty>
              </div>
            )}
          </section>

          {todays.length === 0 ? (
            <Panel title="פעילות">
              <Empty>אין פעילות היום.</Empty>
            </Panel>
          ) : (
            todays.map(({ a, people, phase }) => (
              <Panel
                key={a.id}
                title={a.name}
                action={
                  <span className="flex items-center gap-2">
                    <PhaseChip phase={phase} />
                    <Link href={`${base}/activities/${a.id}`} className="tz-footnote">
                      לפעילות
                    </Link>
                  </span>
                }
              >
                <div className="tz-footnote border-b border-[var(--separator)] px-4 py-2.5">
                  {[timeRange(a) || "כל היום", a.place, nameOf(a.commanderPersonId) ? `מפקד: ${nameOf(a.commanderPersonId)}` : null, `${fmtCount(people.length)} יוצאים`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <Participants
                  unitId={company.id}
                  activityId={a.id}
                  editable={false}
                  candidates={[]}
                  people={people.map((x) => ({
                    participantId: x.participantId,
                    name: x.name,
                    sub: platoonName(x.unitId),
                    role: x.role,
                    statusName: x.statusName,
                    qualifies: x.qualifies,
                    canRemove: false,
                  }))}
                />
              </Panel>
            ))
          )}
        </div>

        <section aria-label="מי במוצב עכשיו" className="flex min-w-0 flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 className="tz-panel-title">{d ? `מי במוצב עכשיו (${fmtCount(atBase.length)})` : "מי במוצב עכשיו"}</h2>
            {d && missing ? <span className="tz-footnote">{fmtCount(missing)} בלי דוח 1 היום</span> : null}
          </div>
          {!d || !atBase.length ? (
            <div className="tz-card">
              <Empty>{d ? "אין חיילים במוצב לפי דוח 1 של היום." : noDoch1}</Empty>
            </div>
          ) : (
            // one card per platoon, company-level soldiers first (like הפלוגה)
            groups.map((g) => (
              <Panel key={g.key} title={g.name} action={<span className="tz-footnote">{fmtCount(g.rows.length)} במוצב</span>}>
                {g.rows.map((m) => (
                  <AtBaseRow key={m.personId} m={m} status={statusOf(m.personId)} href={coversPerson(scope, m.unitId, s.parents) ? `${base}/people/${m.personId}` : null} />
                ))}
              </Panel>
            ))
          )}
        </section>
      </div>
    </>
  );
}

function AtBaseRow({ m, status, href }: { m: MemberVM; status: StatusDef | null; href: string | null }) {
  const body = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate font-semibold">{m.name}</span>
      <span className="tz-footnote truncate">{m.roleTitle || "—"}</span>
    </span>
  );
  return (
    <div className="flex items-center gap-3 border-b border-[var(--separator)] px-4 py-2.5 last:border-b-0">
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 text-ink no-underline">
          {body}
        </Link>
      ) : (
        body
      )}
      <StatusChip status={status} />
    </div>
  );
}
