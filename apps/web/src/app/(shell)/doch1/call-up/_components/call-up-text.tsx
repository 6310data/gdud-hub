"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@gdud/ui";

const noSubscribe = () => () => {};
const useCanShare = () => useSyncExternalStore(noSubscribe, () => "share" in navigator, () => false);
const BOLD_LINE = /^\*(.+)\*$/;

/** The call-up day's WhatsApp block (counts only, no names), with copy and share. */
export function CallUpText({ text }: { text: string }) {
  const [note, setNote] = useState<string>();
  const ref = useRef<HTMLDivElement>(null);
  const canShare = useCanShare();

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNote("הועתק");
    } catch {
      // no clipboard permission: select the text so it can be copied by hand
      const sel = window.getSelection();
      if (ref.current && sel) {
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(ref.current);
        sel.addRange(range);
      }
      setNote("לא ניתן להעתיק אוטומטית — הטקסט מסומן, אפשר להעתיק ידנית.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} className="tz-card whitespace-pre-line px-4 py-3.5 text-[15px] leading-[23px]" dir="rtl">
        {text.split("\n").map((line, i) => {
          const bold = BOLD_LINE.exec(line);
          return <div key={i}>{bold ? <strong>{bold[1]}</strong> : line}</div>;
        })}
      </div>
      <div className="flex gap-2">
        {canShare ? (
          <button
            type="button"
            className="tz-btn tz-btn-tinted flex-1"
            onClick={() =>
              navigator.share({ text }).catch(() => {
                // the user closed the share sheet
              })
            }
          >
            <Icon name="send" size={18} />
            שיתוף
          </button>
        ) : null}
        <button type="button" className="tz-btn tz-btn-filled flex-[2]" onClick={copy}>
          <Icon name="doc" size={18} />
          העתקה לוואטסאפ
        </button>
      </div>
      {note ? (
        <p role="status" className="tz-footnote m-0">
          {note}
        </p>
      ) : null}
    </div>
  );
}
