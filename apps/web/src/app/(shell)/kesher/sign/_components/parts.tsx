"use client";
/** Small client pieces shared by החתמה and זיכוי. */
import type { ReactNode } from "react";
import { Icon } from "@gdud/ui";

export interface CompanyOpt {
  id: string;
  name: string;
  color: string | null;
}

/** A device type's תקן, keyed by the parent item's name (Map isn't serializable, so a record). */
export type KitRecord = Record<string, { item: string; qty: number }[]>;

export const kitMap = (kits: KitRecord) => new Map(Object.entries(kits));

/** device type name → how many of `rows` */
export function countByType<T>(rows: readonly T[], type: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(type(r), (out.get(type(r)) ?? 0) + 1);
  return out;
}

export function StepTitle({ n, title, note }: { n: number; title: string; note?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="tz-step">{n}</span>
      <h2 className="tz-headline flex-1">{title}</h2>
      {note ? <span className="text-xs text-ink-muted">{note}</span> : null}
    </div>
  );
}

export function ErrorAlert({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="tz-alert tz-alert-error m-0 whitespace-pre-line">
      {error}
    </p>
  ) : null;
}

/** − [n] + ; `max` caps the + button and typed values (undefined = no cap). */
export function QtyStepper({ value, max, onChange, label }: { value: number; max?: number; onChange: (n: number) => void; label: string }) {
  const clamp = (n: number) => Math.max(0, max === undefined ? n : Math.min(n, max));
  return (
    <span className="tz-stepper" role="group" aria-label={label}>
      <button type="button" aria-label="הפחתה" disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))}>
        <Icon name="minus" size={14} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(clamp(Number.parseInt(e.target.value, 10) || 0))}
        onFocus={(e) => e.target.select()}
        className="tz-num h-[26px] w-12 rounded-tile border-0 bg-transparent text-center font-semibold text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" aria-label="הוספה" disabled={max !== undefined && value >= max} onClick={() => onChange(clamp(value + 1))}>
        <Icon name="plus" size={14} />
      </button>
    </span>
  );
}
