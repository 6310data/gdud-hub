"use client";
/**
 * זיכוי מפלוגה: tick the company's צ׳ (grouped by device type, "סימון הכל" per type), each תקין or
 * תקול; ציוד משלים as two steppers per item (תקין / תקול) capped together at what the company holds,
 * with "הצעה לפי תקן"; optional returning soldier, date, notes. On a phone the submit is a sticky bar.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { expandKit, matches, normalizeSerial } from "@gdud/core";
import { Button, Icon, Serial } from "@gdud/ui";
import { PersonPicker, PickedPerson, type PickPerson } from "@/components/person-picker";
import { creditFromCompany } from "../../_actions/moves";
import { countByType, ErrorAlert, kitMap, QtyStepper, StepTitle, type KitRecord } from "../../sign/_components/parts";

export interface CreditData {
  unitId: string;
  companyName: string;
  /** the company's צ׳ by device type; holder = name · תפקיד inside the company */
  groups: { type: string; rows: { id: string; serial: string; holder: string | null }[] }[];
  /** ציוד משלים the company holds (have > 0) */
  items: { id: string; name: string; have: number }[];
  kits: KitRecord;
  /** active soldiers of the company */
  people: PickPerson[];
  /** the signed-in user */
  user: string;
  today: string;
  minDay: string;
}

interface Line {
  ok: number;
  broken: number;
}
const ZERO: Line = { ok: 0, broken: 0 };

export function CreditForm({ data }: { data: CreditData }) {
  const router = useRouter();
  /** chosen צ׳ id → broken */
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [personId, setPersonId] = useState<string>();
  const [day, setDay] = useState(data.today);
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const person = personId ? data.people.find((p) => p.id === personId) : undefined;
  const typeOf = new Map(data.groups.flatMap((g) => g.rows.map((r) => [r.id, g.type] as const)));
  const q = query.trim();
  const qSerial = normalizeSerial(q).toLowerCase();
  const groups = q
    ? data.groups
        .map((g) => ({ ...g, rows: matches(q, g.type) ? g.rows : g.rows.filter((r) => r.serial.toLowerCase().includes(qSerial) || matches(q, r.holder)) }))
        .filter((g) => g.rows.length)
    : data.groups;

  const brokenSerials = [...chosen.values()].filter(Boolean).length;
  const lineOf = (id: string) => lines[id] ?? ZERO;
  const units = data.items.reduce((n, i) => n + lineOf(i.id).ok + lineOf(i.id).broken, 0);
  const brokenUnits = data.items.reduce((n, i) => n + lineOf(i.id).broken, 0);
  const proposedByName = expandKit(countByType([...chosen.keys()], (id) => typeOf.get(id) ?? ""), kitMap(data.kits));

  const blocker = !chosen.size && !units ? "חסר: ציוד לזיכוי" : day > data.today ? "תאריך עתידי" : day && day < data.minDay ? "התאריך רחוק מדי (עד שנה אחורה)" : null;
  const summary = `${chosen.size} צ׳${brokenSerials ? ` (${brokenSerials} תקולים)` : ""} · ${units} פריטי ציוד משלים${brokenUnits ? ` (${brokenUnits} תקולים)` : ""}`;

  const setOn = (ids: readonly string[], on: boolean) =>
    setChosen((cur) => {
      const next = new Map(cur);
      for (const id of ids) {
        if (!on) next.delete(id);
        else if (!next.has(id)) next.set(id, false);
      }
      return next;
    });
  const setBroken = (id: string, broken: boolean) => setChosen((cur) => new Map(cur).set(id, broken));
  const setLine = (id: string, patch: Partial<Line>) => setLines((cur) => ({ ...cur, [id]: { ...(cur[id] ?? ZERO), ...patch } }));

  function proposeFromKit() {
    setLines((cur) => {
      const next = { ...cur };
      for (const i of data.items) {
        const want = proposedByName.get(i.name);
        if (!want) continue;
        const broken = cur[i.id]?.broken ?? 0;
        next[i.id] = { ok: Math.min(want, i.have - broken), broken };
      }
      return next;
    });
  }

  function submit() {
    if (blocker) return;
    setError(undefined);
    start(async () => {
      const r = await creditFromCompany({
        unitId: data.unitId,
        returnerPersonId: personId ?? null,
        day: day === data.today ? null : day || null,
        notes,
        serials: [...chosen].map(([id, broken]) => ({ id, broken })),
        lines: data.items.filter((i) => lineOf(i.id).ok + lineOf(i.id).broken > 0).map((i) => ({ itemId: i.id, ...lineOf(i.id) })),
      });
      if (!r.ok) return setError(r.error);
      router.push(`/kesher/companies/${data.unitId}`);
    });
  }

  const hasKit = data.items.some((i) => proposedByName.get(i.name));

  return (
    <div className="flex flex-col gap-4 pb-28 lg:pb-0">
      <ErrorAlert error={error} />

      <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* 1 · צ׳ */}
        <section aria-label="שלב 1 · צ׳" className="flex flex-col gap-3">
          <div className="px-1">
            <StepTitle n={1} title="צ׳ שחוזרים" note={`${chosen.size}/${typeOf.size}`} />
          </div>
          {data.groups.length ? (
            <>
              <label className="tz-search bg-surface">
                <Icon name="search" size={15} />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש צ׳ (ספרות), סוג מכשיר או חתום" aria-label="חיפוש צ׳" autoComplete="off" />
              </label>
              <p className="tz-footnote m-0 px-1">ציוד תקול נכנס למחסן כתקול ומופיע בדף ציוד תקול.</p>
              {groups.map((g) => {
                const ids = g.rows.map((r) => r.id);
                const on = ids.filter((id) => chosen.has(id)).length;
                return (
                  <div key={g.type} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 px-4">
                      <h3 className="tz-section-header m-0 p-0">
                        {g.type}{" "}
                        <span className="tz-num font-normal">
                          · {on}/{ids.length}
                        </span>
                      </h3>
                      <button type="button" className="tz-btn tz-btn-plain tz-btn-sm min-h-0 px-0" onClick={() => setOn(ids, on < ids.length)} disabled={pending}>
                        {on < ids.length ? "סימון הכל" : "ביטול הכל"}
                      </button>
                    </div>
                    <div className="tz-group">
                      {g.rows.map((r) => {
                        const isOn = chosen.has(r.id);
                        const broken = chosen.get(r.id) === true;
                        return (
                          <div key={r.id} className="tz-row">
                            <span className="tz-row-body flex-wrap">
                              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                                <input type="checkbox" className="size-5 shrink-0" checked={isOn} onChange={(e) => setOn([r.id], e.target.checked)} disabled={pending} aria-label={`זיכוי ${g.type} ${r.serial}`} />
                                <span className="tz-row-title">
                                  <Serial>{r.serial}</Serial>
                                  <span className="tz-row-sub">{r.holder ?? "לא משויך בפלוגה"}</span>
                                </span>
                              </label>
                              {isOn ? (
                                <div className="tz-seg w-[132px]" role="tablist" aria-label={`מצב ${r.serial}`}>
                                  <button type="button" role="tab" className="tz-seg-item" aria-selected={!broken} onClick={() => setBroken(r.id, false)} disabled={pending}>
                                    תקין
                                  </button>
                                  <button type="button" role="tab" className={`tz-seg-item ${broken ? "text-danger" : ""}`} aria-selected={broken} onClick={() => setBroken(r.id, true)} disabled={pending}>
                                    תקול
                                  </button>
                                </div>
                              ) : null}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {!groups.length ? <p className="tz-footnote m-0 px-1">אין צ׳ שמתאים לחיפוש</p> : null}
            </>
          ) : (
            <div className="tz-card">
              <p className="tz-footnote m-0 p-4">אין צ׳ על הפלוגה</p>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-[22px] lg:sticky lg:top-6">
          {/* 2 · ציוד משלים */}
          <section aria-label="שלב 2 · ציוד משלים" className="tz-card flex flex-col gap-3 p-4">
            <StepTitle n={2} title="ציוד משלים" />
            {data.items.length ? (
              <>
                <button type="button" className="tz-btn tz-btn-tinted tz-btn-sm self-start" onClick={proposeFromKit} disabled={pending || !hasKit}>
                  הצעה לפי תקן
                </button>
                {!chosen.size ? <span className="tz-footnote">ההצעה מחושבת מהתקן של הצ׳ שנבחרו</span> : !hasKit ? <span className="tz-footnote">לצ׳ שנבחרו אין תקן ציוד משלים שהפלוגה מחזיקה</span> : null}
                <div className="flex flex-col">
                  {data.items.map((i) => {
                    const l = lineOf(i.id);
                    const kit = proposedByName.get(i.name);
                    return (
                      <div key={i.id} className="flex flex-col gap-1.5 border-b border-separator py-2.5 last:border-0">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-[14px] font-medium">{i.name}</span>
                          <span className="tz-num shrink-0 text-xs text-ink-muted">
                            על הפלוגה {i.have}
                            {kit ? ` · תקן ${kit}` : ""}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                          <span className="flex items-center gap-1.5 text-[13px]">
                            <span className="w-9 text-ink-muted">תקין</span>
                            <QtyStepper value={l.ok} max={i.have - l.broken} onChange={(n) => setLine(i.id, { ok: n })} label={`${i.name} תקין`} />
                          </span>
                          <span className="flex items-center gap-1.5 text-[13px]">
                            <span className={`w-9 ${l.broken ? "text-danger" : "text-ink-muted"}`}>תקול</span>
                            <QtyStepper value={l.broken} max={i.have - l.ok} onChange={(n) => setLine(i.id, { broken: n })} label={`${i.name} תקול`} />
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <span className="tz-footnote">אין ציוד משלים על הפלוגה</span>
            )}
          </section>

          {/* 3 · summary */}
          <section aria-label="שלב 3 · סיכום" className="tz-card flex flex-col gap-3 p-4">
            <StepTitle n={3} title="סיכום" />
            <div className="flex flex-col gap-1.5">
              <span className="tz-label">חייל מחזיר (לא חובה)</span>
              {person ? (
                <PickedPerson person={person} onClear={() => setPersonId(undefined)} />
              ) : (
                <PersonPicker people={data.people} onPick={(id) => setPersonId(id)} empty={`לא נמצא ב${data.companyName}`} />
              )}
            </div>
            <label className="tz-field">
              <span className="tz-label">תאריך</span>
              <input className="tz-input" type="date" value={day} min={data.minDay} max={data.today} onChange={(e) => setDay(e.target.value)} />
            </label>
            {day && day !== data.today ? <span className="tz-footnote">הזיכוי יירשם ביומן כרטרואקטיבי</span> : null}
            <label className="tz-field">
              <span className="tz-label">הערות</span>
              <textarea className="tz-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="לא חובה" />
            </label>
            <span className="tz-footnote">מזכה: {data.user}</span>

            <div className="flex flex-col gap-1.5 max-lg:hidden">
              <span className="text-[15px] font-semibold">{summary}</span>
              <Button type="button" disabled={Boolean(blocker)} loading={pending} onClick={submit}>
                {pending ? null : <Icon name="undo" size={18} />}
                זיכוי והחזרה למחסן
              </Button>
              {blocker ? <span className={`tz-footnote ${chosen.size || units ? "text-danger" : ""}`}>{blocker}</span> : null}
            </div>
          </section>
        </div>
      </div>

      {/* phone: the submit in a sticky bar */}
      <div className="tz-action-bar lg:hidden">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold">{summary}</span>
          {blocker ? <span className={`truncate text-xs ${chosen.size || units ? "text-danger" : "text-ink-muted"}`}>{blocker}</span> : null}
        </span>
        <Button type="button" small disabled={Boolean(blocker)} loading={pending} onClick={submit}>
          זיכוי והחזרה למחסן
        </Button>
      </div>
    </div>
  );
}
