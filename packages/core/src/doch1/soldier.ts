/**
 * A soldier's round numbers for the soldier card (mockup screen 09): the sheet's per-soldier
 * metrics (גדודי BY–CG, references/doch1/sheet-structure.md, "Derived numbers"), computed
 * from the status flags only — never from a status name.
 */
import { inService, type ServiceDates, type StatusDef, type StatusFlags } from "./counting";
import { addDays, dayRange, type Day } from "./dates";

/** One soldier's days: day → statusId (a missing key = no report). */
export type SoldierDays = ReadonlyMap<Day, string>;

/**
 * ימי התארגנות entitlement by total ימ״מ (sheet CC): <10 → 0, ≤14 → 2, ≤28 → 3, ≤42 → 5, ≤56 → 7, more → 9.
 * Each row: the entitlement for totals up to and including `upTo`.
 */
export const ORG_DAY_ENTITLEMENT: ReadonlyArray<{ upTo: number; days: number }> = [
  { upTo: 9, days: 0 },
  { upTo: 14, days: 2 },
  { upTo: 28, days: 3 },
  { upTo: 42, days: 5 },
  { upTo: 56, days: 7 },
  { upTo: Infinity, days: 9 },
];

export function orgEntitlement(totalDays: number): number {
  return ORG_DAY_ENTITLEMENT.find((r) => totalDays <= r.upTo)!.days;
}

/** Friday or Saturday. */
export function isWeekend(day: Day): boolean {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 5 || d === 6;
}

export interface SoldierRoundStats {
  /** שנספר days from the call-up day (sheet BZ) */
  presenceDays: number;
  /** רענון days from the call-up day (sheet CA) */
  homeDays: number;
  /** home / (home + presence), 0..1; null before any such day (sheet CF — red above 55%) */
  homeShare: number | null;
  /** total ימ״מ from the round start: כללי (its own statuses and every שנספר one) + רענון, not התארגנות (sheet CB) */
  totalDays: number;
  /** the current רענון streak, in days (sheet BY); 0 when the latest reported day is not a home day */
  homeStreak: number;
  /** התארגנות entitlement by totalDays (sheet CC) */
  orgEntitled: number;
  /** התארגנות days entered (sheet CD) */
  orgUsed: number;
  /** entitlement − (used − weekend adjustment): 0 / 0.5 / 1 for 0 / 1 / 2+ org days on Fri/Sat (sheet CE) */
  orgRemaining: number;
}

type Flags = Pick<StatusFlags, "countsAsPresent" | "homeDay" | "generalDay" | "orgDay">;

/**
 * @param round  the round's start, end and call-up day (presence counts from the call-up day, or the start)
 * @param today  days after it are the plan and are not counted
 */
export function soldierRoundStats(
  days: SoldierDays,
  statuses: ReadonlyArray<Flags & { id: string }>,
  round: { startsOn: Day; endsOn: Day; callUpOn: Day | null },
  today: Day,
): SoldierRoundStats {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const last = today < round.endsOn ? today : round.endsOn;
  const callUp = round.callUpOn && round.callUpOn > round.startsOn ? round.callUpOn : round.startsOn;
  let presenceDays = 0;
  let homeDays = 0;
  let totalDays = 0;
  let orgUsed = 0;
  let orgWeekend = 0;

  const span = dayRange(round.startsOn, last);
  for (const d of span) {
    const st = byId.get(days.get(d) ?? "");
    if (!st) continue;
    if (st.generalDay || st.countsAsPresent || st.homeDay) totalDays++;
    if (st.orgDay) {
      orgUsed++;
      if (isWeekend(d)) orgWeekend++;
    }
    if (d < callUp) continue;
    if (st.countsAsPresent) presenceDays++;
    if (st.homeDay) homeDays++;
  }

  // walk back from today: unreported days count once a home day comes before them
  let homeStreak = 0;
  let pending = 0;
  for (let d = last; d >= round.startsOn; d = addDays(d, -1)) {
    const id = days.get(d);
    if (id === undefined) {
      pending++;
      continue;
    }
    if (!byId.get(id)?.homeDay) break;
    homeStreak += pending + 1;
    pending = 0;
  }

  const orgEntitled = orgEntitlement(totalDays);
  const adjust = orgWeekend === 0 ? 0 : orgWeekend === 1 ? 0.5 : 1;
  return {
    presenceDays,
    homeDays,
    homeShare: homeDays + presenceDays ? homeDays / (homeDays + presenceDays) : null,
    totalDays,
    homeStreak,
    orgEntitled,
    orgUsed,
    orgRemaining: orgEntitled - (orgUsed - adjust),
  };
}

export type StripCell =
  | { day: Day; kind: "status"; statusId: string }
  | { day: Day; kind: "missing" }
  /** before the call-up, after the release, or outside the round: not a missing report */
  | { day: Day; kind: "off" };

export interface StripLegend {
  name: string;
  color: string;
  count: number;
}

/**
 * The card's last-days strip: one cell per day from `from` to `to`, and how many days each status
 * took (by the status order in settings; versions of one status count as one) plus the missing ones.
 */
export function soldierStrip(
  days: SoldierDays,
  statuses: readonly StatusDef[],
  member: ServiceDates & { inReport: boolean },
  round: { startsOn: Day; endsOn: Day },
  from: Day,
  to: Day,
): { cells: StripCell[]; legend: StripLegend[]; missing: number } {
  const cells: StripCell[] = dayRange(from, to).map((day) => {
    const statusId = days.get(day);
    if (statusId !== undefined) return { day, kind: "status", statusId };
    const listed = day >= round.startsOn && day <= round.endsOn && inService(member, day) && member.inReport;
    return listed ? { day, kind: "missing" } : { day, kind: "off" };
  });
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const legend = new Map<string, StripLegend & { sortOrder: number; active: boolean }>();
  for (const c of cells) {
    const s = c.kind === "status" ? byId.get(c.statusId) : undefined;
    if (!s) continue;
    const l = legend.get(s.name);
    if (!l) legend.set(s.name, { name: s.name, color: s.color, count: 1, sortOrder: s.sortOrder, active: s.active });
    else {
      l.count++;
      // the current version's color and order win over a replaced one's
      if (s.active && !l.active) Object.assign(l, { color: s.color, sortOrder: s.sortOrder, active: true });
    }
  }
  return {
    cells,
    legend: [...legend.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"))
      .map(({ name, color, count }) => ({ name, color, count })),
    missing: cells.filter((c) => c.kind === "missing").length,
  };
}
