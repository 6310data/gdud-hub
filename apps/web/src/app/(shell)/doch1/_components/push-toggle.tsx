"use client";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Spinner } from "@gdud/ui";
import { removeSubscription, saveSubscription } from "../_actions/push";

// NEXT_PUBLIC_* must be read with literal property access so Next.js can inline it.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const SW_PATH = "/sw.js";

type Support = "none" | "ios-install" | "ok";

function detectSupport(): Support {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) {
    // iPhone/iPad Safari exposes push only to a site opened from the home screen
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    return ios && !standalone ? "ios-install" : "none";
  }
  return "ok";
}
const noSubscribe = () => () => {};

/** base64url → bytes (the VAPID public key format pushManager.subscribe expects). */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** "קבלת תזכורות" on the today screen: subscribe this browser to push reminders. */
export function PushToggle() {
  const support = useSyncExternalStore(noSubscribe, detectSupport, () => "none" as Support);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (support !== "ok") return;
    let cancelled = false;
    navigator.serviceWorker
      .getRegistration(SW_PATH)
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => !cancelled && setSubscribed(Boolean(sub)))
      .catch(() => !cancelled && setSubscribed(false));
    return () => {
      cancelled = true;
    };
  }, [support]);

  if (support === "none") return null;
  if (support === "ios-install") {
    return <p className="tz-footnote m-0">כדי לקבל תזכורות: שיתוף ← הוספה למסך הבית, ואז לפתוח מהאייקון</p>;
  }
  if (subscribed === null) return null;

  const enable = () =>
    start(async () => {
      setError(undefined);
      try {
        const reg = await navigator.serviceWorker.register(SW_PATH);
        if ((await Notification.requestPermission()) !== "granted") {
          setError("ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות האתר.");
          return;
        }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY!) });
        const json = sub.toJSON();
        const r = await saveSubscription({
          endpoint: sub.endpoint,
          keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
          userAgent: navigator.userAgent.slice(0, 300),
        });
        if (r?.error) {
          await sub.unsubscribe();
          setError(r.error);
          return;
        }
        setSubscribed(true);
      } catch {
        setError("לא הצלחנו להפעיל תזכורות בדפדפן הזה.");
      }
    });

  const disable = () =>
    start(async () => {
      setError(undefined);
      const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removeSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    });

  return (
    <span className="flex flex-wrap items-center gap-2">
      {subscribed ? (
        <>
          <span className="tz-footnote">תזכורות פעילות</span>
          <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" disabled={pending} aria-busy={pending || undefined} onClick={disable}>
            {pending ? <Spinner size={14} /> : null}
            ביטול
          </button>
        </>
      ) : (
        <button type="button" className="tz-btn tz-btn-tinted tz-btn-sm" disabled={pending} aria-busy={pending || undefined} onClick={enable}>
          {pending ? <Spinner size={14} /> : null}
          קבלת תזכורות
        </button>
      )}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
