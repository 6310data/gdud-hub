"use client";
import { Fragment, useCallback, useOptimistic, useState, useTransition } from "react";
import { addDays, type Day } from "@gdud/core";
import type { FieldOptionVM } from "@/lib/doch1/data";
import { EFFECT_CHIP, fmtDay } from "@/lib/doch1/format";
import { setEnlistment } from "../../_actions/members";
import { UndoToast } from "../../today/_components/undo-toast";

export interface CallUpRow {
  personId: string;
  name: string;
  sub: string;
  enlistmentOptionId: string | null;
  callUpOn: Day | null;
  releasedOn: Day | null;
  editable: boolean;
}

type Filter = "all" | "pending" | "arrived" | "postponed" | "released";
type Change = { personId: string; optionId: string | null; callUpOn?: Day | null; releasedOn?: Day | null };
type Undo = { message: string; run: () => Promise<{ error?: string } | undefined> };

/** סטטוס גיוס of one company's soldiers on the call-up day. נדחה asks for the new call-up date, שוחרר for the release date. */
export function CallUpList({ rows: serverRows, options, day }: { rows: CallUpRow[]; options: FieldOptionVM[]; day: Day }) {
  const [rows, optimistic] = useOptimistic(serverRows, (list, c: Change) =>
    list.map((m) =>
      m.personId !== c.personId
        ? m
        : {
            ...m,
            enlistmentOptionId: c.optionId,
            ...(c.callUpOn !== undefined ? { callUpOn: c.callUpOn } : {}),
            ...(c.releasedOn !== undefined ? { releasedOn: c.releasedOn } : {}),
          },
    ),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>("all");
  /** a נדחה / שוחרר value waiting for its date */
  const [asking, setAsking] = useState<{ personId: string; option: FieldOptionVM; date: Day } | null>(null);
  const [toast, setToast] = useState<Undo | null>(null);
  const hideToast = useCallback(() => setToast(null), []);

  const byId = new Map(options.map((o) => [o.id, o]));
  const effectOf = (m: CallUpRow) => (m.enlistmentOptionId ? byId.get(m.enlistmentOptionId)?.effect : undefined);
  const FILTERS: Array<[Filter, string, (m: CallUpRow) => boolean]> = [
    ["all", "הכל", () => true],
    ["pending", "טרם התייצבו", (m) => !effectOf(m) || effectOf(m) === "pending"],
    ["arrived", "התייצבו", (m) => effectOf(m) === "arrived"],
    ["postponed", "נדחו", (m) => effectOf(m) === "postponed"],
    ["released", "שוחררו", (m) => effectOf(m) === "released"],
  ];
  const test = FILTERS.find(([id]) => id === filter)![2];
  const visible = rows.filter(test);

  function save(m: CallUpRow, option: FieldOptionVM | null, date?: Day) {
    setAsking(null);
    setError(undefined);
    const was = effectOf(m);
    const change: Change = { personId: m.personId, optionId: option?.id ?? null };
    if (option?.effect === "postponed") change.callUpOn = date!;
    if (option?.effect === "released") change.releasedOn = date!;
    // leaving שוחרר: the release date came with it
    else if (was === "released") change.releasedOn = null;
    const back: Change = { personId: m.personId, optionId: m.enlistmentOptionId, callUpOn: m.callUpOn, releasedOn: m.releasedOn };
    start(async () => {
      optimistic(change);
      const r = await setEnlistment(change);
      if (r?.error) return setError(r.error);
      setToast({ message: `${m.name}: ${option?.name ?? "ללא סטטוס גיוס"}`, run: () => setEnlistment(back) });
    });
  }

  function pick(m: CallUpRow, o: FieldOptionVM) {
    if (m.enlistmentOptionId === o.id) return save(m, null);
    if (o.effect === "postponed") return setAsking({ personId: m.personId, option: o, date: addDays(m.callUpOn && m.callUpOn > day ? m.callUpOn : day, 1) });
    if (o.effect === "released") return setAsking({ personId: m.personId, option: o, date: day });
    save(m, o);
  }

  function undo() {
    if (!toast) return;
    const run = toast.run;
    start(async () => {
      const r = await run();
      if (r?.error) setError(r.error);
      setToast(null);
    });
  }

  const chips = (m: CallUpRow) => (
    <span className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = m.enlistmentOptionId === o.id;
        return (
          <button
            key={o.id}
            type="button"
            className={`tz-chip ${on ? EFFECT_CHIP[o.effect] : "bg-fill text-ink-muted before:hidden"}`}
            aria-pressed={on}
            disabled={!m.editable || pending}
            onClick={() => pick(m, o)}
          >
            {o.name}
          </button>
        );
      })}
    </span>
  );

  /** the date a נדחה / שוחרר value waits for */
  const askRow = (m: CallUpRow) => {
    const ask = asking?.personId === m.personId ? asking : null;
    if (!ask) return null;
    const label = ask.option.effect === "postponed" ? "תאריך גיוס חדש" : "תאריך שחרור";
    return (
      <span className="flex flex-wrap items-center gap-2 text-[14px]">
        <span>{label}</span>
        <input
          type="date"
          className="tz-input min-h-8 w-[150px] py-0"
          value={ask.date}
          min={ask.option.effect === "released" ? (m.callUpOn ?? undefined) : undefined}
          onChange={(e) => setAsking({ ...ask, date: e.target.value })}
          aria-label={label}
        />
        <button type="button" className="tz-btn tz-btn-filled tz-btn-sm" disabled={!ask.date || pending} onClick={() => save(m, ask.option, ask.date)}>
          {ask.option.name}
        </button>
        <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" onClick={() => setAsking(null)}>
          ביטול
        </button>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-3 pb-16">
      <div className="tz-pills" role="toolbar" aria-label="סינון">
        {FILTERS.map(([id, label, t]) => (
          <button key={id} type="button" className="tz-pill" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
            <span className="tz-pill-count tz-num">{rows.filter(t).length}</span>
          </button>
        ))}
      </div>
      {!options.length ? (
        <p className="tz-alert m-0">אין ערכים לסטטוס גיוס בסבב. מנהל גדודי מגדיר אותם בהגדרות › צפי הגעה וסטטוס גיוס.</p>
      ) : null}
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
      {/* phone: a row per soldier, the values as chips under the name */}
      <div className="tz-group md:hidden">
        {visible.map((m) => (
          <div key={m.personId} className="tz-row flex-col items-stretch gap-2 py-2.5">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{m.name}</span>
              <span className="tz-footnote">{m.sub}</span>
              {m.callUpOn && m.callUpOn > day ? (
                <span className="tz-footnote">
                  גיוס <span className="tz-num">{fmtDay(m.callUpOn)}</span>
                </span>
              ) : null}
              {m.releasedOn ? (
                <span className="tz-footnote">
                  שחרור <span className="tz-num">{fmtDay(m.releasedOn)}</span>
                </span>
              ) : null}
            </span>
            {chips(m)}
            {askRow(m)}
          </div>
        ))}
        {!visible.length ? <p className="tz-footnote m-0 p-4 text-center">אין חיילים בסינון הזה.</p> : null}
      </div>
      {/* desktop: a table, a column per value */}
      <div className="tz-table-wrap max-md:hidden">
        <table className="tz-table">
          <thead>
            <tr>
              <th>שם</th>
              <th>מחלקה · תפקיד</th>
              <th>גיוס</th>
              <th>שחרור</th>
              {options.map((o) => (
                <th key={o.id} className="text-center">
                  {o.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => {
              const ask = askRow(m);
              return (
                <Fragment key={m.personId}>
                  <tr className="tz-hover">
                    <th scope="row" className="font-semibold">
                      {m.name}
                    </th>
                    <td className="text-ink-muted">{m.sub || "—"}</td>
                    <td className="tz-num">{m.callUpOn ? fmtDay(m.callUpOn) : "—"}</td>
                    <td className="tz-num">{m.releasedOn ? fmtDay(m.releasedOn) : "—"}</td>
                    {options.map((o) => {
                      const on = m.enlistmentOptionId === o.id;
                      return (
                        <td key={o.id} className="text-center">
                          <input
                            type="radio"
                            name={`enlistment-${m.personId}`}
                            className="cursor-pointer disabled:cursor-default"
                            checked={on}
                            disabled={!m.editable || pending}
                            onChange={() => pick(m, o)}
                            onClick={() => on && pick(m, o)}
                            aria-label={`${m.name}: ${o.name}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                  {ask ? (
                    <tr>
                      <td colSpan={4 + options.length}>{ask}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!visible.length ? (
              <tr>
                <td colSpan={4 + options.length} className="tz-footnote text-center">
                  אין חיילים בסינון הזה.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {toast ? <UndoToast message={toast.message} onUndo={undo} onDone={hideToast} pending={pending} /> : null}
    </div>
  );
}
