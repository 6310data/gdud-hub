/**
 * דוח 1 push reminders: who gets a message and what it says. Messages carry a unit name and a
 * count — never soldier names.
 */
import { israelClock } from "./dates";

export interface ReminderRecipient {
  userId: string;
  /** the company or platoon the user reports for */
  scopeUnitId: string;
  scopeName: string;
}

export interface ReminderMessage {
  userId: string;
  unitId: string;
  missing: number;
  title: string;
  body: string;
  url: string;
}

/** One message per (user, scope) whose scope still has missing reports. */
export function reminderMessages(
  recipients: readonly ReminderRecipient[],
  missingByUnit: ReadonlyMap<string, number>,
): ReminderMessage[] {
  const out: ReminderMessage[] = [];
  for (const r of recipients) {
    const missing = missingByUnit.get(r.scopeUnitId) ?? 0;
    if (missing <= 0) continue;
    out.push({
      userId: r.userId,
      unitId: r.scopeUnitId,
      missing,
      title: "דוח 1",
      body: `${r.scopeName} · חסרים ${missing} דיווחים להיום`,
      url: `/doch1/today?unit=${r.scopeUnitId}`,
    });
  }
  return out;
}

/** "Fill צפי הגעה" from the planning screen: one message per (user, scope) with soldiers not filled yet. */
export function arrivalReminderMessages(
  recipients: readonly ReminderRecipient[],
  blankByUnit: ReadonlyMap<string, number>,
): ReminderMessage[] {
  const out: ReminderMessage[] = [];
  for (const r of recipients) {
    const missing = blankByUnit.get(r.scopeUnitId) ?? 0;
    if (missing <= 0) continue;
    out.push({
      userId: r.userId,
      unitId: r.scopeUnitId,
      missing,
      title: "דוח 1 · תכנון סבב",
      body: `${r.scopeName} · חסר צפי הגעה ל־${missing} חיילים`,
      url: `/doch1/planning?unit=${r.scopeUnitId}`,
    });
  }
  return out;
}

/** The daily reminder is due once the Israel clock reaches the reminder time, once a day. */
export function isDue(now: Date, reminderAt: string, alreadySentToday: boolean): boolean {
  return !alreadySentToday && israelClock(now) >= reminderAt.slice(0, 5);
}
