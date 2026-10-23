"use client";
import { useEffect } from "react";

const HIDE_AFTER_MS = 8000;

/** "עודכנו N ימים · ביטול" — hides itself after 8 s. */
export function UndoToast({ message, onUndo, onDone, pending }: { message: string; onUndo: () => void; onDone: () => void; pending: boolean }) {
  useEffect(() => {
    if (pending) return;
    const t = setTimeout(onDone, HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, [onDone, pending]);

  return (
    <div className="tz-toast lg:bottom-6" role="status">
      <span>{message}</span>
      <button type="button" onClick={onUndo} disabled={pending}>
        {pending ? "מבטל…" : "ביטול"}
      </button>
    </div>
  );
}
