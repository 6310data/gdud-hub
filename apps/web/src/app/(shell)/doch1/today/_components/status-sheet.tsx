"use client";
import { useEffect } from "react";
import type { StatusDef } from "@gdud/core";
import { StatusDot } from "../../_components/status-chip";

/** Bottom sheet with the active statuses as tiles; choosing one saves and closes (mockup screen 07). */
export function StatusSheet({
  name,
  title,
  yesterday,
  current,
  statuses,
  onPick,
  onClose,
  onTakeOutOfReport,
}: {
  name: string;
  /** "סטטוס להיום" or "סטטוס ל…" */
  title: string;
  yesterday: string | null;
  current: string | null;
  statuses: StatusDef[];
  onPick: (statusId: string | null) => void;
  onClose: () => void;
  /** company user / admin: the soldier was released or deferred and should not be counted */
  onTakeOutOfReport?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet" role="dialog" aria-modal="true" aria-label={`שינוי סטטוס · ${name}`}>
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">{name}</span>
          <span />
        </div>
        <p className="tz-footnote m-0 pb-3.5 text-center">
          {title} · אתמול: {yesterday ?? "—"}
        </p>
        <div className="grid grid-cols-3 gap-2 px-4">
          {statuses.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className="tz-option"
              aria-pressed={s.id === current}
              autoFocus={s.id === current || (!current && i === 0)}
              onClick={() => onPick(s.id)}
            >
              <StatusDot color={s.color} size={14} />
              <span className="min-w-0 truncate">{s.name}</span>
            </button>
          ))}
        </div>
        {current || onTakeOutOfReport ? (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {current ? (
              <button type="button" className="tz-btn tz-btn-plain" onClick={() => onPick(null)}>
                ניקוי הסטטוס
              </button>
            ) : null}
            {onTakeOutOfReport ? (
              <button type="button" className="tz-btn tz-btn-plain" onClick={onTakeOutOfReport}>
                לא נספר בדוח (שוחרר / נדחה)
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="tz-footnote m-0 px-8 pt-3.5">לטווח ימים או לכמה חיילים יחד: ״בחירה״ ברשימה.</p>
      </div>
    </>
  );
}
