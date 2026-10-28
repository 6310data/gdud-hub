"use server";
/**
 * הגדרות מחלקת קשר (battalion kesher admin): when a check counts as old, and the push notifications
 * of דוח צ׳. kesher_settings updates are admin-only (0018 / 0025_kesher_*_security.sql); its checks
 * keep the numbers in range.
 */
import { z } from "zod";
import { schema, withUser } from "@gdud/db";
import { actionError, type ActionOutcome } from "@/lib/action-result";
import { firstIssue, kesherCtx, NO_PERMISSION, revalidateKesher } from "./common";

const { kesherSettings: settings, kesherEvents: events } = schema;

const days = (min: number, max: number, what: string) =>
  z.number({ error: `${what}: מספר ימים` }).int(`${what}: מספר ימים שלם`).min(min, `${what}: ${min} עד ${max} ימים`).max(max, `${what}: ${min} עד ${max} ימים`);

const settingsSchema = z
  .object({
    checkStaleDays: days(1, 90, "דוח צ׳ ישן"),
    eyeWarnDays: days(1, 60, "צהוב"),
    eyeAlertDays: days(1, 90, "אדום"),
    notifyMissing: z.boolean(),
    /** Israel hour, null = off */
    reminderHour: z.number().int().min(0, "שעה לא תקינה").max(23, "שעה לא תקינה").nullable(),
  })
  .refine((v) => v.eyeAlertDays >= v.eyeWarnDays, "האדום מתחיל אחרי הצהוב");
export type KesherSettingsInput = z.input<typeof settingsSchema>;

export async function saveSettings(input: KesherSettingsInput): Promise<ActionOutcome<null>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  if (!ctx.access.isAdmin) return { error: "רק מנהל קשר גדודי משנה הגדרות." };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  try {
    await withUser(ctx.s.claims, async (tx) => {
      await tx.update(settings).set(v);
      const hour = v.reminderHour === null ? "כבויה" : `${String(v.reminderHour).padStart(2, "0")}:00`;
      await tx.insert(events).values({
        kind: "serial_edit",
        details: `הגדרות: דוח צ׳ ישן אחרי ${v.checkStaleDays} ימים · צהוב אחרי ${v.eyeWarnDays} · אדום אחרי ${v.eyeAlertDays} · התראת חוסרים ${v.notifyMissing ? "פעילה" : "כבויה"} · תזכורת יומית ${hour}`,
      });
    });
    revalidateKesher();
    return { ok: true, data: null };
  } catch (e) {
    return { error: actionError(e) };
  }
}
