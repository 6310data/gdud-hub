"use client";
/** Small client pieces of the מול חטיבה and ציוד תקול forms: toast, date + note, quantity input. */
import { useEffect, useState } from "react";
import { addDays } from "@gdud/core";

const TOAST_MS = 4000;

/** A message shown at the bottom for a few seconds. */
export function useToast(): [string | undefined, (msg: string) => void] {
  const [toast, setToast] = useState<string>();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, setToast];
}

export function Toast({ msg }: { msg: string | undefined }) {
  if (!msg) return null;
  return (
    <div className="tz-toast lg:bottom-6" role="status">
      <span>{msg}</span>
    </div>
  );
}

export function ErrorAlert({ error }: { error: string | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="tz-alert tz-alert-error m-0 whitespace-pre-line">
      {error}
    </p>
  );
}

/** תאריך (today by default, up to a year back, never in the future) and הערה. */
export function MoveFields({
  today,
  day,
  notes,
  onDay,
  onNotes,
  disabled,
}: {
  today: string;
  day: string;
  notes: string;
  onDay(v: string): void;
  onNotes(v: string): void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
      <label className="tz-field">
        <span className="tz-label">תאריך</span>
        <input className="tz-input" type="date" value={day} min={addDays(today, -365)} max={today} onChange={(e) => onDay(e.target.value)} disabled={disabled} />
      </label>
      <label className="tz-field">
        <span className="tz-label">הערה</span>
        <input className="tz-input" value={notes} maxLength={300} onChange={(e) => onNotes(e.target.value)} placeholder="למשל: מספר תעודה" disabled={disabled} />
      </label>
    </div>
  );
}

/** The day to send: blank / today = now. Returns an error message for a future day. */
export function checkDay(day: string, today: string): string | undefined {
  if (day && day > today) return "תאריך עתידי — אפשר לרשום רק פעולה שכבר קרתה";
  if (day && day < addDays(today, -365)) return "התאריך רחוק מדי (עד שנה אחורה)";
  return undefined;
}

/** A whole number from a text field ("" = 0, anything else invalid = NaN). */
export const qtyOf = (v: string | undefined): number => {
  const t = (v ?? "").trim();
  if (!t) return 0;
  return /^\d+$/.test(t) ? Number(t) : NaN;
};

/** A small number field for a table cell; red when over `max` or not a whole number. */
export function QtyInput({ value, max, label, onChange, disabled }: { value: string; max?: number; label: string; onChange(v: string): void; disabled?: boolean }) {
  const n = qtyOf(value);
  const bad = Number.isNaN(n) || (max !== undefined && n > max);
  return (
    <input
      className={`tz-input tz-num min-h-8 w-[72px] px-2 py-0 text-center text-[15px] ${bad ? "text-danger" : ""}`}
      inputMode="numeric"
      dir="ltr"
      value={value}
      placeholder="0"
      aria-label={label}
      aria-invalid={bad || undefined}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
      onFocus={(e) => e.target.select()}
      disabled={disabled}
    />
  );
}
