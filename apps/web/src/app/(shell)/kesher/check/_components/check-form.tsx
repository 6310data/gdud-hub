"use client";
/**
 * דוח צ׳ of one company: a checkbox per צ׳ (grouped by device type, "סימון קבוצה"), a note, and a
 * sticky bar with the progress and "שליחת הדוח". The ticks are kept as a draft in this browser
 * until the report is sent; a confirm says how many weren't found before sending.
 */
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Chip, Icon, Serial, Spinner } from "@gdud/ui";
import { fileCheck, type CheckFiled } from "../../_actions/checks";

export interface CheckRow {
  id: string;
  serial: string;
  /** holder · role · frame inside the company */
  holder: string | null;
  /** the last report didn't find it */
  missedLast: boolean;
}
export interface CheckGroup {
  type: string;
  rows: CheckRow[];
}

const draftKey = (unitId: string) => `kesher-check:${unitId}`;
const noSubscribe = () => () => {};

/** The draft's raw text on this device ("" on the server and when storage is blocked). */
function readDraft(unitId: string): string {
  try {
    return window.localStorage.getItem(draftKey(unitId)) ?? "";
  } catch {
    return "";
  }
}
function parseDraft(raw: string, ids: ReadonlySet<string>): Set<string> {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && ids.has(id)) : []);
  } catch {
    return new Set();
  }
}
function writeDraft(unitId: string, found: ReadonlySet<string> | null) {
  try {
    if (found?.size) window.localStorage.setItem(draftKey(unitId), JSON.stringify([...found]));
    else window.localStorage.removeItem(draftKey(unitId));
  } catch {
    // private mode / blocked storage: the draft just isn't kept
  }
}

export function CheckForm({ unitId, companyName, reporter, groups }: { unitId: string; companyName: string; reporter: string; groups: CheckGroup[] }) {
  const all = groups.flatMap((g) => g.rows);
  const stored = useSyncExternalStore(noSubscribe, () => readDraft(unitId), () => "");
  /** null = nothing ticked here yet: the stored draft */
  const [ticked, setTicked] = useState<ReadonlySet<string> | null>(null);
  const found = ticked ?? parseDraft(stored, new Set(all.map((r) => r.id)));
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<CheckFiled | null>(null);
  const [pending, start] = useTransition();

  const setFound = (next: ReadonlySet<string>) => {
    setTicked(next);
    writeDraft(unitId, next);
  };

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirming(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  const toggle = (ids: readonly string[], on: boolean) => {
    const next = new Set(found);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setFound(next);
  };
  const missing = all.length - found.size;

  function send() {
    setError(undefined);
    start(async () => {
      const r = await fileCheck({ unitId, note, foundIds: [...found], shownIds: all.map((x) => x.id) });
      setConfirming(false);
      if (!r.ok) return setError(r.error);
      writeDraft(unitId, null);
      setDone(r.data);
    });
  }

  if (done) {
    const notFound = done.total - done.found;
    return (
      <div className="tz-card flex flex-col items-start gap-3 px-4 py-4">
        <span className="flex items-center gap-2 text-[17px] font-semibold">
          <Icon name="check" size={20} />
          הדוח נשלח · {companyName}
        </span>
        <span>
          <span className="tz-num">
            {done.found}/{done.total}
          </span>{" "}
          נראו בעין{notFound ? ` · ${notFound} לא נמצאו — מחלקת הקשר תראה זאת בסקירה` : " · כל הצ׳ נמצאו"}.
        </span>
        {done.added ? <p className="tz-alert m-0">{done.added} צ׳ נוספו לפלוגה בזמן המילוי ולא הופיעו ברשימה — הם נרשמו כלא נמצאו.</p> : null}
        <Link href={`/kesher/companies/${unitId}`} className="tz-btn tz-btn-tinted tz-btn-sm">
          לדף הפלוגה
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="tz-btn tz-btn-tinted tz-btn-sm" onClick={() => toggle(all.map((r) => r.id), true)} disabled={pending}>
          <Icon name="check" size={16} />
          כולם נמצאו
        </button>
        <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" onClick={() => setFound(new Set())} disabled={pending || !found.size}>
          ניקוי הסימונים
        </button>
      </div>

      {groups.map((g) => {
        const ids = g.rows.map((r) => r.id);
        const on = ids.filter((id) => found.has(id)).length;
        return (
          <section key={g.type} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 px-4">
              <h2 className="tz-section-header m-0 p-0">
                {g.type}{" "}
                <span className="tz-num font-normal">
                  · {on}/{ids.length}
                </span>
              </h2>
              <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-0" onClick={() => toggle(ids, on < ids.length)} disabled={pending}>
                {on < ids.length ? "סימון קבוצה" : "ביטול הקבוצה"}
              </button>
            </div>
            <div className="tz-group">
              {g.rows.map((r) => (
                <label key={r.id} className="tz-row cursor-pointer">
                  <input type="checkbox" className="size-5 shrink-0" checked={found.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} disabled={pending} aria-label={`${g.type} ${r.serial} נמצא`} />
                  <span className="tz-row-body">
                    <span className="tz-row-title">
                      <Serial>{r.serial}</Serial>
                      {r.holder ? <span className="tz-row-sub">{r.holder}</span> : <span className="tz-row-sub">לא משויך בפלוגה</span>}
                    </span>
                    {r.missedLast ? <Chip tone="broken">לא נמצא בפעם הקודמת</Chip> : null}
                  </span>
                </label>
              ))}
            </div>
          </section>
        );
      })}

      <section className="flex flex-col gap-1.5">
        <h2 className="tz-section-header">הערה</h2>
        <div className="tz-card flex flex-col gap-2 px-4 py-3">
          <textarea className="tz-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="למשל: 2 מכשירים בתיקון אצל הטכנאי" aria-label="הערה לדוח" />
          <span className="tz-footnote">מדווח: {reporter}</span>
        </div>
      </section>

      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}

      <div className="tz-action-bar lg:sticky lg:bottom-4 lg:rounded-group">
        <span className="text-[15px] font-semibold">
          <span className="tz-num">
            {found.size}/{all.length}
          </span>{" "}
          נמצאו
        </span>
        <button type="button" className="tz-btn tz-btn-filled tz-btn-sm ms-auto" onClick={() => setConfirming(true)} disabled={pending || !all.length}>
          שליחת הדוח
        </button>
      </div>

      {confirming ? (
        <>
          <button type="button" className="tz-scrim" aria-label="סגירה" onClick={() => setConfirming(false)} />
          <div className="tz-sheet flex flex-col gap-3 px-4" role="dialog" aria-modal="true" aria-label="שליחת דוח צ׳">
            <div className="tz-grabber" />
            <span className="tz-headline">שליחת דוח צ׳ · {companyName}</span>
            <p className="m-0">
              {missing ? (
                <>
                  <span className="tz-num font-semibold">{missing}</span> מתוך <span className="tz-num">{all.length}</span> צ׳ לא סומנו — הם יירשמו כ״לא נמצא״ ומחלקת הקשר תראה זאת.
                </>
              ) : (
                <>
                  כל <span className="tz-num">{all.length}</span> הצ׳ סומנו כנמצאים.
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="tz-btn tz-btn-filled" onClick={send} disabled={pending} aria-busy={pending || undefined}>
                {pending ? <Spinner size={14} /> : null}
                שליחה
              </button>
              <button type="button" className="tz-btn tz-btn-plain" onClick={() => setConfirming(false)} disabled={pending}>
                חזרה לדוח
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
