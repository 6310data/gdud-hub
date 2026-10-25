"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ImportCounts, MappingQuestion, SheetImportPlan } from "@gdud/db/doch1-import";
import { Button } from "@gdud/ui";
import { applySheetImport, previewSheetImport } from "../../_actions/import";

const MAX_FILE_BYTES = 3.9 * 1024 * 1024;
const WARNINGS_SHOWN = 30;

type Answers = Record<MappingQuestion["kind"], Record<string, string>>;
const NO_ANSWERS: Answers = { tab: {}, platoon: {}, status: {} };

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
};
const KIND_TITLE: Record<MappingQuestion["kind"], string> = {
  tab: "לשונית",
  platoon: "מחלקה",
  status: "ערך בגיליון",
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
  const [pending, start] = useTransition();

  const formData = (current: Answers) => {
    const fd = new FormData();
    fd.set("file", file!);
    fd.set("mappings", JSON.stringify({ tabs: current.tab, platoons: current.platoon, statuses: current.status }));
    return fd;
  };

  /** Questions keep their suggestion as the default answer. */
  const withDefaults = (p: SheetImportPlan, current: Answers): Answers => {
    const next: Answers = { tab: { ...current.tab }, platoon: { ...current.platoon }, status: { ...current.status } };
    for (const q of p.questions) if (next[q.kind][q.key] === undefined && q.suggestion) next[q.kind][q.key] = q.suggestion;
    return next;
  };

  function preview(current: Answers) {
    if (!file) return;
    setError(undefined);
    setResult(null);
    start(async () => {
      const r = await previewSheetImport(formData(current));
      if (r.error !== undefined) {
        setError(r.error);
        return;
      }
      setPlan(r.data);
      setAnswers(withDefaults(r.data, current));
    });
  }

  function runImport() {
    if (!file) return;
    setError(undefined);
    start(async () => {
      const r = await applySheetImport(formData(answers));
      if (r.error !== undefined) {
        setError(r.error);
        return;
      }
      setResult(r.data);
      setPlan(null);
    });
  }

  function chooseFile(f: File | null) {
    setPlan(null);
    setResult(null);
    setAnswers(NO_ANSWERS);
    setError(f && f.size > MAX_FILE_BYTES ? "הקובץ גדול מדי (עד 3.9MB)" : undefined);
    setFile(f && f.size <= MAX_FILE_BYTES ? f : null);
  }

  const open = plan?.questions ?? [];

  return (
    <div className="flex flex-col gap-[22px]">
      <section className="tz-card flex flex-col gap-3 p-4">
        <p className="tz-footnote m-0">
          ייבוא הגיליון של {roundName} (קובץ ← הורדה ← Microsoft Excel). הקובץ נקרא בזיכרון בשרת ולא נשמר. בפלוגה עם ״דיווח באפליקציה מתאריך״ הייבוא
          לא משנה ימים מהתאריך הזה.
        </p>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="קובץ הגיליון"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="tinted" small disabled={!file || pending} onClick={() => preview(answers)}>
            {pending && !plan ? "קורא את הקובץ…" : plan ? "עדכון תצוגה" : "תצוגה מקדימה"}
          </Button>
          {plan ? (
            <Button type="button" small disabled={pending || open.length > 0} onClick={runImport}>
              {pending ? "מייבא…" : "ייבוא"}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="tz-alert tz-alert-error m-0">
            {error}
          </p>
        ) : null}
      </section>

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
