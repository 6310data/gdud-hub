"use client";
import Link from "next/link";
import { useState } from "react";
import type { RosterField } from "@gdud/core";
import type { RosterApplyCounts, RosterDecisions, RosterQuestion } from "@gdud/db/doch1-roster-import";
import { Button, Icon, Steps, type StepItem } from "@gdud/ui";
import { FilePicker } from "@/components/file-picker";
import type { RosterMatchVM, RosterPreview } from "@/lib/doch1/roster";
import { postWithProgress } from "@/lib/progress-client";

const MAX_FILE_BYTES = 3.9 * 1024 * 1024;
const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
const RUN_URL = "/doch1/planning/roster/run";
const CORRECTIONS_URL = "/doch1/planning/roster/corrections";

type Mode = "preview" | "apply";
const PHASES: Record<Mode, Array<{ id: string; label: string }>> = {
  preview: [
    { id: "upload", label: "העלאת הקובץ לשרת" },
    { id: "read", label: "קריאת הרשימה" },
    { id: "match", label: "השוואה לסבב" },
  ],
  apply: [
    { id: "upload", label: "העלאת הקובץ לשרת" },
    { id: "read", label: "קריאת הרשימה" },
    { id: "match", label: "השוואה לסבב" },
    { id: "apply", label: "שמירה בסבב שבתכנון" },
  ],
};
const SPECIAL: Record<RosterQuestion["kind"], Array<{ id: string; label: string }>> = {
  company: [{ id: "ignore", label: "להתעלם (לא לייבא את החיילים שלה)" }],
  platoon: [
    { id: "create", label: "ליצור מחלקה" },
    { id: "company", label: "ברמת הפלוגה" },
  ],
  arrival: [
    { id: "create:arriving", label: "ליצור ערך · מגיע" },
    { id: "create:not_arriving", label: "ליצור ערך · לא מגיע" },
  ],
};
const KIND_TITLE: Record<RosterQuestion["kind"], string> = { company: "פלוגה", platoon: "מחלקה", arrival: "צפי הגעה" };

type Answers = Record<"companies" | "platoons" | "arrival", Record<string, string>>;
const KIND_KEY: Record<RosterQuestion["kind"], keyof Answers> = { company: "companies", platoon: "platoons", arrival: "arrival" };
const NO_ANSWERS: Answers = { companies: {}, platoons: {}, arrival: {} };

interface Decisions {
  /** new / returning soldiers already shown once: their choice is kept on the next preview */
  seen: Set<string>;
  add: Set<string>;
  take: Record<string, Set<RosterField>>;
  keepMissing: Set<string>;
}

interface Run {
  mode: Mode;
  active: string;
  failed: boolean;
  notes: Record<string, string>;
}

function runSteps(run: Run): StepItem[] {
  const phases = PHASES[run.mode];
  const at = phases.findIndex((p) => p.id === run.active);
  return phases.map((p, i) => ({ id: p.id, label: p.label, state: i < at ? "done" : i === at ? (run.failed ? "error" : "active") : "waiting", detail: run.notes[p.id] }));
}

/** New defaults for what a preview shows, keeping the choices already made for the same soldiers. */
function withDefaults(p: RosterPreview, cur: Decisions | null): Decisions {
  const offered = [...p.added.map((a) => a.personalNumber), ...p.returning.map((r) => r.personalNumber)];
  const add = new Set(offered.filter((x) => !cur?.seen.has(x) || cur.add.has(x)));
  const take: Decisions["take"] = {};
  for (const m of [...p.changed, ...p.returning]) take[m.personalNumber] = cur?.take[m.personalNumber] ?? new Set(m.fields.map((f) => f.field));
  const keepMissing = new Set(p.missing.map((m) => m.personId).filter((id) => cur?.keepMissing.has(id)));
  return { seen: new Set([...(cur?.seen ?? []), ...offered]), add, take, keepMissing };
}

const toWire = (d: Decisions): RosterDecisions => ({
  add: [...d.add],
  take: Object.fromEntries(Object.entries(d.take).map(([pn, s]) => [pn, [...s]])),
  keepMissing: [...d.keepMissing],
});

function Group({ title, count, children, open = true }: { title: string; count: number; children: React.ReactNode; open?: boolean }) {
  if (!count) return null;
  return (
    <details open={open} className="flex flex-col gap-1.5">
      <summary className="tz-panel-title cursor-pointer">
        {title} <span className="tz-num">({count})</span>
      </summary>
      <div className="tz-group mt-1.5">{children}</div>
    </details>
  );
}

function MatchRow({ m, take, onTake, add }: { m: RosterMatchVM; take: Set<RosterField>; onTake: (f: RosterField, on: boolean) => void; add?: { on: boolean; set: (on: boolean) => void } }) {
  return (
    <div className="tz-row flex-col items-stretch gap-2 py-2.5">
      <span className="flex flex-wrap items-baseline gap-2">
        {add ? <input type="checkbox" checked={add.on} onChange={(e) => add.set(e.target.checked)} aria-label={`להוסיף את ${m.name} לסבב`} /> : null}
        <span className="font-semibold">{m.name}</span>
        <span className="tz-serial">{m.personalNumber}</span>
      </span>
      {m.fields.map((f) => (
        <span key={f.field} className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="tz-footnote min-w-[90px]">{f.label}</span>
          <span className="tz-seg" role="group" aria-label={`${f.label} של ${m.name}`}>
            <button type="button" className="tz-seg-item" aria-pressed={take.has(f.field)} onClick={() => onTake(f.field, true)}>
              הגדוד: {f.battalion || "—"}
            </button>
            <button type="button" className="tz-seg-item" aria-pressed={!take.has(f.field)} onClick={() => onTake(f.field, false)}>
              שלנו: {f.ours || "—"}
            </button>
          </span>
          {f.field === "unit" && m.inActiveRound && take.has("unit") ? <span className="tz-footnote">המעבר יחול בהפעלת הסבב</span> : null}
        </span>
      ))}
    </div>
  );
}

/** Upload the battalion's list → preview the differences → decide → apply; and the corrections file. */
export function RosterFlow({ planningName, rounds }: { planningName: string; rounds: Array<{ id: string; label: string }> }) {
  const [file, setFile] = useState<File | null>(null);
  const [baseRoundId, setBaseRoundId] = useState("");
  const [answers, setAnswers] = useState<Answers>(NO_ANSWERS);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [decisions, setDecisions] = useState<Decisions | null>(null);
  const [result, setResult] = useState<RosterApplyCounts | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string>();
  const [downloading, setDownloading] = useState(false);
  const running = !!run && !run.failed;

  const formData = (current: Answers, d: Decisions | null) => {
    const fd = new FormData();
    fd.set("file", file!);
    fd.set("answers", JSON.stringify(current));
    if (baseRoundId) fd.set("baseRoundId", baseRoundId);
    if (d) fd.set("decisions", JSON.stringify(toWire(d)));
    return fd;
  };

  async function start<T>(mode: Mode, current: Answers, d: Decisions | null): Promise<T | null> {
    setError(undefined);
    setRun({ mode, active: "upload", failed: false, notes: {} });
    const r = await postWithProgress<T>(`${RUN_URL}?mode=${mode}`, formData(current, d), (e) =>
      setRun((cur) => (!cur ? cur : e.type === "note" ? { ...cur, notes: { ...cur.notes, [e.phase]: e.note } } : { ...cur, active: e.phase })),
    );
    if (r.error !== undefined) {
      setError(r.error);
      setRun((cur) => (cur ? { ...cur, failed: true } : cur));
      return null;
    }
    setRun(null);
    return r.data;
  }

  async function check(current: Answers) {
    if (!file) return;
    setResult(null);
    const p = await start<RosterPreview>("preview", current, null);
    if (!p) return;
    const next: Answers = { companies: { ...current.companies }, platoons: { ...current.platoons }, arrival: { ...current.arrival } };
    for (const q of p.questions) if (next[KIND_KEY[q.kind]][q.key] === undefined && q.suggestion) next[KIND_KEY[q.kind]][q.key] = q.suggestion;
    setAnswers(next);
    setPreview(p);
    setDecisions((cur) => withDefaults(p, cur));
  }

  async function apply() {
    if (!file || !decisions) return;
    const counts = await start<RosterApplyCounts>("apply", answers, decisions);
    if (!counts) return;
    setResult(counts);
    setPreview(null);
    setDecisions(null);
  }

  async function downloadCorrections() {
    if (!file || !decisions) return;
    setDownloading(true);
    setError(undefined);
    try {
      const res = await fetch(CORRECTIONS_URL, { method: "POST", body: formData(answers, decisions) });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "ההורדה נכשלה");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `תיקונים לגדוד · ${planningName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  function chooseFile(f: File | null) {
    setPreview(null);
    setDecisions(null);
    setResult(null);
    setRun(null);
    setAnswers(NO_ANSWERS);
    const ok = !!f && /\.(xlsx|csv)$/i.test(f.name) && f.size <= MAX_FILE_BYTES;
    setError(!f || ok ? undefined : f.size > MAX_FILE_BYTES ? "הקובץ גדול מדי (עד 3.9MB)" : "צריך קובץ xlsx או csv");
    setFile(ok ? f : null);
  }

  const update = (fn: (d: Decisions) => void) =>
    setDecisions((cur) => {
      if (!cur) return cur;
      const next: Decisions = { seen: cur.seen, add: new Set(cur.add), take: { ...cur.take }, keepMissing: new Set(cur.keepMissing) };
      fn(next);
      return next;
    });
  const setTake = (pn: string, f: RosterField, on: boolean) =>
    update((d) => {
      const s = new Set(d.take[pn]);
      if (on) s.add(f);
      else s.delete(f);
      d.take[pn] = s;
    });
  const setAdd = (pn: string, on: boolean) => update((d) => (on ? d.add.add(pn) : d.add.delete(pn)));
  const setKeep = (id: string, on: boolean) => update((d) => (on ? d.keepMissing.add(id) : d.keepMissing.delete(id)));

  const open = preview?.questions ?? [];

  return (
    <div className="flex flex-col gap-[22px]">
      <section className="tz-card flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <h2 className="tz-headline">הקובץ</h2>
          <p className="tz-footnote m-0">
            רשימת החיילים מהגדוד בפורמט האלפון (שם מלא, מספר אישי, פלוגה, מחלקה, מספר טלפון, תפקיד בפועל; אפשר גם צפי הגעה ותאריך גיוס). שום דבר לא נשמר לפני ״שמירה בסבב״.
          </p>
        </div>
        <FilePicker file={file} onFile={chooseFile} accept={ACCEPT} disabled={running} hint="xlsx או csv, עד 3.9MB. הקובץ נקרא בזיכרון בשרת ולא נשמר." />
        <label className="flex flex-wrap items-center gap-2 text-[15px]">
          להשוות ל־
          <select className="tz-input min-h-9 w-auto" value={baseRoundId} onChange={(e) => setBaseRoundId(e.target.value)} disabled={running}>
            <option value="">הסבב הפעיל (או האחרון)</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {preview ? (
            <>
              <Button type="button" small onClick={apply} disabled={open.length > 0 || running} loading={running && run?.mode === "apply"}>
                {running && run?.mode === "apply" ? null : <Icon name="check" size={16} />}
                שמירה בסבב
              </Button>
              <Button type="button" variant="tinted" small onClick={() => check(answers)} disabled={running} loading={running && run?.mode === "preview"}>
                עדכון תצוגה
              </Button>
              <Button type="button" variant="plain" small onClick={downloadCorrections} disabled={running || open.length > 0} loading={downloading}>
                קובץ תיקונים לגדוד
              </Button>
            </>
          ) : (
            <Button type="button" small onClick={() => check(answers)} disabled={!file} loading={running}>
              {running ? null : <Icon name="upload" size={16} />}
              העלאה והשוואה
            </Button>
          )}
        </div>
        {error && !run?.failed ? (
          <p role="alert" className="tz-alert tz-alert-error m-0">
            {error}
          </p>
        ) : null}
      </section>

      {run ? (
        <section className="flex flex-col gap-1.5" aria-live="polite">
          <div className="tz-card overflow-hidden">
            <Steps steps={runSteps(run)} label="שלבים" />
          </div>
          {run.failed && error ? (
            <p role="alert" className="tz-alert tz-alert-error m-0">
              {error}
              {run.mode === "apply" ? "\nשום דבר לא נשמר." : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {preview && decisions ? (
        <>
          <p className="tz-footnote m-0 px-1">
            {preview.comparedWith === "planning"
              ? `השוואה לחיילים שכבר בסבב ${planningName}.`
              : preview.baseRound
                ? `השוואה לחיילי ${preview.baseRound.name}.`
                : "אין סבב להשוואה: כל החיילים בקובץ חדשים או חוזרים."}
            {preview.waiting ? ` ${preview.waiting} שורות מחכות לתשובה על פלוגה או מחלקה.` : ""}
          </p>

          {open.length ? (
            <section className="flex flex-col gap-1.5">
              <h2 className="tz-panel-title">לפני השמירה: {open.length} שאלות</h2>
              <div className="tz-card flex flex-col">
                {open.map((q) => (
                  <label key={`${q.kind}|${q.key}`} className="flex flex-wrap items-center gap-3 border-b border-separator px-4 py-3 last:border-b-0">
                    <span className="flex min-w-[180px] flex-1 flex-col">
                      <span className="tz-footnote">{KIND_TITLE[q.kind]}</span>
                      <span className="font-semibold">{q.label}</span>
                    </span>
                    <select
                      className="tz-input w-auto min-w-[200px]"
                      value={answers[KIND_KEY[q.kind]][q.key] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [KIND_KEY[q.kind]]: { ...a[KIND_KEY[q.kind]], [q.key]: e.target.value } }))}
                    >
                      {[...SPECIAL[q.kind], ...q.options].map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="tz-section-footer">אחרי הבחירה: ״עדכון תצוגה״. התשובות נשמרות לסבב. יצירת מחלקה דורשת גם הרשאת מנהל ליבה.</p>
            </section>
          ) : null}

          <Group title="שינויים" count={preview.changed.length}>
            {preview.changed.map((m) => (
              <MatchRow key={m.personId} m={m} take={decisions.take[m.personalNumber] ?? new Set()} onTake={(f, on) => setTake(m.personalNumber, f, on)} />
            ))}
          </Group>
          <Group title="חדשים" count={preview.added.length}>
            {preview.added.map((a) => (
              <label key={a.personalNumber} className="tz-row gap-3">
                <input type="checkbox" checked={decisions.add.has(a.personalNumber)} onChange={(e) => setAdd(a.personalNumber, e.target.checked)} />
                <span className="tz-row-body">
                  <span className="tz-row-title">
                    {a.name}
                    <span className="tz-row-sub">{a.unit}</span>
                  </span>
                  <span className="tz-serial">{a.personalNumber}</span>
                </span>
              </label>
            ))}
          </Group>
          <Group title="חוזרים מסבב קודם" count={preview.returning.length}>
            {preview.returning.map((m) => (
              <MatchRow
                key={m.personId}
                m={m}
                take={decisions.take[m.personalNumber] ?? new Set()}
                onTake={(f, on) => setTake(m.personalNumber, f, on)}
                add={{ on: decisions.add.has(m.personalNumber), set: (on) => setAdd(m.personalNumber, on) }}
              />
            ))}
          </Group>
          <Group title="לא ברשימת הגדוד" count={preview.missing.length}>
            {preview.missing.map((m) => (
              <label key={m.personId} className="tz-row gap-3">
                <input type="checkbox" checked={decisions.keepMissing.has(m.personId)} onChange={(e) => setKeep(m.personId, e.target.checked)} />
                <span className="tz-row-body">
                  <span className="tz-row-title">
                    {m.name}
                    <span className="tz-row-sub">{m.unit}</span>
                  </span>
                  <span className="tz-footnote">{decisions.keepMissing.has(m.personId) ? "נשאר בסבב" : "לא ייכלל"}</span>
                </span>
              </label>
            ))}
          </Group>
          {preview.unchanged ? (
            <p className="tz-footnote m-0 px-1">
              <span className="tz-num">{preview.unchanged}</span> חיילים בלי שינוי ייכללו בסבב.
            </p>
          ) : null}
          <Group title="בעיות בקובץ" count={preview.problems.length} open={false}>
            {preview.problems.map((p) => (
              <div key={p.line} className="tz-row text-[14px]">
                <span className="tz-footnote min-w-[60px]">שורה {p.line}</span>
                {p.message}
              </div>
            ))}
          </Group>
          {preview.warnings.length ? (
            <ul className="tz-card m-0 flex list-none flex-col p-0">
              {preview.warnings.map((w, i) => (
                <li key={i} className="border-b border-separator px-4 py-2 text-[14px] last:border-b-0">
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {result ? (
        <div className="tz-alert tz-alert-ok m-0 flex flex-col items-start gap-1">
          <span>
            נשמר: <span className="tz-num">{result.members}</span> חיילים בסבב · <span className="tz-num">{result.created}</span> חדשים ·{" "}
            <span className="tz-num">{result.updated}</span> עודכנו
            {result.removed ? <> · <span className="tz-num">{result.removed}</span> הוצאו</> : null}
            {result.pendingMoves ? <> · <span className="tz-num">{result.pendingMoves}</span> מעברי פלוגה יחולו בהפעלה</> : null}
          </span>
          <Link href="/doch1/planning">לתכנון הסבב</Link>
        </div>
      ) : null}
    </div>
  );
}
