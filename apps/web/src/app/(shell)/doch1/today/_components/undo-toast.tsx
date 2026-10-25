"use client";
import { useEffect } from "react";
import { Spinner } from "@gdud/ui";

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
      <button type="button" className="inline-flex items-center gap-1.5" onClick={onUndo} disabled={pending}>
        {pending ? <Spinner size={14} /> : null}
        {pending ? "מבטל…" : "ביטול"}
      </button>
    </div>
  );
}
