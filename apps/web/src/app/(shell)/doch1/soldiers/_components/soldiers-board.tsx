"use client";
import Link from "next/link";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { inService, type Day } from "@gdud/core";
import { Avatar, Icon, Spinner } from "@gdud/ui";
import { fmtDay } from "@/lib/doch1/format";
import { setServiceDates } from "../../_actions/members";

export interface SoldierVM {
  personId: string;
  name: string;
  /** "מחלקה 1 · נגביסט" */
  sub: string;
  inReport: boolean;
  callUpOn: Day | null;
  releasedOn: Day | null;
  arriving: boolean;
  /** the צפי הגעה value's name, for a soldier marked not arriving */
  arrivalName: string | null;
  /** the user may set this soldier's dates (with "בחירה") */
  editable: boolean;
}

type Filter = "all" | "listed" | "no-call-up" | "upcoming" | "released" | "not-arriving";
type Change = { personIds: string[]; callUpOn?: Day | null; releasedOn?: Day | null };

const FILTERS: Array<[Filter, string, (m: SoldierVM, today: Day) => boolean]> = [
  ["all", "הכל", () => true],
  ["listed", "בדוח היום", (m, today) => inService(m, today)],
  ["no-call-up", "בלי תאריך גיוס", (m) => m.arriving && !m.callUpOn],
  ["upcoming", "עוד לא גויסו", (m, today) => m.arriving && !!m.callUpOn && m.callUpOn > today],
  ["released", "שוחררו", (m, today) => m.arriving && !!m.releasedOn && m.releasedOn < today],
  // marked "not arriving": listed on no day, whatever the dates (the soldier card switches them back)
  ["not-arriving", "לא מגיעים", (m) => !m.arriving],
];

/** The soldiers of one company with their call-up / release dates. A row opens the soldier card; "בחירה" sets dates for a selection. */
export function SoldiersBoard({ rows: serverRows, today, initialFilter, back }: { rows: SoldierVM[]; today: Day; initialFilter: string; back: string }) {
  const [rows, optimistic] = useOptimistic(serverRows, (list, c: Change) =>
    list.map((m) =>
      c.personIds.includes(m.personId)
        ? { ...m, ...(c.callUpOn !== undefined ? { callUpOn: c.callUpOn } : {}), ...(c.releasedOn !== undefined ? { releasedOn: c.releasedOn } : {}) }
        : m,
    ),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>(FILTERS.some(([id]) => id === initialFilter) ? (initialFilter as Filter) : "all");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sheetFor, setSheetFor] = useState<string[] | null>(null);

  const q = query.trim();
  const test = FILTERS.find(([id]) => id === filter)![2];
  const visible = rows.filter((m) => test(m, today) && (!q || m.name.includes(q) || m.sub.includes(q)));
  const editableVisible = visible.filter((m) => m.editable);

  function save(c: Change) {
    setSheetFor(null);
    setError(undefined);
    start(async () => {
      optimistic(c);
      const r = await setServiceDates(c);
      if (r?.error) setError(r.error);
      else {
        setSelecting(false);
        setSelected(new Set());
      }
    });
  }

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const one = sheetFor?.length === 1 ? rows.find((m) => m.personId === sheetFor[0]) : undefined;

  return (
    <div className="flex flex-col gap-3 pb-16">
      <div className="tz-pills" role="toolbar" aria-label="סינון">
        {FILTERS.map(([id, label, t]) => (
          <button key={id} type="button" className="tz-pill" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
            <span className="tz-pill-count tz-num">{rows.filter((m) => t(m, today)).length}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label className="tz-search flex-1">
          <Icon name="search" size={15} />
          <input type="search" placeholder="חיפוש חייל, מחלקה או תפקיד" aria-label="חיפוש" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {editableVisible.length ? (
          <button
            type="button"
            className="tz-btn tz-btn-plain"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((v) => !v);
              setSelected(new Set());
            }}
          >
            {selecting ? "סיום" : "בחירה"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}

      <div className="tz-group">
        {visible.map((m) => {
          const body = (
            <>
              {selecting && m.editable ? (
                <input type="checkbox" className="self-center" checked={selected.has(m.personId)} readOnly tabIndex={-1} aria-hidden="true" />
              ) : null}
              <Avatar name={m.name} />
              <span className="tz-row-body flex-wrap gap-y-1 py-1.5">
                <span className="tz-row-title min-w-[150px]">
                  {m.name}
                  <span className="tz-row-sub">{[m.sub, m.inReport ? null : "לא נספר בדוח"].filter(Boolean).join(" · ")}</span>
                </span>
                {!m.arriving ? (
                  <span className="tz-chip tz-chip-broken">{m.arrivalName ?? "לא מגיע"}</span>
                ) : m.callUpOn ? (
                  <span className="tz-chip tz-chip-signed">
                    גיוס <span className="tz-num">{fmtDay(m.callUpOn)}</span>
                  </span>
                ) : (
                  <span className="tz-chip" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                    בלי תאריך גיוס
                  </span>
                )}
                {m.releasedOn ? (
                  <span className="tz-chip tz-chip-brigade">
                    שחרור <span className="tz-num">{fmtDay(m.releasedOn)}</span>
                  </span>
                ) : null}
                {!selecting ? <Icon name="chevron" size={17} className="tz-chevron" /> : null}
              </span>
            </>
          );
          if (!selecting) {
            return (
              <Link key={m.personId} href={`/doch1/soldiers/${m.personId}?back=${encodeURIComponent(back)}`} className="tz-row">
                {body}
              </Link>
            );
          }
          return m.editable ? (
            <button key={m.personId} type="button" className="tz-row" aria-pressed={selected.has(m.personId)} onClick={() => toggle(m.personId)}>
              {body}
            </button>
          ) : (
            <div key={m.personId} className="tz-row">
              {body}
            </div>
          );
        })}
        {!visible.length ? <p className="tz-footnote m-0 p-4 text-center">אין חיילים בסינון הזה.</p> : null}
      </div>

      {selecting ? (
        <div className="tz-action-bar lg:sticky lg:bottom-4 lg:rounded-group">
          <span className="text-[15px] font-semibold">{selected.size} נבחרו</span>
          <button
            type="button"
            className="tz-btn tz-btn-plain tz-btn-sm"
            onClick={() => setSelected(new Set(selected.size === editableVisible.length ? [] : editableVisible.map((m) => m.personId)))}
          >
            {selected.size === editableVisible.length ? "ניקוי" : "בחירת כל המוצגים"}
          </button>
          <button type="button" className="tz-btn tz-btn-filled tz-btn-sm ms-auto" disabled={!selected.size || pending} onClick={() => setSheetFor([...selected])}>
            {pending ? <Spinner size={14} /> : null}
            קביעת תאריכים
          </button>
        </div>
      ) : null}

      {sheetFor ? (
        <DatesSheet
          title={one ? one.name : `${sheetFor.length} חיילים`}
          current={one}
          onSave={(v) => save({ personIds: sheetFor, ...v })}
          onClose={() => setSheetFor(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One soldier: both dates as they are; an empty field clears it.
 * Several soldiers: an empty field leaves each soldier's date as it is.
 */
function DatesSheet({
  title,
  current,
  onSave,
  onClose,
}: {
  title: string;
  /** undefined = several soldiers */
  current: SoldierVM | undefined;
  onSave: (v: { callUpOn?: Day | null; releasedOn?: Day | null }) => void;
  onClose: () => void;
}) {
  const [callUpOn, setCallUpOn] = useState(current?.callUpOn ?? "");
  const [releasedOn, setReleasedOn] = useState(current?.releasedOn ?? "");
  const [clearRelease, setClearRelease] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const order = callUpOn && releasedOn && releasedOn < callUpOn ? "תאריך השחרור לפני תאריך הגיוס" : null;
  const value = current
    ? { callUpOn: callUpOn || null, releasedOn: releasedOn || null }
    : { ...(callUpOn ? { callUpOn } : {}), ...(clearRelease ? { releasedOn: null } : releasedOn ? { releasedOn } : {}) };
  const empty = !current && Object.keys(value).length === 0;

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <form
        className="tz-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`תאריכי גיוס ושחרור · ${title}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!order && !empty) onSave(value);
        }}
      >
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">{title}</span>
          <button type="submit" className="tz-btn tz-btn-plain justify-self-end font-semibold" disabled={!!order || empty}>
            שמירה
          </button>
        </div>
        <p className="tz-footnote m-0 px-6 pb-3.5 text-center">
          {current ? "שדה ריק = בלי תאריך." : "שדה ריק = התאריך של כל חייל נשאר כמו שהוא."}
        </p>
        <div className="flex flex-col gap-3 px-4">
          <label className="tz-field">
            <span className="tz-label">תאריך גיוס</span>
            <input className="tz-input" type="date" value={callUpOn} onChange={(e) => setCallUpOn(e.target.value)} autoFocus />
          </label>
          <label className="tz-field">
            <span className="tz-label">תאריך שחרור (היום האחרון בדוח)</span>
            <input className="tz-input" type="date" value={releasedOn} disabled={clearRelease} onChange={(e) => setReleasedOn(e.target.value)} />
          </label>
          {!current ? (
            <label className="flex items-center gap-2 text-[15px]">
              <input type="checkbox" checked={clearRelease} onChange={(e) => setClearRelease(e.target.checked)} />
              ביטול תאריך השחרור
            </label>
          ) : null}
          {order ? (
            <p role="alert" className="tz-alert tz-alert-error m-0">
              {order}
            </p>
          ) : null}
        </div>
      </form>
    </>
  );
}
