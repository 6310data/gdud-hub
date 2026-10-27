"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { addDays, hebrewDayLabel, type Day, type SoldierRoundStats, type StatusDef, type StripCell, type StripLegend } from "@gdud/core";
import { Avatar, Icon, Serial, Spinner } from "@gdud/ui";
import { setDayStatus } from "../../../_actions/days";
import { setInReport, setServiceDates, updateSoldierDetails } from "../../../_actions/members";
import type { FieldValues } from "@/lib/doch1/soldier";
import { StatusChip } from "../../../_components/status-chip";
import { StatusSheet } from "../../../today/_components/status-sheet";
import { UndoToast } from "../../../today/_components/undo-toast";

export interface CardSoldier {
  personId: string;
  name: string;
  sub: string;
  personalNumber: string | null;
  phone: string | null;
  roleTitle: string | null;
  inReport: boolean;
  callUpOn: Day | null;
  releasedOn: Day | null;
  dmhCategory: string | null;
  arrivalOptionId: string | null;
  enlistmentOptionId: string | null;
  /** the values' names, for everyone who sees the card */
  arrivalName: string | null;
  enlistmentName: string | null;
  /** false = marked not arriving: listed on no day of the round */
  arriving: boolean;
  hasDisc: boolean | null;
  notes: string | null;
}

export interface CardToday {
  statusId: string | null;
  yesterdayId: string | null;
  location: string | null;
  team: string | null;
  /** set when the user may open the team editor */
  teamId: string | null;
  vehicle: { number: string; state: string | null } | null;
  /** data checks and why the soldier is not in today's report */
  notes: string[];
}

export interface CardLogEntry {
  key: string;
  when: string;
  actor: string | null;
  lines: string[];
}

type Undo = { message: string; run: () => Promise<{ error?: string } | undefined> };

const dm = (day: Day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const dmy = (day: Day) => `${dm(day)}.${day.slice(0, 4)}`;
/** "050-123-4567" → "972501234567" for wa.me; null when it isn't an Israeli mobile-like number */
function whatsappNumber(phone: string): string | null {
  const d = phone.replace(/\D/g, "");
  if (/^0\d{8,9}$/.test(d)) return `972${d.slice(1)}`;
  if (/^972\d{8,9}$/.test(d)) return d;
  return null;
}
const fmtCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The soldier card (mockup screen 09). */
export function SoldierCard({
  back,
  soldier,
  roundName,
  day,
  isToday,
  lockAt,
  today,
  strip,
  stats,
  log,
  statuses,
  canReport,
  locked,
  canEdit,
  values,
}: {
  back: string;
  soldier: CardSoldier;
  roundName: string;
  /** the card's day: today, or the round's last / first day outside it */
  day: Day;
  isToday: boolean;
  lockAt: string;
  today: CardToday;
  strip: { cells: StripCell[]; legend: StripLegend[]; missing: number };
  stats: SoldierRoundStats;
  log: CardLogEntry[];
  /** every status of the round (chips); the picker shows the active ones */
  statuses: StatusDef[];
  /** may set the day's status now (reports for the soldier, day open) */
  canReport: boolean;
  /** reports for the soldier, but the day is locked */
  locked: boolean;
  /** company user / admin covering the soldier: details and "לא נספר בדוח" */
  canEdit: boolean;
  /** the round's value lists and דמ״ח suggestions for the edit sheet (null = can't edit) */
  values: FieldValues | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<"status" | "edit" | null>(null);
  const [toast, setToast] = useState<Undo | null>(null);
  const [showLog, setShowLog] = useState(false);
  /** "not arriving" was picked for a soldier with reported days: what to save once the user decides */
  const [confirm, setConfirm] = useState<{ days: number; details: Details } | null>(null);

  const byId = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const active = useMemo(() => statuses.filter((s) => s.active), [statuses]);
  const status = today.statusId ? (byId.get(today.statusId) ?? null) : null;
  const yesterday = today.yesterdayId ? (byId.get(today.yesterdayId) ?? null) : null;
  const wa = soldier.phone ? whatsappNumber(soldier.phone) : null;
  const closeSheet = useCallback(() => setSheet(null), []);
  const hideToast = useCallback(() => setToast(null), []);

  function act(fn: () => Promise<{ error?: string; undo?: Undo } | undefined>, after?: () => void) {
    setError(undefined);
    start(async () => {
      const r = await fn();
      if (r?.error) setError(r.error);
      else {
        if (r?.undo) setToast(r.undo);
        after?.();
        router.refresh();
      }
    });
  }

  /** Save the edit sheet; `force` = mark "not arriving" even though the soldier has reported days. */
  const saveDetails = (d: Details, force = false) => {
    setError(undefined);
    start(async () => {
      const { callUpOn, releasedOn, ...details } = d;
      if (callUpOn !== soldier.callUpOn || releasedOn !== soldier.releasedOn) {
        const r = await setServiceDates({ personIds: [soldier.personId], callUpOn, releasedOn });
        if (r?.error) return setError(r.error);
      }
      const r = await updateSoldierDetails({ personId: soldier.personId, ...details, force });
      if (r && "confirmDays" in r) return setConfirm({ days: r.confirmDays, details: d });
      if (r?.error) return setError(r.error);
      setConfirm(null);
      setSheet(null);
      router.refresh();
    });
  };

  const pick = (statusId: string | null) => {
    setSheet(null);
    const prev = today.statusId;
    act(async () => {
      const r = await setDayStatus({ personId: soldier.personId, day, statusId });
      if (r?.error) return r;
      const label = statusId ? (byId.get(statusId)?.name ?? "") : "ללא סטטוס";
      return { undo: { message: `הסטטוס עודכן ל${label}`, run: () => setDayStatus({ personId: soldier.personId, day, statusId: prev }) } };
    });
  };

  const setReport = (inReport: boolean) => {
    setSheet(null);
    act(async () => {
      const r = await setInReport({ personId: soldier.personId, inReport });
      if (r?.error) return r;
      return {
        undo: {
          message: inReport ? "החייל חזר לדוח" : "החייל לא נספר בדוח",
          run: () => setInReport({ personId: soldier.personId, inReport: !inReport }),
        },
      };
    });
  };

  const undo = () => {
    if (!toast) return;
    const { run } = toast;
    act(async () => {
      const r = await run();
      setToast(null);
      return r?.error ? r : undefined;
    });
  };

  const actionBtn = "tz-btn min-h-16 flex-col gap-1 text-[13px] font-medium";
  const dayTitle = isToday ? `היום · ${dm(day)}` : hebrewDayLabel(day);
  const homePct = stats.homeShare === null ? null : Math.round(stats.homeShare * 100);

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col pb-20">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Link href={back} className="tz-btn tz-btn-plain justify-self-start px-0">
          <Icon name="chevron" size={17} className="rotate-180" />
          חזרה
        </Link>
        <span className="tz-headline">כרטיס חייל</span>
        <span className="flex items-center gap-2 justify-self-end">
          {pending ? <Spinner size={16} label="שומר" /> : null}
          {canEdit ? (
            <button type="button" className="tz-btn tz-btn-tinted tz-btn-sm" onClick={() => setSheet("edit")}>
              <Icon name="pencil" size={15} />
              עריכה
            </button>
          ) : null}
        </span>
      </div>

      <div className="flex flex-col items-center gap-1 px-4 pb-4 pt-3 text-center">
        <Avatar name={soldier.name} size={72} />
        <h1 className="m-0 mt-2 text-[26px] font-bold leading-8">{soldier.name}</h1>
        {soldier.sub ? <span className="tz-footnote">{soldier.sub}</span> : null}
        {soldier.personalNumber ? (
          <span className="text-ink-muted">
            <Serial>{soldier.personalNumber}</Serial>
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {soldier.phone ? (
          <a className={`${actionBtn} tz-btn-tinted`} href={`tel:${soldier.phone.replace(/[^\d+]/g, "")}`}>
            <Icon name="phone" size={22} />
            התקשרות
          </a>
        ) : (
          <button type="button" className={`${actionBtn} tz-btn-tinted`} disabled>
            <Icon name="phone" size={22} />
            אין טלפון
          </button>
        )}
        {wa ? (
          <a className={`${actionBtn} tz-btn-tinted`} href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
            <Icon name="send" size={22} />
            הודעה
          </a>
        ) : (
          <button type="button" className={`${actionBtn} tz-btn-tinted`} disabled>
            <Icon name="send" size={22} />
            הודעה
          </button>
        )}
        <button type="button" className={`${actionBtn} tz-btn-filled`} disabled={!canReport || pending} onClick={() => setSheet("status")}>
          <Icon name="pencil" size={22} />
          שינוי סטטוס
        </button>
      </div>
      {locked ? <p className="tz-footnote m-0 px-4 pt-1.5 text-center">הדוח ננעל ב-{lockAt}. רק מנהל יכול לשנות.</p> : null}

      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0 mt-3">
          {error}
        </p>
      ) : null}

      <h2 className="tz-section-header pt-[22px]">{dayTitle}</h2>
      <div className="tz-group">
        <div className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">סטטוס</span>
            {soldier.inReport ? <StatusChip status={status} /> : <span className="tz-row-value">לא נספר בדוח</span>}
          </span>
        </div>
        <div className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">אתמול</span>
            {yesterday ? <StatusChip status={yesterday} /> : <span className="tz-row-value">—</span>}
          </span>
        </div>
        <div className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">מיקום בשבצ״ק</span>
            <span className="tz-row-value">{today.location ?? "לא בשבצ״ק"}</span>
          </span>
        </div>
        {today.teamId ? (
          <Link className="tz-row" href={`/doch1/standby/${today.teamId}`}>
            <span className="tz-row-body">
              <span className="tz-row-title">כוננות</span>
              <span className="tz-row-value">{today.team}</span>
              <Icon name="chevron" size={17} className="tz-chevron" />
            </span>
          </Link>
        ) : (
          <div className="tz-row">
            <span className="tz-row-body">
              <span className="tz-row-title">כוננות</span>
              <span className="tz-row-value">{today.team ?? "לא בכוננות"}</span>
            </span>
          </div>
        )}
        {today.team ? (
          <div className="tz-row">
            <span className="tz-row-body">
              <span className="tz-row-title">רכב</span>
              <span className="tz-row-value">
                {today.vehicle ? (
                  <>
                    צ׳ <Serial>{today.vehicle.number}</Serial>
                    {today.vehicle.state ? ` · ${today.vehicle.state}` : null}
                  </>
                ) : (
                  "ללא רכב"
                )}
              </span>
            </span>
          </div>
        ) : null}
      </div>
      {today.notes.map((n) => (
        <p key={n} className="tz-footnote m-0 px-4 pt-1.5">
          {n}
        </p>
      ))}
      {canEdit ? (
        <div className="px-4 pt-1">
          <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-0" disabled={pending} onClick={() => setReport(!soldier.inReport)}>
            {soldier.inReport ? "לא נספר בדוח (שוחרר / נדחה)" : "החזרה לדוח"}
          </button>
        </div>
      ) : null}

      <h2 className="tz-section-header pt-[22px]">{strip.cells.length} הימים האחרונים</h2>
      <div className="tz-card flex flex-col gap-2.5 p-3.5">
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${strip.cells.length}, minmax(0, 1fr))` }}
          role="img"
          aria-label={[...strip.legend.map((l) => `${l.name} ${l.count}`), strip.missing ? `חסר ${strip.missing}` : null].filter(Boolean).join(", ")}
        >
          {strip.cells.map((c) => {
            const st = c.kind === "status" ? byId.get(c.statusId) : undefined;
            const style =
              c.kind === "status"
                ? { background: st?.color ?? "var(--line-strong)" }
                : c.kind === "missing"
                  ? { background: "var(--danger-soft)", boxShadow: "inset 0 0 0 1.5px var(--danger)" }
                  : { background: "var(--fill)" };
            return <span key={c.day} title={`${dm(c.day)} · ${st?.name ?? (c.kind === "missing" ? "חסר" : "לא בשירות")}`} className="h-[26px] rounded-[5px]" style={style} />;
          })}
        </div>
        <div className="flex justify-between">
          <span className="tz-footnote tz-num">{strip.cells[0] ? dm(strip.cells[0].day) : ""}</span>
          <span className="tz-footnote tz-num">{isToday ? "היום" : dm(day)}</span>
        </div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-1">
          {strip.legend.map((l) => (
            <span key={l.name} className="tz-footnote inline-flex items-center gap-[5px]">
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: l.color }} />
              {l.name} {l.count}
            </span>
          ))}
          {strip.missing ? (
            <span className="tz-footnote inline-flex items-center gap-[5px]">
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: "var(--danger-soft)", boxShadow: "inset 0 0 0 1.5px var(--danger)" }} />
              חסר {strip.missing}
            </span>
          ) : null}
        </div>
      </div>

      <h2 className="tz-section-header pt-[22px]">{roundName}</h2>
      <div className="tz-group">
        <Value title="סטטוס גיוס" value={soldier.enlistmentName} />
        <div className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">צפי הגעה</span>
            {soldier.arriving ? (
              <span className="tz-row-value">{soldier.arrivalName || "—"}</span>
            ) : (
              <span className="tz-chip tz-chip-broken">{soldier.arrivalName ?? "לא מגיע"} · לא מגיע בסבב</span>
            )}
          </span>
        </div>
        <Value title="תאריך גיוס" value={soldier.callUpOn ? dmy(soldier.callUpOn) : null} num />
        {soldier.releasedOn ? <Value title="תאריך שחרור" value={dmy(soldier.releasedOn)} num /> : null}
        <Value title="תפקיד לדמ״ח" value={soldier.dmhCategory} />
        <Value title="ימי נוכחות מיום הגיוס" value={String(stats.presenceDays)} num />
        <Value title="ימי רענון מיום הגיוס" value={String(stats.homeDays)} num />
        <div className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">אחוז בבית</span>
            <span className={`tz-row-value tz-num ${homePct !== null && homePct > 55 ? "font-semibold text-danger" : ""}`}>{homePct === null ? "—" : `${homePct}%`}</span>
          </span>
        </div>
        <Value title="רצף רענון נוכחי" value={stats.homeStreak ? `${stats.homeStreak} ימים` : "—"} />
        <Value title="סה״כ ימ״מ בסבב" value={String(stats.totalDays)} num />
        <div className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">ימי התארגנות</span>
            <span className="tz-row-value tz-num">
              נותרו {fmtCount(stats.orgRemaining)} · זכאות {stats.orgEntitled} · נוצלו {stats.orgUsed}
            </span>
          </span>
        </div>
      </div>
      <p className="tz-section-footer">נוכחות ורענון נספרים מיום הגיוס של הסבב, כמו בגיליון; ימים מתוכננים לא נספרים.</p>

      <div className="flex items-end justify-between pt-[22px]">
        <h2 className="tz-section-header">פרטים</h2>
        {canEdit ? (
          <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" onClick={() => setSheet("edit")}>
            עריכת פרטים ותאריכים
          </button>
        ) : null}
      </div>
      <div className="tz-group">
        <div className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">טלפון</span>
            <span className="tz-row-value">{soldier.phone ? <Serial>{soldier.phone}</Serial> : "—"}</span>
          </span>
        </div>
        <Value title="דיסקית" value={soldier.hasDisc === null ? null : soldier.hasDisc ? "יש" : "אין"} />
        {soldier.notes ? (
          <div className="tz-row">
            <span className="tz-row-body flex-col items-start gap-1">
              <span className="tz-row-title">הערות</span>
              <span className="tz-footnote whitespace-pre-line">{soldier.notes}</span>
            </span>
          </div>
        ) : null}
        <button type="button" className="tz-row" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)} disabled={!log.length}>
          <span className="tz-row-body">
            <span className="tz-row-title">יומן שינויים</span>
            <span className="tz-row-value">{log[0]?.when ?? "אין שינויים"}</span>
            {log.length ? <Icon name="chevron" size={17} className={`tz-chevron transition-transform ${showLog ? "-rotate-90" : ""}`} /> : null}
          </span>
        </button>
      </div>
      {showLog ? (
        <ol className="m-0 mt-2 flex list-none flex-col gap-2 p-0" aria-label="יומן שינויים">
          {log.map((e) => (
            <li key={e.key} className="tz-card flex flex-col gap-0.5 px-3.5 py-2.5">
              <span className="tz-footnote">
                {e.when}
                {e.actor ? ` · ${e.actor}` : ""}
              </span>
              {e.lines.map((l) => (
                <span key={l} className="text-[15px]">
                  {l}
                </span>
              ))}
            </li>
          ))}
        </ol>
      ) : null}

      {sheet === "status" ? (
        <StatusSheet
          name={soldier.name}
          title={isToday ? "סטטוס להיום" : `סטטוס ל${hebrewDayLabel(day)}`}
          yesterday={yesterday?.name ?? null}
          current={today.statusId}
          statuses={active}
          onPick={pick}
          onClose={closeSheet}
          onTakeOutOfReport={canEdit && soldier.inReport ? () => setReport(false) : undefined}
        />
      ) : null}
      {sheet === "edit" && values ? (
        <EditSheet
          soldier={soldier}
          values={values}
          pending={pending}
          onClose={() => {
            setConfirm(null);
            closeSheet();
          }}
          onSave={(d) => saveDetails(d)}
          confirm={
            confirm
              ? {
                  days: confirm.days,
                  // releasing from yesterday needs a call-up date on or before it
                  releaseFrom:
                    confirm.details.callUpOn && addDays(day, -1) >= confirm.details.callUpOn ? addDays(day, -1) : null,
                  onRelease: (from: Day) => saveDetails({ ...confirm.details, releasedOn: from, arrivalOptionId: soldier.arrivalOptionId }),
                  onForce: () => saveDetails(confirm.details, true),
                }
              : null
          }
        />
      ) : null}
      {toast ? <UndoToast message={toast.message} onUndo={undo} onDone={hideToast} pending={pending} /> : null}
    </div>
  );
}

function Value({ title, value, num }: { title: string; value: string | null; num?: boolean }) {
  return (
    <div className="tz-row">
      <span className="tz-row-body">
        <span className="tz-row-title">{title}</span>
        <span className={`tz-row-value ${num ? "tz-num" : ""}`}>{value || "—"}</span>
      </span>
    </div>
  );
}

type Details = {
  callUpOn: Day | null;
  releasedOn: Day | null;
  phone: string | null;
  roleTitle: string | null;
  dmhCategory: string | null;
  enlistmentOptionId: string | null;
  arrivalOptionId: string | null;
  hasDisc: boolean | null;
  notes: string | null;
};

/**
 * "עריכה": the service dates, phone, תפקיד בפועל and the round fields. צפי הגעה and סטטוס גיוס are
 * picked from the round's lists; תפקיד לדמ״ח is free text with the round's values as suggestions.
 */
function EditSheet({
  soldier,
  values,
  pending,
  onClose,
  onSave,
  confirm,
}: {
  soldier: CardSoldier;
  values: FieldValues;
  pending: boolean;
  onClose: () => void;
  onSave: (v: Details) => void;
  /** "not arriving" picked for a soldier with reported days */
  confirm: { days: number; releaseFrom: Day | null; onRelease: (from: Day) => void; onForce: () => void } | null;
}) {
  const [v, setV] = useState({
    callUpOn: soldier.callUpOn ?? "",
    releasedOn: soldier.releasedOn ?? "",
    phone: soldier.phone ?? "",
    roleTitle: soldier.roleTitle ?? "",
    dmhCategory: soldier.dmhCategory ?? "",
    enlistmentOptionId: soldier.enlistmentOptionId ?? "",
    arrivalOptionId: soldier.arrivalOptionId ?? "",
    hasDisc: soldier.hasDisc,
    notes: soldier.notes ?? "",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const order = v.callUpOn && v.releasedOn && v.releasedOn < v.callUpOn;

  const pickList = (label: string, k: "arrivalOptionId" | "enlistmentOptionId", list: FieldValues["arrival"]) => (
    <label className="tz-field">
      <span className="tz-label">{label}</span>
      <select className="tz-input" value={v[k]} onChange={set(k)}>
        <option value="">—</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.effect === "not_arriving" ? " (לא מופיע בסבב)" : ""}
          </option>
        ))}
      </select>
    </label>
  );

  const text = (label: string, k: "phone" | "roleTitle" | "dmhCategory", list?: string[]) => (
    <label className="tz-field">
      <span className="tz-label">{label}</span>
      <input
        className="tz-input"
        value={v[k]}
        onChange={set(k)}
        list={list?.length ? `soldier-${k}` : undefined}
        inputMode={k === "phone" ? "tel" : undefined}
        dir={k === "phone" ? "ltr" : undefined}
        maxLength={k === "phone" ? 20 : 60}
      />
      {list?.length ? (
        <datalist id={`soldier-${k}`}>
          {list.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
    </label>
  );

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <form
        className="tz-sheet flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={`עריכת פרטים · ${soldier.name}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!order)
            onSave({
              ...v,
              callUpOn: v.callUpOn || null,
              releasedOn: v.releasedOn || null,
              arrivalOptionId: v.arrivalOptionId || null,
              enlistmentOptionId: v.enlistmentOptionId || null,
            });
        }}
      >
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-2">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">{soldier.name}</span>
          <button type="submit" className="tz-btn tz-btn-plain justify-self-end font-semibold" disabled={pending || !!order} aria-busy={pending || undefined}>
            {pending ? <Spinner size={14} /> : null}
            שמירה
          </button>
        </div>
        <div className="flex flex-col gap-3 px-4">
          {confirm ? (
            <div role="alert" className="tz-alert tz-alert-error m-0 flex flex-col items-start gap-2">
              <span>
                לחייל יש <span className="tz-num">{confirm.days}</span> ימי דיווח בסבב. ״לא מגיע״ מסתיר אותם מכל הספירות, גם בימים שעברו. לסמן תאריך שחרור במקום?
              </span>
              <span className="flex flex-wrap gap-2">
                {confirm.releaseFrom ? (
                  <button type="button" className="tz-btn tz-btn-filled tz-btn-sm" disabled={pending} onClick={() => confirm.onRelease(confirm.releaseFrom!)}>
                    שחרור מ־{confirm.releaseFrom.slice(8, 10)}.{confirm.releaseFrom.slice(5, 7)}
                  </button>
                ) : null}
                <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" disabled={pending} onClick={confirm.onForce}>
                  לסמן לא מגיע
                </button>
              </span>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="tz-field min-w-0">
              <span className="tz-label">תאריך גיוס</span>
              <input className="tz-input min-w-0" type="date" value={v.callUpOn} onChange={set("callUpOn")} />
            </label>
            <label className="tz-field min-w-0">
              <span className="tz-label">תאריך שחרור</span>
              <input className="tz-input min-w-0" type="date" value={v.releasedOn} min={v.callUpOn || undefined} onChange={set("releasedOn")} />
            </label>
          </div>
          {order ? (
            <p role="alert" className="tz-alert tz-alert-error m-0">
              תאריך השחרור לפני תאריך הגיוס
            </p>
          ) : (
            <p className="tz-footnote m-0">החייל מופיע בדוח מתאריך הגיוס ועד תאריך השחרור (כולל). שדה ריק = בלי תאריך.</p>
          )}
          {text("טלפון", "phone")}
          {text("תפקיד בפועל", "roleTitle")}
          {text("תפקיד לדמ״ח", "dmhCategory", values.dmh)}
          {pickList("צפי הגעה", "arrivalOptionId", values.arrival)}
          {pickList("סטטוס גיוס", "enlistmentOptionId", values.enlistment)}
          <div className="tz-field">
            <span className="tz-label">דיסקית</span>
            <div className="tz-seg" role="tablist" aria-label="דיסקית">
              {(
                [
                  [true, "יש"],
                  [false, "אין"],
                  [null, "לא ידוע"],
                ] as const
              ).map(([val, label]) => (
                <button key={label} type="button" role="tab" className="tz-seg-item" aria-selected={v.hasDisc === val} onClick={() => setV((p) => ({ ...p, hasDisc: val }))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="tz-field">
            <span className="tz-label">הערות</span>
            <textarea className="tz-input min-h-20 py-2.5" value={v.notes} onChange={set("notes")} maxLength={500} />
          </label>
          <p className="tz-footnote m-0">בזמן הפיילוט הגיליון קובע: ייבוא הגיליון הבא מעדכן את הטלפון, התפקידים, סטטוס הגיוס, צפי ההגעה, הדיסקית וההערות לפי הגיליון (וגם תאריך גיוס שמופיע בו).</p>
        </div>
      </form>
    </>
  );
}
