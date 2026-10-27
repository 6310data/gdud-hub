import { notFound } from "next/navigation";
import { can } from "@gdud/auth";
import {
  addDays,
  describeChange,
  inService,
  isDayWritable,
  israelClock,
  israelToday,
  placement,
  soldierRoundStats,
  soldierStrip,
  VEHICLE_STATE_LABEL,
  type Day,
} from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { loadActiveRound, loadFieldOptions, loadRoundCompanies, loadStatuses } from "@/lib/doch1/data";
import { loadFieldValues, loadSoldier, loadSoldierDays, loadSoldierLog } from "@/lib/doch1/soldier";
import { loadLocations, loadTeams, loadVehicles } from "@/lib/doch1/standby";
import { requireModule } from "@/lib/session";
import { SoldierCard, type CardLogEntry } from "./_components/soldier-card";

export const metadata = { title: "דוח 1 · כרטיס חייל" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Days on the card's strip, ending today (mockup: 14). */
const STRIP_DAYS = 14;

/** "?back=" may only point back into דוח 1. */
const safeBack = (v: string | undefined) => (v && /^\/doch1(?:[/?]|$)/.test(v) && !v.startsWith("//") ? v : null);

/** "היום 21:14" / "אתמול 21:14" / "12.10 21:14" (Israel time). */
function when(at: Date, today: Day): string {
  const d = israelToday(at);
  const day = d === today ? "היום" : d === addDays(today, -1) ? "אתמול" : `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return `${day} ${israelClock(at)}`;
}

/** כרטיס חייל (mockup screen 09): today, the last 14 days, the round's numbers, details and the change log. */
export default async function Doch1Soldier({ params, searchParams }: { params: Promise<{ personId: string }>; searchParams: Promise<{ back?: string }> }) {
  const s = await requireModule("doch1");
  const { personId } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(personId)) notFound();

  const now = new Date();
  const today = israelToday(now);

  const data = await withUser(s.claims, async (tx) => {
    const round = await loadActiveRound(tx);
    if (!round) return null;
    const soldier = await loadSoldier(tx, round.id, personId);
    if (!soldier) return { round, soldier: null } as const;
    const editable = can(s.user, "doch1", ["admin", "company_user"], soldier.unitId, s.parents);
    const [companies, statuses, days, teams, locations, vehicles, log, values, options] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadStatuses(tx, round.id, { includeInactive: true }),
      loadSoldierDays(tx, round.id, personId),
      loadTeams(tx, round.id),
      loadLocations(tx, round.id),
      loadVehicles(tx),
      loadSoldierLog(tx, round.id, personId),
      editable ? loadFieldValues(tx, round.id) : Promise.resolve(null),
      loadFieldOptions(tx, round.id),
    ]);
    return { round, soldier, editable, companies, statuses, days, teams, locations, vehicles, log, values, options } as const;
  });
  if (!data) return null; // the layout shows "אין סבב פעיל"
  if (!data.soldier) notFound();
  const { round, soldier, statuses, days } = data;

  const access = doch1Access(s, data.companies.filter((c) => c.active).map((c) => c.unitId));
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const { company, platoon } = placement(soldier.unitId, unitById);
  const statusById = new Map(statuses.map((st) => [st.id, st]));
  const optionName = new Map(data.options.map((o) => [o.id, o.name]));

  // "today" inside the round (a finished round shows its last day)
  const day = today < round.startsOn ? round.startsOn : today > round.endsOn ? round.endsOn : today;
  const yesterday = addDays(day, -1);
  const listed = inService(soldier, day);
  const todayStatus = statusById.get(days.get(day) ?? "") ?? null;
  const location = data.locations.find((l) => l.id === soldier.locationId) ?? null;
  const team = data.teams.find((t) => t.members.some((m) => m.personId === personId)) ?? null;
  const vehicle = team ? (data.vehicles.find((v) => v.id === team.vehicleId) ?? null) : null;

  // the sheet's status ↔ שבצ״ק data checks, for this soldier
  const notes: string[] = [];
  if (!soldier.arriving) notes.push("צפי ההגעה שלו ״לא מגיע״, לכן הוא לא מופיע באף יום של הסבב. משנים את זה בעריכה.");
  else if (!soldier.inReport) notes.push("לא נספר בדוח (שוחרר / נדחה).");
  else if (!listed) notes.push(soldier.callUpOn ? "לא בשירות ביום הזה: לפני תאריך הגיוס או אחרי השחרור." : "אין תאריך גיוס, לכן החייל לא מופיע בדוח.");
  else {
    if (todayStatus?.needsOutpost && location?.kind !== "outpost") notes.push(`בסטטוס ${todayStatus.name} בלי מוצב בשבצ״ק.`);
    if (todayStatus && !todayStatus.needsOutpost && location?.kind === "outpost") notes.push(`משובץ ב${location.name} אבל הסטטוס ${todayStatus.name}.`);
    if (!todayStatus) notes.push(location?.kind === "outpost" ? `משובץ ב${location.name} ועדיין אין לו דיווח ${day === today ? "להיום" : "ליום הזה"}.` : `אין לו דיווח ${day === today ? "להיום" : "ליום הזה"}.`);
  }

  const strip = soldierStrip(days, statuses, soldier, round, addDays(day, -(STRIP_DAYS - 1)), day);
  const stats = soldierRoundStats(days, statuses, round, day);

  const log: CardLogEntry[] = data.log.flatMap((r, i) => {
    const lines = describeChange(r, {
      status: (id) => statusById.get(id)?.name,
      location: (id) => data.locations.find((l) => l.id === id)?.name,
      unit: (id) => unitById.get(id)?.name,
      option: (id) => optionName.get(id),
    });
    return lines.length ? [{ key: `${r.at.getTime()}-${i}`, when: when(r.at, today), actor: r.actor, lines }] : [];
  });

  const reports = listed && soldier.inReport && access.canReport(soldier.unitId);
  const open = isDayWritable({ day, now, lockAt: round.lockAt, isAdmin: access.isAdmin });

  return (
    <SoldierCard
      back={safeBack(sp.back) ?? `/doch1/soldiers${company ? `?unit=${company.id}` : ""}`}
      soldier={{
        personId,
        name: soldier.name,
        sub: [company?.name, platoon?.name, soldier.roleTitle].filter(Boolean).join(" · "),
        personalNumber: soldier.personalNumber,
        phone: soldier.phone,
        roleTitle: soldier.roleTitle,
        inReport: soldier.inReport,
        callUpOn: soldier.callUpOn,
        releasedOn: soldier.releasedOn,
        dmhCategory: soldier.dmhCategory,
        arrivalOptionId: soldier.arrivalOptionId,
        enlistmentOptionId: soldier.enlistmentOptionId,
        arrivalName: soldier.arrivalOptionId ? (optionName.get(soldier.arrivalOptionId) ?? null) : null,
        enlistmentName: soldier.enlistmentOptionId ? (optionName.get(soldier.enlistmentOptionId) ?? null) : null,
        arriving: soldier.arriving,
        hasDisc: soldier.hasDisc,
        notes: soldier.notes,
      }}
      roundName={round.name}
      day={day}
      isToday={day === today}
      lockAt={round.lockAt}
      today={{
        statusId: todayStatus?.id ?? null,
        yesterdayId: days.get(yesterday) ?? null,
        location: location?.name ?? null,
        team: team ? team.name : null,
        teamId: team && access.canEditTeam(team.holderIds) ? team.id : null,
        vehicle: vehicle ? { number: vehicle.number, state: vehicle.state === "ok" ? null : VEHICLE_STATE_LABEL[vehicle.state] } : null,
        notes,
      }}
      strip={strip}
      stats={stats}
      log={log}
      statuses={statuses}
      canReport={reports && open}
      locked={reports && !open}
      canEdit={data.editable}
      values={data.values}
    />
  );
}
