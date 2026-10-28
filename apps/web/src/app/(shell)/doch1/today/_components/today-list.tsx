"use client";
import Link from "next/link";
import { useCallback, useMemo, useOptimistic, useState, useTransition } from "react";
import { fillFromYesterdayPlan, summarize, type Day, type DayWrite, type StatusDef } from "@gdud/core";
import { Avatar, Icon, Spinner } from "@gdud/ui";
import { bulkSetStatus, fillFromYesterday, restoreDays, setDayStatus } from "../../_actions/days";
import { setInReport } from "../../_actions/members";
import { StatusChip } from "../../_components/status-chip";
import { BulkSheet } from "./bulk-sheet";
import { StatusSheet } from "./status-sheet";
import { UndoToast } from "./undo-toast";

export interface TodayMember {
  personId: string;
  name: string;
  roleTitle: string | null;
  companyId: string;
  platoonId: string | null;
  platoonName: string | null;
  inReport: boolean;
}

/** day → personId → statusId */
export type DaysByDay = Record<Day, Record<string, string>>;

type Filter = "all" | "missing" | `group:${string}`;
/** up to this many filters fit a segmented control (mockup 07); more become scrolling pills */
const SEG_MAX = 4;

function applyWrites(state: DaysByDay, writes: readonly DayWrite[]): DaysByDay {
  const next: DaysByDay = { ...state };
  for (const w of writes) {
    const day = { ...(next[w.day] ?? {}) };
    if (w.statusId) day[w.personId] = w.statusId;
    else delete day[w.personId];
    next[w.day] = day;
  }
  return next;
}

const asMap = (d: Record<string, string> | undefined) => new Map(Object.entries(d ?? {}));

export function TodayList({
  unitId,
  unitName,
  isCompany,
  day,
  isToday,
  dayLabel,
  yesterday,
  lastDay,
  lockAt,
  canEdit,
  writable,
  canEditMembers,
  members: serverMembers,
  statuses,
  days: serverDays,
  backHref,
  soldierHref,
}: {
  unitId: string;
  unitName: string;
  isCompany: boolean;
  day: Day;
  isToday: boolean;
  dayLabel: string;
  yesterday: Day;
  /** last day the group update may reach (round end / loaded range) */
  lastDay: Day;
  lockAt: string;
  /** the user reports for this unit */
  canEdit: boolean;
  /** canEdit and the day is open for this user (lock / past days) */
  writable: boolean;
  /** may take soldiers in / out of the report (company user / admin) */
  canEditMembers: boolean;
  /** round members of the unit, ordered by platoon then name (out-of-report ones included) */
  members: TodayMember[];
  /** every status of the round, including replaced versions (for counting and chips) */
  statuses: StatusDef[];
  days: DaysByDay;
  /** this screen's address, for the soldier card's way back (default: /doch1/today) */
  backHref?: string;
  /** where a soldier opens: their card here, `${soldierHref}/${personId}` (default: the דוח 1 soldier card) */
  soldierHref?: string;
}) {
  const [days, optimistic] = useOptimistic(serverDays, applyWrites);
  const [allMembers, optimisticReport] = useOptimistic(serverMembers, (list, c: { personId: string; inReport: boolean }) =>
    list.map((m) => (m.personId === c.personId ? { ...m, inReport: c.inReport } : m)),
  );
  // released / deferred soldiers are not expected to report: out of every count
  const members = allMembers.filter((m) => m.inReport);
  const outOfReport = allMembers.filter((m) => !m.inReport);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetFor, setSheetFor] = useState<TodayMember | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo: DayWrite[] } | null>(null);

  const byId = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const active = useMemo(() => statuses.filter((s) => s.active), [statuses]);
  const groups = useMemo(() => [...new Set(active.map((s) => s.displayGroup))], [active]);

  const todayMap = asMap(days[day]);
  const summary = summarize(members, todayMap, statuses);
  const fillable = writable ? fillFromYesterdayPlan(members, todayMap, asMap(days[yesterday])).length : 0;
  const statusOf = (personId: string) => byId.get(todayMap.get(personId) ?? "") ?? null;

  const q = query.trim();
  const visible = members.filter((m) => {
    if (q && !m.name.includes(q) && !(m.roleTitle ?? "").includes(q)) return false;
    const st = statusOf(m.personId);
    if (filter === "missing") return !todayMap.has(m.personId);
    if (filter.startsWith("group:")) return st?.displayGroup === filter.slice(6);
    return true;
  });
  const sections: Array<{ key: string; name: string; items: TodayMember[] }> = [];
  for (const m of visible) {
    const key = m.platoonId ?? "company";
    let sec = sections.find((x) => x.key === key);
    if (!sec) {
      sec = { key, name: m.platoonName ?? (isCompany ? "ברמת הפלוגה" : unitName), items: [] };
      sections.push(sec);
    }
    sec.items.push(m);
  }
  const platoonRows = isCompany
    ? [...new Set(members.map((m) => m.platoonId))].map((pid) => {
        const list = members.filter((m) => m.platoonId === pid);
        const s = summarize(list, todayMap, statuses);
        return { key: pid ?? "company", name: list[0]?.platoonName ?? "ברמת הפלוגה", reported: s.reported, roster: s.roster };
      })
    : [];

  function run(writes: DayWrite[], action: () => Promise<{ error?: string } | undefined>, after?: () => void) {
    setError(undefined);
    start(async () => {
      if (writes.length) optimistic(writes);
      const r = await action();
      if (r?.error) setError(r.error);
      else after?.();
    });
  }

  function pick(m: TodayMember, statusId: string | null) {
    setSheetFor(null);
    run([{ personId: m.personId, day, statusId }], () => setDayStatus({ personId: m.personId, day, statusId }));
  }

  function setReport(m: TodayMember, inReport: boolean) {
    setSheetFor(null);
    setError(undefined);
    start(async () => {
      optimisticReport({ personId: m.personId, inReport });
      const r = await setInReport({ personId: m.personId, inReport });
      if (r?.error) setError(r.error);
    });
  }

  function fill() {
    const plan = fillFromYesterdayPlan(members, todayMap, asMap(days[yesterday]));
    run(
      plan.map((p) => ({ personId: p.personId, day, statusId: p.statusId })),
      () => fillFromYesterday({ unitId, day }),
    );
  }

  function bulk(v: { from: Day; to: Day; statusId: string }) {
    const personIds = [...selected];
    setError(undefined);
    start(async () => {
      const r = await bulkSetStatus({ personIds, ...v });
      if (r.error !== undefined) {
        setError(r.error);
        return;
      }
      setBulkOpen(false);
      setSelecting(false);
      setSelected(new Set());
      setToast({ message: `עודכנו ${r.data.written} ימים`, undo: r.data.undo });
    });
  }

  function undo() {
    if (!toast) return;
    const { undo: writes } = toast;
    setError(undefined);
    start(async () => {
      if (writes.length) {
        optimistic(writes);
        const r = await restoreDays(writes);
        if (r?.error) setError(r.error);
      }
      setToast(null);
    });
  }

  const hideToast = useCallback(() => setToast(null), [setToast]);
  const closeSheet = useCallback(() => setSheetFor(null), [setSheetFor]);
  const back = backHref ?? `/doch1/today?unit=${unitId}${isToday ? "" : `&day=${day}`}`;
  const cardHref = (personId: string) =>
    soldierHref ? `${soldierHref}/${personId}` : `/doch1/soldiers/${personId}?back=${encodeURIComponent(back)}`;
  const closeBulk = useCallback(() => setBulkOpen(false), [setBulkOpen]);

  const overwrittenFor = (list: Day[], statusId: string) => {
    let n = 0;
    for (const d of list) for (const p of selected) if (days[d]?.[p] && days[d]![p] !== statusId) n++;
    return n;
  };

  const toggle = (personId: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });

  const filters: Array<[Filter, string]> = [["all", "הכל"], ["missing", `חסרים ${summary.missing}`], ...groups.map((g) => [`group:${g}`, g] as [Filter, string])];
  const lockNote = `הדוח ננעל ב-${lockAt}${outOfReport.length ? ` · ${outOfReport.length} שוחררו או נדחו ואינם נספרים` : ""}`;
  const done = summary.missing === 0 && summary.roster > 0;
  const pct = Math.round(summary.completion * 100);

  return (
    <div className="flex flex-col gap-3.5 pb-16">
      <div className="tz-card flex flex-col gap-2.5 p-3.5">
        {done ? (
          <div className="flex items-center gap-3">
            <span className="grid size-9 flex-none place-items-center rounded-full text-white" style={{ background: "var(--tile-ok)" }}>
              <Icon name="check" size={18} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[17px] font-semibold">
                {summary.roster} מתוך {summary.roster} דיווחו · הדוח מוכן
              </span>
              <span className="tz-footnote">{lockNote}</span>
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[17px] font-semibold">
                <span className="tz-num">{summary.reported}</span> מתוך <span className="tz-num">{summary.roster}</span> דיווחו
              </span>
              {summary.missing ? (
                <span className="tz-chip" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                  {summary.missing} חסרים
                </span>
              ) : null}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-fill" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="השלמת הדיווח">
              <div className="h-1.5 rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
            <span className="tz-footnote">{lockNote}</span>
            {fillable ? (
              <button type="button" className="tz-btn tz-btn-tinted min-h-11 text-base" disabled={pending} aria-busy={pending || undefined} onClick={fill}>
                {pending ? <Spinner /> : null}
                השלמת {fillable} חסרים לפי אתמול
              </button>
            ) : null}
          </>
        )}
      </div>

      {canEdit && !writable ? (
        <p className="tz-alert m-0" style={{ background: "var(--status-broken-soft)", color: "var(--status-broken)" }}>
          {isToday ? `היום ננעל ב-${lockAt}. רק מנהל גדודי יכול לשנות.` : "יום שעבר. רק מנהל גדודי יכול לשנות."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}

      {platoonRows.length > 1 ? (
        <div className="tz-group">
          {platoonRows.map((p) => (
            <div key={p.key} className="tz-row">
              <span className="tz-row-body">
                <span className="tz-row-title">{p.name}</span>
                <span className={`tz-num text-[15px] ${p.reported < p.roster ? "text-danger" : "text-ok"}`}>
                  {p.reported}/{p.roster}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <label className="tz-search flex-1">
            <Icon name="search" size={15} />
            <input type="search" placeholder="חיפוש חייל או תפקיד" aria-label="חיפוש חייל או תפקיד" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {writable ? (
            <button
              type="button"
              className="tz-btn tz-btn-plain"
              aria-pressed={selecting}
              onClick={() => {
                setSelecting((s) => !s);
                setSelected(new Set());
              }}
            >
              {selecting ? "סיום" : "בחירה"}
            </button>
          ) : null}
        </div>
        {filters.length <= SEG_MAX ? (
          <div className="tz-seg" role="tablist" aria-label="סינון">
            {filters.map(([id, label]) => (
              <button key={id} type="button" role="tab" className="tz-seg-item" aria-selected={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="tz-pills" role="toolbar" aria-label="סינון">
            {filters.map(([id, label]) => (
              <button key={id} type="button" className="tz-pill" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {sections.map((sec) => (
        <section key={sec.key} className="flex flex-col">
          <h2 className="tz-section-header pt-2">{sec.name}</h2>
          <div className="tz-group">
            {sec.items.map((m) => {
              const body = (
                <>
                  {selecting ? (
                    <input type="checkbox" className="self-center" checked={selected.has(m.personId)} readOnly tabIndex={-1} aria-hidden="true" />
                  ) : null}
                  <Avatar name={m.name} />
                  <span className="tz-row-body">
                    <span className="tz-row-title">
                      {m.name}
                      {m.roleTitle ? <span className="tz-row-sub">{m.roleTitle}</span> : null}
                    </span>
                    <StatusChip status={statusOf(m.personId)} />
                    {!selecting ? <Icon name="chevron" size={17} className="tz-chevron" /> : null}
                  </span>
                </>
              );
              return writable ? (
                <button
                  key={m.personId}
                  type="button"
                  className="tz-row"
                  aria-pressed={selecting ? selected.has(m.personId) : undefined}
                  onClick={() => (selecting ? toggle(m.personId) : setSheetFor(m))}
                >
                  {body}
                </button>
              ) : (
                <Link key={m.personId} href={cardHref(m.personId)} className="tz-row">
                  {body}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      {!visible.length ? <p className="tz-footnote m-0 text-center">{members.length ? "אין חיילים בסינון הזה." : "אין חיילים בדוח של המסגרת."}</p> : null}

      {outOfReport.length && !selecting ? (
        <section className="flex flex-col">
          <h2 className="tz-section-header pt-2">לא נספרים בדוח (שוחררו / נדחו) · {outOfReport.length}</h2>
          <div className="tz-group">
            {outOfReport.map((m) => (
              <div key={m.personId} className="tz-row opacity-75">
                <Avatar name={m.name} />
                <span className="tz-row-body">
                  <span className="tz-row-title">
                    {m.name}
                    {m.platoonName ? <span className="tz-row-sub">{m.platoonName}</span> : null}
                  </span>
                  {canEditMembers ? (
                    <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" disabled={pending} aria-busy={pending || undefined} onClick={() => setReport(m, true)}>
                      {pending ? <Spinner size={14} /> : null}
                      החזרה לדוח
                    </button>
                  ) : (
                    <span className="tz-chip tz-chip-signed">לא בדוח</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {selecting ? (
        <div className="tz-action-bar lg:sticky lg:bottom-4 lg:rounded-group">
          <span className="text-[15px] font-semibold">{selected.size} נבחרו</span>
          <button
            type="button"
            className="tz-btn tz-btn-plain tz-btn-sm"
            onClick={() => setSelected(new Set(selected.size === visible.length ? [] : visible.map((m) => m.personId)))}
          >
            {selected.size === visible.length ? "ניקוי" : "בחירת כל המוצגים"}
          </button>
          <button type="button" className="tz-btn tz-btn-filled tz-btn-sm ms-auto" disabled={!selected.size} onClick={() => setBulkOpen(true)}>
            עדכון
          </button>
        </div>
      ) : null}

      {sheetFor ? (
        <StatusSheet
          name={sheetFor.name}
          title={isToday ? "סטטוס להיום" : `סטטוס ל${dayLabel}`}
          yesterday={byId.get(days[yesterday]?.[sheetFor.personId] ?? "")?.name ?? null}
          current={todayMap.get(sheetFor.personId) ?? null}
          statuses={active}
          onPick={(id) => pick(sheetFor, id)}
          onClose={closeSheet}
          onTakeOutOfReport={canEditMembers ? () => setReport(sheetFor, false) : undefined}
          cardHref={cardHref(sheetFor.personId)}
        />
      ) : null}
      {bulkOpen ? (
        <BulkSheet
          count={selected.size}
          day={day}
          lastDay={lastDay}
          statuses={active}
          overwrittenFor={overwrittenFor}
          pending={pending}
          onSubmit={bulk}
          onClose={closeBulk}
        />
      ) : null}
      {toast ? <UndoToast message={toast.message} onUndo={undo} onDone={hideToast} pending={pending} /> : null}
    </div>
  );
}
