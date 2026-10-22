import "server-only";
/**
 * Web push sender (VAPID). Server-only: the private key never reaches the browser.
 * Payloads carry counts and unit names only — never soldier names.
 */
import webpush from "web-push";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushPayload {
  title: string;
  body: string;
  /** same-origin relative path */
  url: string;
}

const PUSH_TTL_SECONDS = 4 * 60 * 60;
let configured = false;

/** VAPID settings from the environment; throws a clear error when they are missing. */
function configure(): void {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT — see .env.example");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/** "gone" = the browser dropped the subscription (HTTP 404/410): delete it. */
export async function sendPush(sub: PushTarget, payload: PushPayload): Promise<"ok" | "gone" | "error"> {
  configure();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
      TTL: PUSH_TTL_SECONDS,
      urgency: "high",
    });
    return "ok";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    console.error("push failed", status ?? err);
    return "error";
  }
}
