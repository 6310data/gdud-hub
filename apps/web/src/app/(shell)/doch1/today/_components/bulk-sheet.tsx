"use client";
import { useEffect, useState } from "react";
import { addDays, dayRange, type Day, type StatusDef } from "@gdud/core";
import { StatusDot } from "../../_components/status-chip";

type Mode = "day" | "next" | "range";
const MAX_DAYS = 31;

/** Group update (mockup screen 08): days (this day / the next / a range) → one status for the selected soldiers. */
export function BulkSheet({
  count,
  day,
  lastDay,
  statuses,
  overwrittenFor,
  pending,
  onSubmit,
  onClose,
}: {
  count: number;
  /** the screen's day ("היום" in the sheet) */
  day: Day;
  /** the last day that may be chosen (round end / loaded range) */
  lastDay: Day;
  statuses: StatusDef[];
  /** planned days the update would replace, from the days already loaded on the page */
  overwrittenFor: (days: Day[], statusId: string) => number;
  pending: boolean;
  onSubmit: (v: { from: Day; to: Day; statusId: string }) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("day");
  const [from, setFrom] = useState(day);
  const [to, setTo] = useState(day);
  const [statusId, setStatusId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const next = addDays(day, 1);
  const range: Day[] = mode === "day" ? [day] : mode === "next" ? [next] : dayRange(from, to);
  const valid = range.length > 0 && range.length <= MAX_DAYS && range.every((d) => d >= day && d <= lastDay);
  const status = statuses.find((s) => s.id === statusId);
  const overwritten = status && valid ? overwrittenFor(range, status.id) : 0;

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet flex flex-col" role="dialog" aria-modal="true" aria-label={`עדכון ${count} חיילים`}>
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-2">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">עדכון {count} חיילים</span>
          <span />
        </div>

        <h2 className="tz-section-header pt-1.5">ימים</h2>
        <div className="flex flex-col gap-2 px-4">
          <div className="tz-seg" role="tablist" aria-label="ימים">
            {(
              [
                ["day", "היום"],
                ["next", "מחר"],
                ["range", "טווח"],
              ] as const
            ).map(([m, label]) => (
              <button key={m} type="button" role="tab" className="tz-seg-item" aria-selected={mode === m} disabled={m === "next" && next > lastDay} onClick={() => setMode(m)}>
                {label}
              </button>
            ))}
          </div>
          {mode === "range" ? (
            <div className="tz-group">
              <label className="tz-row">
                <span className="tz-row-body">
                  <span className="tz-row-title">מתאריך</span>
                  <input className="tz-input w-auto" type="date" value={from} min={day} max={lastDay} onChange={(e) => setFrom(e.target.value)} />
                </span>
              </label>
              <label className="tz-row">
                <span className="tz-row-body">
                  <span className="tz-row-title">עד תאריך</span>
                  <input className="tz-input w-auto" type="date" value={to} min={from} max={lastDay} onChange={(e) => setTo(e.target.value)} />
                </span>
              </label>
            </div>
          ) : null}
          {mode === "range" && !valid ? <p className="tz-footnote m-0 text-danger">טווח לא תקין (עד {MAX_DAYS} ימים, מהיום ועד סוף הסבב).</p> : null}
        </div>

        <h2 className="tz-section-header pt-[18px]">סטטוס</h2>
        <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-3">
          {statuses.map((s) => (
            <button key={s.id} type="button" className="tz-option" aria-pressed={s.id === statusId} onClick={() => setStatusId(s.id)}>
              <StatusDot color={s.color} size={14} />
              <span className="min-w-0 truncate">{s.name}</span>
            </button>
          ))}
        </div>
        {overwritten ? (
          <p className="tz-footnote m-0 px-8 pt-2">יחליף {overwritten} ימים מתוכננים. אפשר לבטל מההודעה שתופיע אחרי העדכון.</p>
        ) : null}

        <div className="flex gap-2 px-4 pt-4">
          <button
            type="button"
            className="tz-btn tz-btn-filled flex-1"
            disabled={!status || !valid || pending}
            onClick={() => status && onSubmit({ from: range[0]!, to: range[range.length - 1]!, statusId: status.id })}
          >
            {pending ? "מעדכן…" : `עדכון ${count} חיילים${status ? ` · ${status.name}` : ""} · ${range.length} ימים`}
          </button>
        </div>
      </div>
    </>
  );
}
