"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ImportCounts, MappingQuestion, SheetImportPlan } from "@gdud/db/doch1-import";
import { Button, Icon, Steps, type StepItem } from "@gdud/ui";
import { FilePicker } from "@/components/file-picker";
import { postWithProgress } from "@/lib/progress-client";

const MAX_FILE_BYTES = 3.9 * 1024 * 1024;
const WARNINGS_SHOWN = 30;
const RUN_URL = "/doch1/import/run";

type Mode = "preview" | "apply";
/** The phases the server reports (import/run/route.ts and applySheetImport's onProgress), in order. */
const PHASES: Record<Mode, Array<{ id: string; label: string }>> = {
  preview: [
    { id: "upload", label: "העלאת הקובץ לשרת" },
    { id: "read", label: "קריאת הגיליון" },
    { id: "match", label: "התאמה לנתוני האפליקציה ובדיקת השינויים" },
  ],
  apply: [
    { id: "upload", label: "העלאת הקובץ לשרת" },
    { id: "read", label: "קריאת הגיליון" },
    { id: "match", label: "התאמה לנתוני האפליקציה" },
    { id: "structure", label: "פלוגות, מחלקות וסטטוסים" },
    { id: "people", label: "חיילים" },
    { id: "members", label: "שיבוץ לסבב" },
    { id: "days", label: "ימי דיווח" },
    { id: "standby", label: "שבצ״ק: מיקומים, צוותי כוננות ורכבים" },
    { id: "mappings", label: "שמירת ההחלטות וסיום" },
  ],
};

interface Run {
  mode: Mode;
  active: string;
  failed: boolean;
  startedAt: number;
  counts: Record<string, { done: number; total: number }>;
  notes: Record<string, string>;
}

const fmtNum = (n: number) => n.toLocaleString("he-IL");
const fmtElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function runSteps(run: Run): StepItem[] {
  const phases = PHASES[run.mode];
  const at = phases.findIndex((p) => p.id === run.active);
  return phases.map((p, i) => {
    const c = run.counts[p.id];
    const state = i < at ? "done" : i === at ? (run.failed ? "error" : "active") : "waiting";
    const detail = run.notes[p.id] ?? (c && c.total ? `${fmtNum(c.done)} מתוך ${fmtNum(c.total)}` : undefined);
    return { id: p.id, label: p.label, state, detail, progress: c && c.total ? c.done / c.total : undefined };
  });
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tz-num">{fmtElapsed(now - since)}</span>;
}

type Answers = Record<MappingQuestion["kind"], Record<string, string>>;
const NO_ANSWERS: Answers = { tab: {}, platoon: {}, status: {}, location: {} };

const SPECIAL: Record<MappingQuestion["kind"], Array<{ id: string; label: string }>> = {
  tab: [
    { id: "ignore", label: "להתעלם מהלשונית" },
    { id: "create", label: "ליצור פלוגה" },
  ],
  platoon: [
    { id: "create", label: "ליצור מחלקה" },
    { id: "company", label: "ברמת הפלוגה" },
  ],
  status: [{ id: "create", label: "ליצור סטטוס" }],
  location: [
    { id: "create:outpost", label: "ליצור מיקום · מוצב" },
    { id: "create:camp", label: "ליצור מיקום · מחנה" },
    { id: "create:outside", label: "ליצור מיקום · בחוץ" },
    { id: "ignore", label: "לא לייבא (בלי מיקום)" },
  ],
};
const KIND_TITLE: Record<MappingQuestion["kind"], string> = {
  tab: "לשונית",
  platoon: "מחלקה",
  status: "ערך בגיליון",
  location: "מיקום בשבצ״ק",
};

function CountsCard({ counts, title }: { counts: ImportCounts; title: string }) {
  const items: Array<[string, number]> = [
    ["חיילים חדשים", counts.newPeople],
    ["חיילים שעודכנו", counts.updatedPeople],
    ["שורות סבב שעודכנו", counts.members],
    ["ימים שנכתבו", counts.daysWritten],
    ["ימים שנוקו", counts.daysCleared],
    ["דולגו בפלוגת הפיילוט", counts.daysSkippedPilot],
    ["סטטוסים חדשים", counts.statusesCreated],
    ["פלוגות חדשות", counts.companiesCreated],
    ["מחלקות חדשות", counts.platoonsCreated],
    ["מיקומים חדשים", counts.locationsCreated],
    ["חיילים שהמיקום שלהם השתנה", counts.locationsSet],
    ["צוותי כוננות חדשים", counts.teamsCreated],
    ["שינויים בצוותי כוננות", counts.teamMembersChanged],
    ["רכבים חדשים", counts.vehiclesCreated],
  ];
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="tz-panel-title">{title}</h2>
      <div className="tz-card grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        {items.map(([label, n]) => (
          <div key={label} className="tz-kpi">
            <span>
              <span className="tz-kpi-value tz-num">{n.toLocaleString("he-IL")}</span>
              <span className="tz-kpi-label">{label}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Upload → preview → answer mapping questions → import (one transaction). The file never leaves memory on the server. */
export function ImportFlow({ roundName }: { roundName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [answers, setAnswers] = useState<Answers>(NO_ANSWERS);
  const [plan, setPlan] = useState<SheetImportPlan | null>(null);
  const [result, setResult] = useState<ImportCounts | null>(null);
  const [error, setError] = useState<string>();
  const [run, setRun] = useState<Run | null>(null);
  const running = run !== null && !run.failed;

  // leaving the page mid-import loses the progress view (the import itself still finishes)
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const formData = (current: Answers) => {
    const fd = new FormData();
    fd.set("file", file!);
    fd.set("mappings", JSON.stringify({ tabs: current.tab, platoons: current.platoon, statuses: current.status, locations: current.location }));
    return fd;
  };

  /** Questions keep their suggestion as the default answer. */
  const withDefaults = (p: SheetImportPlan, current: Answers): Answers => {
    const next: Answers = { tab: { ...current.tab }, platoon: { ...current.platoon }, status: { ...current.status }, location: { ...current.location } };
    for (const q of p.questions) if (next[q.kind][q.key] === undefined && q.suggestion) next[q.kind][q.key] = q.suggestion;
    return next;
  };

  async function start<T>(mode: Mode, current: Answers): Promise<T | null> {
    setError(undefined);
    setRun({ mode, active: "upload", failed: false, startedAt: Date.now(), counts: {}, notes: {} });
    const r = await postWithProgress<T>(`${RUN_URL}?mode=${mode}`, formData(current), (e) =>
      setRun((cur) => {
        if (!cur) return cur;
        if (e.type === "note") return { ...cur, notes: { ...cur.notes, [e.phase]: e.note } };
        const counts = e.total !== undefined ? { ...cur.counts, [e.phase]: { done: e.done ?? 0, total: e.total } } : cur.counts;
        return { ...cur, active: e.phase, counts };
      }),
    );
    if (r.error !== undefined) {
      setError(r.error);
      setRun((cur) => (cur ? { ...cur, failed: true } : cur));
      return null;
    }
    setRun(null);
    return r.data;
  }

  async function preview(current: Answers) {
    if (!file) return;
    setResult(null);
    const data = await start<SheetImportPlan>("preview", current);
    if (!data) return;
    setPlan(data);
    setAnswers(withDefaults(data, current));
  }

  async function runImport() {
    if (!file) return;
    const data = await start<ImportCounts>("apply", answers);
    if (!data) return;
    setResult(data);
    setPlan(null);
  }

  function chooseFile(f: File | null) {
    setPlan(null);
    setResult(null);
    setRun(null);
    setAnswers(NO_ANSWERS);
    const ok = f && f.name.toLowerCase().endsWith(".xlsx") && f.size <= MAX_FILE_BYTES;
    setError(!f ? undefined : !f.name.toLowerCase().endsWith(".xlsx") ? "צריך קובץ xlsx" : f.size > MAX_FILE_BYTES ? "הקובץ גדול מדי (עד 3.9MB)" : undefined);
    setFile(ok ? f : null);
  }

  const open = plan?.questions ?? [];

  return (
    <div className="flex flex-col gap-[22px]">
      <section className="tz-card flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <h2 className="tz-headline">הקובץ</h2>
          <ol className="m-0 flex list-decimal flex-col gap-0.5 ps-5 text-[15px]">
            <li>פותחים את הגיליון של {roundName} ב-Google Sheets</li>
            <li>קובץ ← הורדה ← Microsoft Excel (&lrm;.xlsx)</li>
            <li>מעלים כאן ובודקים את התצוגה המקדימה. שום דבר לא נשמר לפני ״ייבוא״.</li>
          </ol>
        </div>
        <FilePicker
          file={file}
          onFile={chooseFile}
          disabled={running}
          hint="עד 3.9MB. הקובץ נקרא בזיכרון בשרת ולא נשמר."
        />
        <div className="flex flex-wrap items-center gap-2">
          {plan ? (
            <>
              <Button type="button" small onClick={runImport} disabled={open.length > 0 || running} loading={running && run?.mode === "apply"}>
                {running && run?.mode === "apply" ? null : <Icon name="check" size={16} />}
                ייבוא
              </Button>
              <Button type="button" variant="tinted" small onClick={() => preview(answers)} disabled={running} loading={running && run?.mode === "preview"}>
                עדכון תצוגה
              </Button>
            </>
          ) : (
            <Button type="button" small onClick={() => preview(answers)} disabled={!file} loading={running}>
              {running ? null : <Icon name="upload" size={16} />}
              העלאה ותצוגה מקדימה
            </Button>
          )}
          <span className="tz-footnote">בפלוגה עם ״דיווח באפליקציה מתאריך״ הייבוא לא משנה ימים מהתאריך הזה.</span>
        </div>
        {error && !run ? (
          <p role="alert" className="tz-alert tz-alert-error m-0">
            {error}
          </p>
        ) : null}
      </section>

      {run ? (
        <section className="flex flex-col gap-1.5" aria-live="polite">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 className="tz-panel-title">{run.mode === "apply" ? "מייבא את הגיליון" : "בודק את הקובץ"}</h2>
            <span className="tz-footnote">
              {run.failed ? "נעצר" : <>עברו <Elapsed since={run.startedAt} /></>}
            </span>
          </div>
          <div className="tz-card overflow-hidden">
            <Steps steps={runSteps(run)} label="שלבי הייבוא" />
          </div>
          {run.failed && error ? (
            <p role="alert" className="tz-alert tz-alert-error m-0">
              {error}
              {run.mode === "apply" ? "\nשום דבר לא נשמר: הייבוא רץ כפעולה אחת, וכשהוא נכשל הכול מתבטל." : ""}
            </p>
          ) : run.mode === "apply" ? (
            <p className="tz-section-footer">ייבוא ראשון של סבב יכול לקחת כמה דקות. השאירו את הדף פתוח עד הסוף.</p>
          ) : null}
        </section>
      ) : null}

      {plan ? (
        <>
          {open.length ? (
            <section className="flex flex-col gap-1.5">
              <h2 className="tz-panel-title">לפני הייבוא: {open.length} שאלות מיפוי</h2>
              <div className="tz-card flex flex-col">
                {open.map((q) => (
                  <label key={`${q.kind}|${q.key}`} className="flex flex-wrap items-center gap-3 border-b border-separator px-4 py-3 last:border-b-0">
                    <span className="flex min-w-[180px] flex-1 flex-col">
                      <span className="tz-footnote">{KIND_TITLE[q.kind]}</span>
                      <span className="font-semibold">{q.label}</span>
                    </span>
                    <select
                      className="tz-input w-auto min-w-[200px]"
                      value={answers[q.kind][q.key] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.kind]: { ...a[q.kind], [q.key]: e.target.value } }))}
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
              <p className="tz-section-footer">
                אחרי הבחירה: ״עדכון תצוגה״. ההחלטות נשמרות לייבוא הבא של הסבב. יצירת פלוגה או מחלקה דורשת גם הרשאת מנהל ליבה.
              </p>
            </section>
          ) : (
            <p className="tz-alert tz-alert-ok m-0">אין שאלות פתוחות. אפשר לייבא.</p>
          )}

          <CountsCard counts={plan.counts} title="מה הייבוא ישנה" />

          {plan.warnings.length ? (
            <section className="flex flex-col gap-1.5">
              <h2 className="tz-panel-title">אזהרות ({plan.warnings.length})</h2>
              <ul className="tz-card m-0 flex list-none flex-col p-0">
                {plan.warnings.slice(0, WARNINGS_SHOWN).map((w, i) => (
                  <li key={i} className="border-b border-separator px-4 py-2 text-[14px] last:border-b-0">
                    {w}
                  </li>
                ))}
                {plan.warnings.length > WARNINGS_SHOWN ? (
                  <li className="tz-footnote px-4 py-2">ועוד {plan.warnings.length - WARNINGS_SHOWN}</li>
                ) : null}
              </ul>
            </section>
          ) : null}

          {plan.notInSheet.length ? (
            <section className="flex flex-col gap-1.5">
              <h2 className="tz-panel-title">בסבב אבל לא בקובץ ({plan.notInSheet.length}) — נשארים</h2>
              <ul className="tz-card m-0 flex list-none flex-col p-0">
                {plan.notInSheet.map((p) => (
                  <li key={p.personId} className="flex justify-between gap-3 border-b border-separator px-4 py-2 text-[14px] last:border-b-0">
                    <span>{p.name}</span>
                    <span className="tz-footnote">{p.company}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {result ? (
        <>
          <CountsCard counts={result} title="הייבוא הושלם" />
          <p className="tz-alert tz-alert-ok m-0">
            כדאי לעבור על צבעים, קבוצות ודגלים של סטטוסים חדשים ב<Link href="/doch1/settings">הגדרות › סטטוסים</Link>.
          </p>
        </>
      ) : null}
    </div>
  );
}
