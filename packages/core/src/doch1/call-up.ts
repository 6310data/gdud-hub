/**
 * Call-up day (יום גיוס): who showed up, by the effects of the round's סטטוס גיוס values.
 * Replaces the sheet's "דוחות יום גיוס" tab. No value name lives here.
 */
import { guessEnlistmentEffect, type EnlistmentEffect, type ServiceDates } from "./counting";
import { hebrewDayLabel, type Day } from "./dates";
import { pairs } from "./outputs";
import { personalNumberKey } from "./reports";

export interface CallUpMember extends ServiceDates {
  personId: string;
  companyId: string;
  /** effect of the member's סטטוס גיוס value; null = not marked */
  enlistment: EnlistmentEffect | null;
  enlistmentOptionId: string | null;
}

/**
 * Part of the call-up on `day`: arriving, and called up by that day or already marked
 * (a postponed soldier's call-up date has moved past the day, but they still count as postponed).
 */
export function inCallUp(m: CallUpMember, day: Day): boolean {
  return m.arriving && ((m.callUpOn !== null && m.callUpOn <= day) || m.enlistment !== null);
}

export interface CallUpCounts {
  /** everyone in the call-up */
  called: number;
  /** called minus postponed and released */
  expected: number;
  arrived: number;
  /** pending or not marked yet */
  pending: number;
  postponed: number;
  released: number;
  /** arrived ÷ expected, rounded; null when nobody is expected */
  percent: number | null;
  /** per סטטוס גיוס value id; null = not marked */
  byOption: Map<string | null, number>;
}

const emptyCounts = (): CallUpCounts => ({
  called: 0,
  expected: 0,
  arrived: 0,
  pending: 0,
  postponed: 0,
  released: 0,
  percent: null,
  byOption: new Map(),
});

export function callUpSummary(members: readonly CallUpMember[], day: Day): { total: CallUpCounts; byCompany: Map<string, CallUpCounts> } {
  const total = emptyCounts();
  const byCompany = new Map<string, CallUpCounts>();
  const add = (c: CallUpCounts, m: CallUpMember) => {
    c.called++;
    if (m.enlistment === "arrived") c.arrived++;
    else if (m.enlistment === "postponed") c.postponed++;
    else if (m.enlistment === "released") c.released++;
    else c.pending++;
    c.byOption.set(m.enlistmentOptionId, (c.byOption.get(m.enlistmentOptionId) ?? 0) + 1);
  };
  for (const m of members) {
    if (!inCallUp(m, day)) continue;
    add(total, m);
    let c = byCompany.get(m.companyId);
    if (!c) byCompany.set(m.companyId, (c = emptyCounts()));
    add(c, m);
  }
  for (const c of [total, ...byCompany.values()]) {
    c.expected = c.called - c.postponed - c.released;
    c.percent = c.expected > 0 ? Math.round((c.arrived * 100) / c.expected) : null;
  }
  return { total, byCompany };
}

const pct = (p: number | null) => (p === null ? "" : ` (${p}%)`);

/** The brigade WhatsApp block for the call-up (counts only, no names). */
export function callUpBrigadeText(input: {
  battalionName: string;
  day: Day;
  total: CallUpCounts;
  /** in unit sort order */
  companies: Array<{ name: string; summary: CallUpCounts }>;
}): string {
  const { total } = input;
  const lines = [
    `*${input.battalionName} – יום גיוס · ${hebrewDayLabel(input.day)}*`,
    `התייצבו: ${total.arrived} מתוך ${total.expected}${pct(total.percent)}`,
    ...pairs([`טרם התייצבו ${total.pending}`, `נדחו ${total.postponed}`, `שוחררו ${total.released}`]),
  ];
  if (input.companies.length) {
    lines.push("*לפי פלוגה (התייצבו / צפויים)*");
    lines.push(...pairs(input.companies.map((c) => `${c.name} ${c.summary.arrived} / ${c.summary.expected}${pct(c.summary.percent)}`)));
  }
  return lines.join("\n");
}

/* ── The brigade's list of who showed up ─────────────────────────────────── */

/** A row of the brigade's file; `line` is the file's row number. */
export interface BrigadeRow {
  line: number;
  personalNumber: string;
  name: string;
  /** the file's status text; "" when the list has no status column (every row showed up) */
  status: string;
}

export interface BrigadeMember {
  personId: string;
  personalNumber: string | null;
  /** marked with an "arrived" סטטוס גיוס here */
  arrived: boolean;
}

export interface BrigadeComparison {
  /** showed up on both lists */
  agree: number;
  /** showed up on the brigade's list, not marked arrived here */
  notMarked: Array<{ row: BrigadeRow; personId: string }>;
  /** marked arrived here, missing from the brigade's list or not arrived there */
  notInBrigade: Array<{ personId: string; row: BrigadeRow | null }>;
  /** rows of the brigade's list that are no soldier of the round */
  unknown: BrigadeRow[];
}

/** Does the brigade's row say the soldier showed up? A list without statuses lists only those who did. */
export const brigadeArrived = (row: BrigadeRow): boolean => !row.status || guessEnlistmentEffect(row.status) === "arrived";

/** Compare the brigade's list with the round's סטטוס גיוס, by מספר אישי (digits only, leading zeros ignored). */
export function compareBrigadeList(members: readonly BrigadeMember[], rows: readonly BrigadeRow[]): BrigadeComparison {
  const byNumber = new Map<string, BrigadeMember>();
  for (const m of members) {
    const k = personalNumberKey(m.personalNumber);
    if (k) byNumber.set(k, m);
  }
  const out: BrigadeComparison = { agree: 0, notMarked: [], notInBrigade: [], unknown: [] };
  const seen = new Map<string, BrigadeRow>();
  for (const row of rows) {
    const m = byNumber.get(personalNumberKey(row.personalNumber) ?? "");
    if (!m) {
      out.unknown.push(row);
      continue;
    }
    if (seen.has(m.personId)) continue;
    seen.set(m.personId, row);
    const there = brigadeArrived(row);
    if (there && m.arrived) out.agree++;
    else if (there) out.notMarked.push({ row, personId: m.personId });
    else if (m.arrived) out.notInBrigade.push({ personId: m.personId, row });
  }
  for (const m of members) if (m.arrived && !seen.has(m.personId)) out.notInBrigade.push({ personId: m.personId, row: null });
  return out;
}
