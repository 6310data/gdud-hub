"use client";
import { useState, useTransition } from "react";
import { Icon, Spinner } from "@gdud/ui";
import { requestReminder } from "../_actions/reminders";

/** Push a reminder to one company now (battalion admin, overview table). */
export function ReminderButton({ unitId, name }: { unitId: string; name: string }) {
  const [state, setState] = useState<{ ok?: boolean; error?: string }>({});
  const [pending, start] = useTransition();
  if (state.ok)
    return (
      <span className="tz-footnote" role="status">
        תישלח בדקות הקרובות
      </span>
    );
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        className="tz-icon-btn"
        aria-label={`שליחת תזכורת ל${name}`}
        title="שליחת תזכורת לפלוגה"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          start(async () => {
            const r = await requestReminder(unitId);
            setState(r?.error ? { error: r.error } : { ok: true });
          })
        }
      >
        {pending ? <Spinner size={16} /> : <Icon name="bell" size={18} />}
      </button>
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}
