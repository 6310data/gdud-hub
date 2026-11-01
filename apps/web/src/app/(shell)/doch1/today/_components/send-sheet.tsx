"use client";
import { useEffect } from "react";
import { Spinner } from "@gdud/ui";

/** Confirms "שליחת הדוח": what sending closes, and a warning while soldiers still have no status for the day. */
export function SendSheet({
  unitName,
  isCompany,
  dayLabel,
  missing,
  pending,
  onSend,
  onClose,
}: {
  unitName: string;
  /** a company's send closes its platoons too */
  isCompany: boolean;
  dayLabel: string;
  /** soldiers in the report with no status for the day (summarize().missing) */
  missing: number;
  pending: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet flex flex-col" role="dialog" aria-modal="true" aria-label="שליחת הדוח">
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">שליחת הדוח</span>
          <span />
        </div>
        <p className="tz-footnote m-0 pb-3.5 text-center">
          {unitName} · {dayLabel}
        </p>
        <div className="flex flex-col gap-2.5 px-4">
          {missing ? (
            <p role="alert" className="tz-alert tz-alert-error m-0">
              {missing === 1 ? "חסר דיווח לחייל אחד" : `חסרים ${missing} דיווחים`}. מי שאין לו סטטוס יישאר חסר בדוח שנשלח.
            </p>
          ) : null}
          <p className="m-0 text-[15px]">
            אחרי השליחה הדוח {isCompany ? "של הפלוגה וכל המחלקות שלה " : ""}נסגר: אי אפשר לשנות בו סטטוסים. מנהל דוח 1 יכול לשנות אותו או לפתוח
            אותו מחדש, ויקבל התראה שהדוח נשלח.
          </p>
          <button type="button" className="tz-btn tz-btn-filled min-h-11 text-base" disabled={pending} aria-busy={pending || undefined} autoFocus onClick={onSend}>
            {pending ? <Spinner /> : null}
            {missing ? "שליחה בכל זאת" : "שליחה"}
          </button>
        </div>
      </div>
    </>
  );
}
