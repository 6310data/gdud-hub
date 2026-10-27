/**
 * Call-up day (יום גיוס): who showed up, by the effects of the round's סטטוס גיוס values.
 * Replaces the sheet's "דוחות יום גיוס" tab. No value name lives here.
 */
import type { EnlistmentEffect, ServiceDates } from "./counting";
import { hebrewDayLabel, type Day } from "./dates";
import { pairs } from "./outputs";

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
