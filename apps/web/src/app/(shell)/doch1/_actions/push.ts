"use server";
/**
 * Push subscriptions: each doch1 or kesher member manages their own browsers (RLS: own rows only).
 * One subscription per browser serves both departments; kesher uses this toggle too.
 */
import { z } from "zod";
import { can } from "@gdud/auth";
import { and, eq, schema, withUser } from "@gdud/db";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { firstIssue, NO_PERMISSION } from "./common";

const { doch1PushSubscriptions: subs } = schema;

const endpoint = z
  .string()
  .max(1000, "כתובת ארוכה מדי")
  .refine((v) => v.startsWith("https://"), "כתובת לא תקינה");
const subInput = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  userAgent: z.string().max(300).optional(),
});

async function member() {
  const s = await getSession();
  return s && (can(s.user, "doch1", "any") || can(s.user, "kesher", "any")) ? s : null;
}

export async function saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }): Promise<ActionResult> {
  const s = await member();
  if (!s) return NO_PERMISSION;
  const parsed = subInput.safeParse(sub);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { keys, userAgent } = parsed.data;
  try {
    await withUser(s.claims, async (tx) => {
      // an endpoint belongs to one browser: replace this user's row for it
      await tx.delete(subs).where(and(eq(subs.endpoint, parsed.data.endpoint), eq(subs.userId, s.user.id)));
      await tx.insert(subs).values({ endpoint: parsed.data.endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null });
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  return { ok: true };
}

export async function removeSubscription(input: string): Promise<ActionResult> {
  const s = await member();
  if (!s) return NO_PERMISSION;
  const parsed = endpoint.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(s.claims, (tx) => tx.delete(subs).where(and(eq(subs.endpoint, parsed.data), eq(subs.userId, s.user.id))));
  } catch (err) {
    return { error: actionError(err) };
  }
  return { ok: true };
}
