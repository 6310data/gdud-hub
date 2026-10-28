import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, availableStatusIds, hebrewDayLabel, inService, isDayWritable, israelToday } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { loadDays, loadMembers, loadRoundCompanies, loadStatuses } from "@/lib/doch1/data";
import { doch1Rounds } from "@/lib/doch1/rounds";
import { loadLocations, loadStandbyTypes, loadTeams, loadVehicles } from "@/lib/doch1/standby";
import type { UnitNode } from "@gdud/core";
import type { Session } from "@/lib/session";
import { TeamEditor, type CandidateVM, type EditorMember } from "../_components/team-editor";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * עריכת צוות כוננות (mockup screen 12): vehicle, location, members and their status today, swap, active.
 * Shared by /doch1/standby/[teamId] and the company app (`company`: only that company's own teams).
 */
export async function TeamScreen({ s, teamId, basePath, company }: { s: Session; teamId: string; basePath: string; company?: UnitNode }) {
  if (!UUID_RE.test(teamId)) notFound();
  const now = new Date();
  const today = israelToday(now);
  const yesterday = addDays(today, -1);

  const { active: round } = await doch1Rounds(s);
  if (!round) return null; // the layout shows "אין סבב פעיל"
  const data = await withUser(s.claims, async (tx) => {
    const [teams, companies, members, statuses, locations, types, vehicles, days] = await Promise.all([
      loadTeams(tx, round.id),
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadStatuses(tx, round.id, { includeInactive: true }),
      loadLocations(tx, round.id),
      loadStandbyTypes(tx, round.id),
      loadVehicles(tx),
      loadDays(tx, round.id, [yesterday, today].filter((d) => d >= round.startsOn && d <= round.endsOn)),
    ]);
    const team = teams.find((t) => t.id === teamId);
    if (!team) return { round, team: null } as const;
    return { round, team, teams, companies, members, statuses, locations, types, vehicles, days } as const;
  });
  if (!data) return null; // the layout shows "אין סבב פעיל"
  if (!data.team || (company && data.team.unitId !== company.id)) notFound();
  const { team } = data;

  const activeIds = data.companies.filter((c) => c.active).map((c) => c.unitId);
  const access = doch1Access(s, activeIds);
  if (!access.canEditTeam(team.holderIds, team.unitId)) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col items-start gap-2">
        <p className="tz-card m-0 w-full p-5 text-ink-muted">אין לך הרשאה לערוך את הצוות הזה.</p>
        <Link href={basePath} className="tz-btn tz-btn-plain">
          חזרה לשבצ״ק
        </Link>
      </div>
    );
  }

  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const memberById = new Map(data.members.map((m) => [m.personId, m]));
  const todayDay = data.days.get(today) ?? new Map<string, string>();
  const yesterdayDay = data.days.get(yesterday) ?? new Map<string, string>();
  const writableToday = isDayWritable({ day: today, now, lockAt: round.lockAt, isAdmin: access.isAdmin }) && today >= round.startsOn && today <= round.endsOn;

  const members: EditorMember[] = team.members.map((m) => {
    const rm = memberById.get(m.personId);
    return {
      personId: m.personId,
      name: m.name,
      role: m.role,
      sub: rm ? [team.holderIds.length > 1 ? unitById.get(rm.companyId)?.name : null, rm.platoonName].filter(Boolean).join(" · ") : "",
      statusId: todayDay.get(m.personId) ?? null,
      yesterdayId: yesterdayDay.get(m.personId) ?? null,
      canReport: !!rm && access.canReport(rm.unitId) && writableToday,
    };
  });

  // candidates: the holding companies' soldiers in the round that the user may place (a company team: its company's)
  const onTeam = new Set(data.teams.flatMap((t) => t.members.map((m) => m.personId)));
  const holderSet = new Set(team.unitId ? [team.unitId] : team.holderIds);
  const candidates: CandidateVM[] = data.members
    .filter((m) => m.inReport && inService(m, today) && holderSet.has(m.companyId) && access.canPlace(m.unitId, team.unitId) && !team.members.some((x) => x.personId === m.personId))
    .map((m) => ({
      personId: m.personId,
      name: m.name,
      role: m.roleTitle,
      sub: [team.holderIds.length > 1 ? unitById.get(m.companyId)?.name : null, m.platoonName].filter(Boolean).join(" · "),
      onTeam: onTeam.has(m.personId),
      statusId: todayDay.get(m.personId) ?? null,
    }));

  const vehicle = data.vehicles.find((v) => v.id === team.vehicleId) ?? null;
  const holders = team.holderIds.map((id) => unitById.get(id)?.name ?? "").filter(Boolean).join(" + ");
  const roundCompanies = activeIds
    .map((id) => unitById.get(id))
    .filter((u): u is NonNullable<typeof u> => !!u)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((u) => ({ id: u.id, name: u.name }));

  return (
    <TeamEditor
      key={team.id}
      dayLabel={hebrewDayLabel(today)}
      today={today}
      lockAt={round.lockAt}
      writableToday={writableToday}
      isAdmin={access.isAdmin}
      team={{ id: team.id, name: team.name, active: team.active, typeId: team.typeId, locationId: team.locationId, holderIds: team.holderIds, holders, unitId: team.unitId }}
      vehicle={vehicle}
      members={members}
      candidates={candidates}
      statuses={data.statuses}
      available={[...availableStatusIds(data.statuses)]}
      types={data.types.filter((t) => t.active || t.id === team.typeId)}
      locations={data.locations.filter((l) => l.active || l.id === team.locationId).map((l) => ({ id: l.id, name: l.name }))}
      companies={roundCompanies}
      basePath={basePath}
    />
  );
}
