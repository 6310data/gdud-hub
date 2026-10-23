"use client";
import { useState, useTransition } from "react";
import { requestReminder } from "../_actions/reminders";

/** Push a reminder to one company now (battalion admin, overview table). */
export function ReminderButton({ unitId, name }: { unitId: string; name: string }) {
  const [state, setState] = useState<{ ok?: boolean; error?: string }>({});
  const [pending, start] = useTransition();
  if (state.ok) return <span className="tz-footnote">התזכורת תישלח תוך כמה דקות</span>;
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        className="tz-btn tz-btn-tinted tz-btn-sm"
        aria-label={`תזכורת ל${name}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await requestReminder(unitId);
            setState(r?.error ? { error: r.error } : { ok: true });
          })
        }
      >
        {pending ? "…" : "תזכורת"}
      </button>
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}
