"use client";
import { useRef, useState } from "react";

/** The day's column as text, one sheet row per line, with a copy button (fallback: select the text). */
export function CopyColumn({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState<string>();

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNote("הועתק. הדביקו בתא הראשון של עמודת היום בגיליון.");
    } catch {
      ref.current?.focus();
      ref.current?.select();
      setNote("לא ניתן להעתיק אוטומטית — הטקסט מסומן, אפשר להעתיק ידנית.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={ref}
        readOnly
        value={text}
        aria-label={label}
        rows={Math.min(16, Math.max(4, text.split("\n").length))}
        className="tz-input font-mono text-[14px]"
        dir="rtl"
      />
      <button type="button" className="tz-btn tz-btn-filled" onClick={copy}>
        העתקה
      </button>
      {note ? (
        <p role="status" className="tz-footnote m-0">
          {note}
        </p>
      ) : null}
    </div>
  );
}
