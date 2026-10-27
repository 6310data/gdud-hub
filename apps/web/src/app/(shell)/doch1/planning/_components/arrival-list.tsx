"use client";
import { useCallback, useOptimistic, useState, useTransition } from "react";
import type { Day } from "@gdud/core";
import { EFFECT_CHIP } from "@/lib/doch1/format";
import type { FieldOptionVM } from "@/lib/doch1/data";
import { setArrival, setPlanningCallUp } from "../../_actions/planning";
import { UndoToast } from "../../today/_components/undo-toast";

export interface ArrivalRow {
  personId: string;
  name: string;
  /** "מחלקה 1 · נהג" */
  sub: string;
  platoonName: string | null;
  /** the company the soldier leaves (a move that waits for the activation) */
  movedFrom: string | null;
  arrivalOptionId: string | null;
  callUpOn: Day | null;
  editable: boolean;
}

type Filter = "all" | "blank" | "arriving" | "not-arriving";
type Change = Array<{ personId: string; optionId: string | null }>;
type Undo = { message: string; run: () => Promise<{ error?: string } | undefined> };

/** צפי הגעה of one company's soldiers in the round being planned (phone-first, like the today screen). */
export function ArrivalList({
  rows: serverRows,
  options,
  round,
}: {
  rows: ArrivalRow[];
  /** the planning round's צפי הגעה values, in order */
  options: FieldOptionVM[];
  round: { startsOn: Day; endsOn: Day };
}) {
  const [rows, optimistic] = useOptimistic(serverRows, (list, c: Change) =>
    list.map((m) => {
      const x = c.find((y) => y.personId === m.personId);
      return x ? { ...m, arrivalOptionId: x.optionId } : m;
    }),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>("all");
  const [bulkOption, setBulkOption] = useState(options[0]?.id ?? "");
  const [toast, setToast] = useState<Undo | null>(null);
  const hideToast = useCallback(() => setToast(null), []);

  const byId = new Map(options.map((o) => [o.id, o]));
  const effectOf = (m: ArrivalRow) => (m.arrivalOptionId ? byId.get(m.arrivalOptionId)?.effect : undefined);
  const FILTERS: Array<[Filter, string, (m: ArrivalRow) => boolean]> = [
    ["all", "הכל", () => true],
    ["blank", "לא מולא", (m) => !m.arrivalOptionId],
    ["arriving", "מגיעים", (m) => effectOf(m) === "arriving"],
    ["not-arriving", "לא מגיעים", (m) => effectOf(m) === "not_arriving"],
  ];
  const test = FILTERS.find(([id]) => id === filter)![2];
  const visible = rows.filter(test);
  const blanks = rows.filter((m) => m.editable && !m.arrivalOptionId);

  function save(change: Change, message: string) {
    setError(undefined);
    const before = change.map((x) => ({ personId: x.personId, optionId: rows.find((m) => m.personId === x.personId)?.arrivalOptionId ?? null }));
    start(async () => {
      optimistic(change);
      const r = await setArrival(change);
      if (r?.error) setError(r.error);
      else setToast({ message, run: () => setArrival(before) });
    });
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

  function setDate(personId: string, callUpOn: string) {
    setError(undefined);
    start(async () => {
      const r = await setPlanningCallUp({ personId, callUpOn: callUpOn || null });
      if (r?.error) setError(r.error);
    });
  }

  // platoon headers in the order the rows come (the page sorts by platoon)
  const groups: Array<{ title: string; rows: ArrivalRow[] }> = [];
  for (const m of visible) {
    const title = m.platoonName ?? "ברמת הפלוגה";
    const g = groups.at(-1);
    if (g && g.title === title) g.rows.push(m);
    else groups.push({ title, rows: [m] });
  }

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

      {blanks.length && options.length ? (
        <div className="tz-card flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="text-[15px]">
            סימון <span className="tz-num">{blanks.length}</span> הלא מולאים כ־
          </span>
          <select className="tz-input min-h-9 w-auto" value={bulkOption} onChange={(e) => setBulkOption(e.target.value)} aria-label="ערך לסימון">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tz-btn tz-btn-tinted tz-btn-sm"
            disabled={pending || !bulkOption}
            onClick={() =>
              save(
                blanks.map((m) => ({ personId: m.personId, optionId: bulkOption })),
                `${blanks.length} חיילים סומנו ${byId.get(bulkOption)?.name ?? ""}`,
              )
            }
          >
            סימון
          </button>
        </div>
      ) : null}

      {!options.length ? (
        <p className="tz-alert m-0">אין עדיין ערכים לצפי הגעה בסבב הזה. מנהל גדודי מגדיר אותם בהגדרות › צפי הגעה וסטטוס גיוס.</p>
      ) : null}
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}

      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-1.5">
          <h2 className="tz-section-header">{g.title}</h2>
          <div className="tz-group">
            {g.rows.map((m) => (
              <div key={m.personId} className="tz-row flex-col items-stretch gap-2 py-2.5">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{m.name}</span>
                  <span className="tz-footnote">{m.sub}</span>
                  {m.movedFrom ? <span className="tz-chip tz-chip-brigade">עובר מ־{m.movedFrom}</span> : null}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {options.map((o) => {
                    const on = m.arrivalOptionId === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className={`tz-chip ${on ? EFFECT_CHIP[o.effect] : "bg-fill text-ink-muted before:hidden"}`}
                        aria-pressed={on}
                        disabled={!m.editable || pending}
                        onClick={() => save([{ personId: m.personId, optionId: on ? null : o.id }], on ? `צפי ההגעה של ${m.name} נמחק` : `${m.name}: ${o.name}`)}
                      >
                        {o.name}
                      </button>
                    );
                  })}
                  <label className="ms-auto flex items-center gap-1.5 text-[13px]">
                    <span className="tz-footnote">גיוס</span>
                    <input
                      type="date"
                      className="tz-input min-h-8 w-[140px] py-0 text-[14px]"
                      defaultValue={m.callUpOn ?? ""}
                      min={round.startsOn}
                      max={round.endsOn}
                      disabled={!m.editable || pending}
                      onBlur={(e) => {
                        if (e.target.value !== (m.callUpOn ?? "")) setDate(m.personId, e.target.value);
                      }}
                    />
                  </label>
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
      {!visible.length ? <p className="tz-footnote m-0 p-4 text-center">אין חיילים בסינון הזה.</p> : null}
      {toast ? <UndoToast message={toast.message} onUndo={undo} onDone={hideToast} pending={pending} /> : null}
    </div>
  );
}
