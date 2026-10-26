"use client";
import Link from "next/link";
import { useCallback, useMemo, useOptimistic, useState, useTransition } from "react";
import { addDays, fillFromYesterdayPlan, hebrewDayLabel, inService, inServiceBetween, summarize, type Day, type DayWrite, type StatusDef } from "@gdud/core";
import { Avatar, Button, Icon } from "@gdud/ui";
import { bulkSetStatus, fillFromYesterday, restoreDays, setDayStatus } from "../../_actions/days";
import { StatusDot } from "../../_components/status-chip";
import { BulkSheet } from "../../today/_components/bulk-sheet";
import { StatusSheet } from "../../today/_components/status-sheet";
import { UndoToast } from "../../today/_components/undo-toast";

export interface BoardMember {
  personId: string;
  name: string;
  roleTitle: string | null;
  companyId: string;
  platoonId: string | null;
  platoonName: string | null;
  inReport: boolean;
  callUpOn: Day | null;
  releasedOn: Day | null;
}

/** day → personId → statusId */
export type DaysByDay = Record<Day, Record<string, string>>;

type Busy = "fill" | "bulk" | "undo" | "cell" | null;

const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const weekday = (day: Day) => WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]!;
const dm = (day: Day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const COMPANY_LEVEL = "ברמת הפלוגה";

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

/** Status colors come from settings: dark text on a light color, white on a dark one. */
function inkOn(color: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return "var(--on-primary)";
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.62 ? "var(--ink)" : "var(--on-primary)";
}

/** Two letters of the status name for a cell; the full name is in its label. */
const short = (name: string) => name.replace(/["׳״']/g, "").slice(0, 2);

export function BoardGrid({
  unitId,
  unitName,
  shown,
  today,
  yesterday,
  tomorrow,
  roundStart,
  roundEnd,
  lockAt,
  isAdmin,
  canEdit,
  todayOpen,
  bulkFrom,
  members: allMembers,
  statuses,
  days: serverDays,
  nav,
}: {
  unitId: string;
  unitName: string;
  /** the board's days, in order */
  shown: Day[];
  today: Day;
  yesterday: Day;
  tomorrow: Day;
  roundStart: Day;
  roundEnd: Day;
  lockAt: string;
  isAdmin: boolean;
  /** the user reports for this company */
  canEdit: boolean;
  /** today is still open for this user (lock time) */
  todayOpen: boolean;
  /** first day the group update may write, or null when it can't */
  bulkFrom: Day | null;
  /** round members of the company, ordered by platoon then name */
  members: BoardMember[];
  /** every status of the round, including replaced versions (for counting and cells) */
  statuses: StatusDef[];
  /** the shown days plus yesterday, today and tomorrow */
  days: DaysByDay;
  nav: { prev: string | null; next: string | null; today: string | null };
}) {
  const [days, optimistic] = useOptimistic(serverDays, applyWrites);
  // released / deferred soldiers are not expected to report: off the board and out of every count
  const reporting = allMembers.filter((m) => m.inReport);
  const outOfReport = allMembers.length - reporting.length;
  // today's counts: soldiers listed today; rows: soldiers listed on any shown day (other days are blank)
  const members = reporting.filter((m) => inService(m, today));
  const rows = reporting.filter((m) => inServiceBetween(m, shown[0]!, shown[shown.length - 1]!));
  const tomorrowMembers = reporting.filter((m) => inService(m, tomorrow));
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [platoon, setPlatoon] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [cellFor, setCellFor] = useState<{ member: BoardMember; day: Day } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo: DayWrite[] } | null>(null);

  const byId = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const active = useMemo(() => statuses.filter((s) => s.active), [statuses]);
  const cardHref = (personId: string) => `/doch1/soldiers/${personId}?back=${encodeURIComponent(`/doch1/board?unit=${unitId}&from=${shown[0]}`)}`;

  const inRound = (d: Day) => d >= roundStart && d <= roundEnd;
  const writableDay = (d: Day) => canEdit && inRound(d) && (isAdmin || d > today || (d === today && todayOpen));

  const todayMap = asMap(days[today]);
  const tomorrowMap = asMap(days[tomorrow]);
  const summary = summarize(members, todayMap, statuses);
  const fillPlan = canEdit && todayOpen && inRound(today) ? fillFromYesterdayPlan(members, todayMap, asMap(days[yesterday])) : [];

  const platoons: Array<{ key: string; name: string; count: number }> = [];
  for (const m of rows) {
    const key = m.platoonId ?? "company";
    const p = platoons.find((x) => x.key === key);
    if (p) p.count++;
    else platoons.push({ key, name: m.platoonName ?? COMPANY_LEVEL, count: 1 });
  }

  const q = query.trim();
  const visible = rows.filter(
    (m) => (!platoon || (m.platoonId ?? "company") === platoon) && (!q || m.name.includes(q) || (m.roleTitle ?? "").includes(q)),
  );
  const allSelected = visible.length > 0 && visible.every((m) => selected.has(m.personId));

  // the statuses that appear on the board, for the legend
  const legend = useMemo(() => {
    const used = new Set<string>();
    for (const d of shown) for (const id of Object.values(days[d] ?? {})) used.add(id);
    return statuses.filter((s) => used.has(s.id));
  }, [shown, days, statuses]);

  const isHome = (id: string | undefined) => !!id && !!byId.get(id)?.homeDay;
  const leaving = tomorrowMembers.filter((m) => todayMap.has(m.personId) && !isHome(todayMap.get(m.personId)) && isHome(tomorrowMap.get(m.personId))).length;
  const returning = tomorrowMembers.filter((m) => isHome(todayMap.get(m.personId)) && tomorrowMap.has(m.personId) && !isHome(tomorrowMap.get(m.personId))).length;
  const unplanned = tomorrowMembers.filter((m) => !tomorrowMap.has(m.personId)).length;

  function run(kind: Busy, writes: DayWrite[], action: () => Promise<{ error?: string } | undefined>) {
    setError(undefined);
    setBusy(kind);
    start(async () => {
      if (writes.length) optimistic(writes);
      const r = await action();
      if (r?.error) setError(r.error);
    });
  }

  function pick(member: BoardMember, day: Day, statusId: string | null) {
    setCellFor(null);
    run("cell", [{ personId: member.personId, day, statusId }], () => setDayStatus({ personId: member.personId, day, statusId }));
  }

  function fill() {
    run(
      "fill",
      fillPlan.map((p) => ({ personId: p.personId, day: today, statusId: p.statusId })),
      () => fillFromYesterday({ unitId, day: today }),
    );
  }

  function bulk(v: { from: Day; to: Day; statusId: string }) {
    const personIds = [...selected];
    setError(undefined);
    setBusy("bulk");
    start(async () => {
      const r = await bulkSetStatus({ personIds, ...v });
      if (r.error !== undefined) {
        setError(r.error);
        return;
      }
      setBulkOpen(false);
      setSelected(new Set());
      setToast({ message: `עודכנו ${r.data.written} ימים`, undo: r.data.undo });
    });
  }

  function undo() {
    if (!toast) return;
    const { undo: writes } = toast;
    setError(undefined);
    setBusy("undo");
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
  const closeCell = useCallback(() => setCellFor(null), [setCellFor]);
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

  const bulkNames: readonly [string, string] | undefined =
    bulkFrom === today ? ["היום", "מחר"] : bulkFrom === tomorrow ? ["מחר", "מחרתיים"] : bulkFrom ? [dm(bulkFrom), dm(addDays(bulkFrom, 1))] : undefined;

  return (
    <div className="flex flex-col gap-[18px] pb-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="tz-large-title">{unitName} · לוח נוכחות</h1>
          <span className="tz-footnote">
            <span className="tz-num">{summary.roster}</span> ברשימה · <span className="tz-num">{summary.inSadak}</span> בסד״כ היום ·{" "}
            <span className="tz-num">{summary.missing}</span> חסרי דיווח · הימים שאחרי היום הם תכנון
            {outOfReport ? ` · ${outOfReport} שוחררו או נדחו ואינם מוצגים` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {fillPlan.length ? (
            <Button variant="tinted" className="min-h-10 text-[15px]" loading={pending && busy === "fill"} disabled={pending} onClick={fill}>
              השלמת חסרים מאתמול · {fillPlan.length}
            </Button>
          ) : null}
          <Link href={`/doch1/today?unit=${unitId}`} className="tz-btn tz-btn-filled min-h-10 text-[15px]">
            דוח 1 של היום
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="tz-search min-w-[200px] flex-[0_1_280px]">
          <Icon name="search" size={15} />
          <input type="search" placeholder="שם או תפקיד" aria-label="חיפוש חייל" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {platoons.length > 1 ? (
          <div className="tz-pills" role="toolbar" aria-label="מחלקה">
            <button type="button" className="tz-pill" aria-pressed={platoon === null} onClick={() => setPlatoon(null)}>
              הכל <span className="tz-pill-count tz-num">{rows.length}</span>
            </button>
            {platoons.map((p) => (
              <button key={p.key} type="button" className="tz-pill" aria-pressed={platoon === p.key} onClick={() => setPlatoon(p.key)}>
                {p.name} <span className="tz-pill-count tz-num">{p.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        <span className="flex-1" />
        <nav className="flex items-center gap-1" aria-label="שבוע">
          {nav.prev ? (
            <Link href={nav.prev} className="tz-btn tz-btn-plain tz-btn-sm">
              שבוע קודם
            </Link>
          ) : null}
          {nav.today ? (
            <Link href={nav.today} className="tz-btn tz-btn-plain tz-btn-sm">
              היום
            </Link>
          ) : null}
          {nav.next ? (
            <Link href={nav.next} className="tz-btn tz-btn-plain tz-btn-sm">
              שבוע הבא
            </Link>
          ) : null}
        </nav>
      </div>

      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5" aria-label="מקרא">
        {legend.map((s) => (
          <span key={s.id} className="tz-footnote inline-flex items-center gap-1.5">
            <StatusDot color={s.color} size={10} />
            {s.name}
          </span>
        ))}
        <span className="tz-footnote inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: "var(--danger-soft)", boxShadow: "inset 0 0 0 1.5px var(--danger)" }} />
          חסר דיווח
        </span>
      </div>

      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
      {canEdit && !todayOpen && inRound(today) ? (
        <p className="tz-alert m-0" style={{ background: "var(--status-broken-soft)", color: "var(--status-broken)" }}>
          היום ננעל ב-{lockAt}. אפשר לתכנן את הימים הבאים; רק מנהל גדודי משנה את היום.
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-[18px]">
        <section className="tz-group relative min-w-0 flex-[999_1_760px] overflow-visible" aria-label="לוח נוכחות">
          <div className="overflow-x-auto rounded-group">
            <table className="tz-board">
              <thead>
                <tr>
                  <th className="tz-board-check">
                    {canEdit && visible.length ? (
                      <input
                        type="checkbox"
                        aria-label={allSelected ? "ניקוי הבחירה" : "בחירת כל המוצגים"}
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((m) => m.personId)))}
                      />
                    ) : (
                      <span className="sr-only">בחירה</span>
                    )}
                  </th>
                  <th className="tz-board-name">חייל</th>
                  {shown.map((d) => (
                    <th key={d} className="tz-board-day" aria-current={d === today ? "date" : undefined} data-plan={d > today || undefined}>
                      <span>
                        <span className="text-[11px]">{weekday(d)}</span>
                        <span className="tz-num text-[13px] font-semibold">{dm(d)}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => {
                  const on = selected.has(m.personId);
                  return (
                    <tr key={m.personId} data-selected={on || undefined}>
                      <td className="tz-board-check">
                        {canEdit ? <input type="checkbox" aria-label={`בחירת ${m.name}`} checked={on} onChange={() => toggle(m.personId)} /> : null}
                      </td>
                      <td className="tz-board-name">
                        <Link href={cardHref(m.personId)} className="flex items-center gap-2.5 text-ink no-underline">
                          <Avatar name={m.name} size={32} />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-[15px] font-medium">{m.name}</span>
                            <span className="tz-footnote truncate">
                              {m.platoonName ?? COMPANY_LEVEL}
                              {m.roleTitle ? ` · ${m.roleTitle}` : ""}
                            </span>
                          </span>
                        </Link>
                      </td>
                      {shown.map((d) => {
                        if (!inService(m, d)) {
                          const off = `${m.name} · ${hebrewDayLabel(d)}: ${m.callUpOn && d < m.callUpOn ? "לפני הגיוס" : "אחרי השחרור"}`;
                          return (
                            <td key={d}>
                              <span className="tz-cell tz-cell-plan" aria-label={off} title={off} role="img" />
                            </td>
                          );
                        }
                        const st = byId.get(days[d]?.[m.personId] ?? "");
                        const missing = !st && d <= today;
                        const cls = `tz-cell${d > today ? " tz-cell-plan" : ""}${d === today ? " tz-cell-today" : ""}${missing ? " tz-cell-missing" : ""}`;
                        const style = st ? { background: st.color, color: inkOn(st.color) } : undefined;
                        const text = st ? short(st.name) : missing ? "?" : "";
                        const label = `${m.name} · ${hebrewDayLabel(d)}: ${st ? st.name : missing ? "חסר דיווח" : "לא מתוכנן"}`;
                        return (
                          <td key={d}>
                            {writableDay(d) ? (
                              <button type="button" className={cls} style={style} aria-label={label} title={label} onClick={() => setCellFor({ member: m, day: d })}>
                                {text}
                              </button>
                            ) : (
                              <span className={cls} style={style} aria-label={label} title={label} role="img">
                                {text}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {!visible.length ? (
                  <tr>
                    <td colSpan={shown.length + 2} className="tz-footnote py-6 text-center">
                      {rows.length ? "אין חיילים בסינון הזה." : "אין חיילים בדוח של הפלוגה."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr>
                  <td className="tz-board-check" />
                  <td className="tz-board-name tz-footnote">בסד״כ מתוך המוצגים</td>
                  {shown.map((d) => (
                    <td key={d} className="tz-num text-center text-[13px]" style={{ color: d === today ? "var(--primary)" : "var(--ink-muted)" }}>
                      {visible.filter((m) => inService(m, d) && byId.get(days[d]?.[m.personId] ?? "")?.countsInSadak).length}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          {selected.size ? (
            <div className="tz-action-bar flex-wrap lg:sticky lg:bottom-3 lg:m-3 lg:rounded-group lg:shadow-[0_8px_24px_#0f1b2d29]">
              <span className="text-[15px] font-semibold">{selected.size} נבחרו</span>
              <span className="tz-footnote max-sm:hidden">בחרו ימים וסטטוס — אפשר גם לתכנן קדימה</span>
              <span className="flex-1" />
              <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" onClick={() => setSelected(new Set())}>
                ביטול
              </button>
              <Button small disabled={!bulkFrom} loading={pending && busy === "bulk"} onClick={() => setBulkOpen(true)}>
                עדכון {selected.size} חיילים
              </Button>
            </div>
          ) : null}
        </section>

        <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
          {inRound(today) ? (
            <>
              <h2 className="tz-section-header">היום · {unitName}</h2>
              <div className="tz-group">
                {summary.groups.map((g) => (
                  <div key={g.name} className="tz-row">
                    <span className="tz-tile" style={{ background: g.color }} />
                    <span className="tz-row-body">
                      <span className="tz-row-title">{g.name}</span>
                      <span className="tz-row-value tz-num">{g.count}</span>
                    </span>
                  </div>
                ))}
                {summary.reported - summary.inSadak > 0 ? (
                  <div className="tz-row">
                    <span className="tz-tile" style={{ background: "var(--tile-neutral)" }} />
                    <span className="tz-row-body">
                      <span className="tz-row-title">לא בסד״כ</span>
                      <span className="tz-row-value tz-num">{summary.reported - summary.inSadak}</span>
                    </span>
                  </div>
                ) : null}
                <div className="tz-row">
                  <span className="tz-tile" style={{ background: "var(--tile-document)" }}>
                    <Icon name="alert" size={17} />
                  </span>
                  <span className="tz-row-body">
                    <span className="tz-row-title">חסרי דיווח</span>
                    <span className={`tz-row-value tz-num ${summary.missing ? "font-semibold text-danger" : ""}`}>{summary.missing}</span>
                  </span>
                </div>
              </div>
            </>
          ) : null}
          {inRound(tomorrow) ? (
            <>
              <h2 className="tz-section-header pt-4">מחר · {dm(tomorrow)}</h2>
              <div className="tz-group">
                <div className="tz-row">
                  <span className="tz-row-body">
                    <span className="tz-row-title">
                      יוצאים לרענון<span className="tz-row-sub">היום בפעילות, מחר בבית</span>
                    </span>
                    <span className="tz-row-value tz-num">{leaving}</span>
                  </span>
                </div>
                <div className="tz-row">
                  <span className="tz-row-body">
                    <span className="tz-row-title">
                      חוזרים מרענון<span className="tz-row-sub">היום בבית, מחר בפעילות</span>
                    </span>
                    <span className="tz-row-value tz-num">{returning}</span>
                  </span>
                </div>
                <div className="tz-row">
                  <span className="tz-row-body">
                    <span className="tz-row-title">לא מתוכננים</span>
                    <span className={`tz-row-value tz-num ${unplanned ? "text-danger" : ""}`}>{unplanned}</span>
                  </span>
                </div>
              </div>
            </>
          ) : null}
          <p className="tz-section-footer">״היום״ ו״מחר״ מתייחסים לכל הפלוגה. ״מחר״ מחושב מהתכנון בלוח.</p>
        </aside>
      </div>

      {cellFor ? (
        <StatusSheet
          name={cellFor.member.name}
          title={cellFor.day === today ? "סטטוס להיום" : `סטטוס ל${hebrewDayLabel(cellFor.day)}`}
          yesterday={byId.get(days[addDays(cellFor.day, -1)]?.[cellFor.member.personId] ?? "")?.name ?? null}
          current={days[cellFor.day]?.[cellFor.member.personId] ?? null}
          statuses={active}
          onPick={(id) => pick(cellFor.member, cellFor.day, id)}
          onClose={closeCell}
        />
      ) : null}
      {bulkOpen && bulkFrom ? (
        <BulkSheet
          count={selected.size}
          day={bulkFrom}
          dayNames={bulkNames}
          lastDay={roundEnd}
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
