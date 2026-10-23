"use client";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { brigadeReportText, type BrigadeInput } from "@gdud/core";
import { Icon } from "@gdud/ui";
import { logBrigadeCopy } from "../../_actions/brigade";

const BOLD_LINE = /^\*(.+)\*$/;

const noSubscribe = () => () => {};
/** Web Share exists only in some browsers; false on the server so hydration matches. */
const useCanShare = () => useSyncExternalStore(noSubscribe, () => "share" in navigator, () => false);

function Switch({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="tz-row">
      <span className="tz-row-body">
        <label htmlFor={id} className="tz-row-title">
          {label}
        </label>
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </div>
  );
}

/** WhatsApp text for the brigade (mockup screen 10), recomputed locally when the toggles change. */
export function BrigadePreview({ input }: { input: BrigadeInput }) {
  const [byCompany, setByCompany] = useState(true);
  const [missingNames, setMissingNames] = useState(false);
  const [note, setNote] = useState<string>();
  const [pending, start] = useTransition();
  const textRef = useRef<HTMLDivElement>(null);
  const canShare = useCanShare();

  const text = brigadeReportText(input, { byCompany, missingNames });
  const partial = input.total.missing > 0;

  const log = () =>
    start(async () => {
      const r = await logBrigadeCopy({ day: input.day, content: text, partial });
      setNote(r?.error ? r.error : "הועתק ונשמר ביומן הדוחות");
    });

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      log();
    } catch {
      // no clipboard permission: select the text so it can be copied by hand
      const sel = window.getSelection();
      if (textRef.current && sel) {
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(textRef.current);
        sel.addRange(range);
      }
      setNote("לא ניתן להעתיק אוטומטית — הטקסט מסומן, אפשר להעתיק ידנית.");
    }
  }

  async function share() {
    try {
      await navigator.share({ text });
      log();
    } catch {
      // the user closed the share sheet
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      {partial ? (
        <div className="tz-alert flex gap-2.5" style={{ background: "var(--status-broken-soft)", color: "var(--status-broken)" }}>
          <Icon name="alert" size={18} />
          <span>עדיין חסרים {input.total.missing} דיווחים. הדוח יסומן כחלקי עד שכל הפלוגות ישלימו.</span>
        </div>
      ) : null}

      <h2 className="tz-section-header pt-2">תצוגה מקדימה</h2>
      <div ref={textRef} className="tz-card whitespace-pre-line px-4 py-3.5 text-[15px] leading-[23px]" dir="rtl">
        {text.split("\n").map((line, i) => {
          const bold = BOLD_LINE.exec(line);
          return <div key={i}>{bold ? <strong>{bold[1]}</strong> : line}</div>;
        })}
      </div>

      <h2 className="tz-section-header pt-3">מה לכלול</h2>
      <div className="tz-group">
        <Switch id="by-company" label="פירוט לפי פלוגה" checked={byCompany} onChange={setByCompany} />
        <Switch id="missing-names" label="שמות החסרים" checked={missingNames} onChange={setMissingNames} />
      </div>

      <div className="flex gap-2 pt-2">
        {canShare ? (
          <button type="button" className="tz-btn tz-btn-tinted flex-1" disabled={pending} onClick={share}>
            שיתוף
          </button>
        ) : null}
        <button type="button" className="tz-btn tz-btn-filled flex-[2]" disabled={pending} onClick={copy}>
          העתקה לוואטסאפ
        </button>
      </div>
      {note ? (
        <p role="status" className="tz-footnote m-0">
          {note}
        </p>
      ) : null}
      <p className="tz-footnote m-0">בזמן הפיילוט הדוח הרשמי נשלח מהגיליון — השוו את המספרים.</p>
      <p className="tz-footnote m-0">כל העתקה נשמרת ביומן הדוחות עם השעה והשולח.</p>
    </div>
  );
}
