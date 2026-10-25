"use client";
/**
 * ייבוא מהגיליון: upload → choose tabs → preview → result. The File stays in this component's
 * state and is re-sent with every step; the server stores nothing in between.
 */
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ApplyResult, PreviewLine, SheetKey, XlsxTab } from "@gdud/db/logistics-sheet";
import { carryTicks, checkUploadFile } from "@gdud/db/logistics-sheet/preview";
import { Button, Steps, type StepItem } from "@gdud/ui";
import { FilePicker } from "@/components/file-picker";
import { applySheetImport, inspectSheetFile, previewSheetImport, type PreviewData } from "../_actions/sheet-import";
import type { ActionOutcome } from "@/lib/action-result";
import { ChangeTable } from "./change-table";
import { STALE_PREVIEW } from "./messages";

type Step = "upload" | "tabs" | "preview" | "result";
const WIZARD: Array<{ id: Step; label: string; working: string }> = [
  { id: "upload", label: "העלאת הקובץ", working: "קורא את הקובץ…" },
  { id: "tabs", label: "בחירת לשוניות", working: "" },
  { id: "preview", label: "בדיקת השינויים", working: "משווה את הגיליון לאפליקציה…" },
  { id: "result", label: "ייבוא", working: "כותב את השינויים…" },
];

/** Where the admin is; while a request runs, the step it produces spins. */
function wizardSteps(step: Step, busy: Step | null): StepItem[] {
  const at = WIZARD.findIndex((w) => w.id === step);
  const working = busy ? WIZARD.findIndex((w) => w.id === busy) : -1;
  const current = working >= 0 ? working : at;
  return WIZARD.map((w, i) => ({
    id: w.id,
    label: w.label,
    state: step === "result" || i < current ? "done" : i === working ? "active" : i === current ? "current" : "waiting",
    detail: i === working ? w.working : undefined,
  }));
}

const DEFAULT_TABS: readonly SheetKey[] = ["serials", "assignments", "storage"];

/** An action call that never throws: a rejected request (too large, network) becomes a Hebrew error. */
async function safe<T>(call: () => Promise<ActionOutcome<T>>): Promise<ActionOutcome<T>> {
  try {
    return await call();
  } catch {
    return { error: "הבקשה לא הגיעה לשרת – בדקו את החיבור ואת גודל הקובץ (עד 4MB) ונסו שוב" };
  }
}

const count = (lines: readonly PreviewLine[], pred: (l: PreviewLine) => boolean) => lines.filter(pred).length;

export function ImportFlow() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  /** the file being read, before the server accepted it */
  const [picked, setPicked] = useState<File | null>(null);
  const [tabs, setTabs] = useState<XlsxTab[]>([]);
  const [chosen, setChosen] = useState<ReadonlySet<SheetKey>>(new Set());
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<SheetKey | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  /** the step the running request produces */
  const [busy, setBusy] = useState<Step>("upload");

  /** chosen tabs in the workbook's order; the אלפון is always read (lookup only) and never chosen */
  const chosenTabs = tabs.flatMap((t) => (t.key && chosen.has(t.key) ? [t.key] : []));

  const form = (extra: Record<string, readonly string[]> = {}) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    for (const [k, values] of Object.entries(extra)) for (const v of values) fd.append(k, v);
    return fd;
  };

  function pickFile(f: File | null) {
    setError(undefined);
    if (!f) return;
    const problem = checkUploadFile(f);
    if (problem) return setError(problem);
    setPicked(f);
    setBusy("upload");
    start(async () => {
      const fd = new FormData();
      fd.append("file", f);
      const r = await safe(() => inspectSheetFile(fd));
      if (!r.ok) return setError(r.error);
      setFile(f);
      setTabs(r.data.tabs);
      setChosen(new Set(r.data.tabs.flatMap((t) => (t.key && DEFAULT_TABS.includes(t.key) ? [t.key] : []))));
      setStep("tabs");
    });
  }

  function showPreview() {
    setError(undefined);
    setBusy("preview");
    start(async () => {
      const r = await safe(() => previewSheetImport(form({ tabs: chosenTabs })));
      if (!r.ok) return setError(r.error);
      setPreview(r.data);
      // "הצג שוב" keeps what the admin unticked; only lines that are new get their default
      setSelected(carryTicks(preview ? { lines: preview.lines, selected } : null, r.data.lines));
      setActive(chosenTabs.find((k) => r.data.lines.some((l) => l.sheet === k)) ?? chosenTabs[0] ?? null);
      setStep("preview");
    });
  }

  function apply() {
    if (!preview) return;
    setError(undefined);
    setBusy("result");
    start(async () => {
      const r = await safe(() => applySheetImport(form({ tabs: chosenTabs, selected: [...selected], fingerprint: [preview.fingerprint] })));
      if (!r.ok) return setError(r.error);
      setResult(r.data);
      setStep("result");
    });
  }

  function restart() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(undefined);
  }

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="tz-card overflow-hidden" aria-live="polite">
        <Steps steps={wizardSteps(step, pending ? busy : null)} label="שלבי הייבוא" row />
      </div>
      {error ? (
        <div role="alert" className="tz-alert tz-alert-error m-0 flex flex-wrap items-center gap-3">
          <span className="flex-1">{error}</span>
          {error === STALE_PREVIEW ? (
            <Button type="button" small onClick={showPreview} loading={pending}>
              הצג שוב
            </Button>
          ) : null}
        </div>
      ) : null}

      {step === "upload" ? <UploadStep pending={pending} file={pending ? picked : null} onFile={pickFile} /> : null}

      {step === "tabs" ? (
        <section className="tz-card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1 font-semibold">
              {file?.name} <span className="tz-footnote">· {tabs.length} לשוניות נמצאו</span>
            </span>
            <Button type="button" variant="plain" small onClick={restart}>
              החלפה
            </Button>
          </div>
          <h2 className="tz-headline">אילו לשוניות לייבא?</h2>
          <div className="flex flex-col">
            {tabs.map((t) => (
              <TabRow
                key={t.name}
                tab={t}
                on={t.key === "people" || (t.key !== null && chosen.has(t.key))}
                onToggle={(k) =>
                  setChosen((cur) => {
                    const next = new Set(cur);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return next;
                  })
                }
              />
            ))}
          </div>
          <p className="tz-footnote m-0">הגיליון לא משתנה. הייבוא רק מעדכן את האפליקציה לפי הגיליון.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={showPreview} disabled={chosenTabs.length === 0} loading={pending}>
              {pending ? "בודק…" : "הצג מה ישתנה"}
            </Button>
            <Link href="/logistics" className="tz-btn tz-btn-plain">
              ביטול
            </Link>
          </div>
        </section>
      ) : null}

      {step === "preview" && preview ? (
        <PreviewStep
          preview={preview}
          tabs={tabs.filter((t) => t.key && chosenTabs.includes(t.key))}
          active={active}
          onActive={setActive}
          selected={selected}
          onToggle={toggle}
          pending={pending}
          onBack={() => setStep("tabs")}
          onApply={apply}
        />
      ) : null}

      {step === "result" && result && preview ? <ResultStep result={result} lines={preview.lines} onAgain={restart} /> : null}
    </div>
  );
}

function UploadStep({ pending, file, onFile }: { pending: boolean; file: File | null; onFile(f: File | null): void }) {
  return (
    <section className="tz-card flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="tz-headline">איך מורידים את הגיליון</h2>
        <ol className="m-0 flex list-decimal flex-col gap-0.5 ps-5 text-[15px]">
          <li>פותחים את &quot;לוגיסטיקה גדודית&quot; ב-Google Sheets</li>
          <li>קובץ ← הורדה ← Microsoft Excel (&lrm;.xlsx)</li>
          <li>מעלים את הקובץ כאן. הקובץ לא נשמר באפליקציה.</li>
        </ol>
      </div>
      <FilePicker file={file} onFile={onFile} busy={pending} disabled={pending} hint="קובץ ‎.xlsx עד 4MB" />
    </section>
  );
}

function TabRow({ tab: t, on, onToggle }: { tab: XlsxTab; on: boolean; onToggle(k: SheetKey): void }) {
  const lookupOnly = t.key === "people";
  const sub = t.key === null ? "לא נתמך" : lookupOnly ? `${t.rows} שורות · לאיתור מספר אישי בלבד` : `${t.rows} שורות`;
  return (
    <label className={`flex items-center gap-3 border-b border-separator py-2.5 last:border-0 ${t.key && !lookupOnly ? "cursor-pointer" : "opacity-55"}`}>
      <input type="checkbox" checked={on} disabled={!t.key || lookupOnly} onChange={() => t.key && onToggle(t.key)} aria-label={t.name} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px]">{t.name}</span>
        <span className="text-xs text-ink-muted">{sub}</span>
      </span>
    </label>
  );
}

interface PreviewStepProps {
  preview: PreviewData;
  tabs: XlsxTab[];
  active: SheetKey | null;
  onActive(k: SheetKey): void;
  selected: ReadonlySet<string>;
  onToggle(id: string): void;
  pending: boolean;
  onBack(): void;
  onApply(): void;
}

function PreviewStep({ preview, tabs, active, onActive, selected, onToggle, pending, onBack, onApply }: PreviewStepProps) {
  const lines = preview.lines;
  const shown = lines.filter((l) => l.sheet === active);
  const selectable = count(lines, (l) => l.selectable);
  const ticked = selected.size;
  const skipped = count(lines, (l) => l.group === "error") + selectable - ticked;
  const summary = [
    [count(shown, (l) => l.group === "new"), "חדשים"],
    [count(shown, (l) => l.group === "change"), "ישתנו"],
    [count(shown, (l) => l.group === "appOnly"), "רק באפליקציה"],
    [count(shown, (l) => l.group === "error"), "לא נקראו"],
    [active ? (preview.identical[active] ?? 0) : 0, "זהים, לא יגעו בהם"],
  ] as const;

  return (
    <>
      <section className="tz-card flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="tz-headline flex-1">תצוגה מקדימה</h2>
          <span className="tz-footnote">שום דבר עוד לא נשמר</span>
        </div>
        <nav className="tz-pills" aria-label="לשונית">
          {tabs.map((t) => (
            <button key={t.name} type="button" className="tz-pill" aria-pressed={t.key === active} onClick={() => t.key && onActive(t.key)}>
              {t.name} <span className="tz-pill-count">{count(lines, (l) => l.sheet === t.key)}</span>
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {summary.map(([n, label]) => (
            <span key={label} className="text-[14px]">
              <span className="tz-num font-semibold">{n}</span> <span className="text-ink-muted">{label}</span>
            </span>
          ))}
        </div>
      </section>
      <div className="tz-card overflow-hidden">
        <ChangeTable lines={shown} selected={selected} onToggle={onToggle} />
      </div>
      <div className="tz-card sticky bottom-3 flex flex-wrap items-center gap-3 p-3">
        <span className="flex-1 text-[14px]">
          <span className="tz-num font-semibold">{ticked}</span> שינויים מסומנים מתוך <span className="tz-num">{selectable}</span> ·{" "}
          <span className="tz-num">{skipped}</span> שורות לא ייובאו
        </span>
        <Button type="button" variant="plain" onClick={onBack} disabled={pending}>
          חזרה
        </Button>
        <Button type="button" onClick={onApply} disabled={ticked === 0} loading={pending}>
          {pending ? "מייבא…" : `ייבא ${ticked} שינויים`}
        </Button>
      </div>
    </>
  );
}

function ResultStep({ result, lines, onAgain }: { result: ApplyResult; lines: PreviewLine[]; onAgain(): void }) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const a = result.applied;
  return (
    <section className="tz-card flex flex-col gap-3 p-4">
      <p role="status" className="tz-alert tz-alert-ok m-0">
        הייבוא נשמר · חדשים {a.new} · שינויים {a.change} · הוסרו {a.appOnly}
      </p>
      {result.blocked.length ? (
        <>
          <h2 className="tz-headline">לא יובאו ({result.blocked.length})</h2>
          <ul className="m-0 flex flex-col gap-1 ps-5 text-[14px]">
            {result.blocked.map((b) => {
              const l = byId.get(b.id);
              return (
                <li key={b.id}>
                  {[l?.item, l?.serial, l?.personName].filter(Boolean).join(" · ") || b.id}
                  {l?.row ? ` (שורה ${l.row})` : ""} — {b.reason}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link href="/logistics/log?kind=sheet_import" className="tz-btn tz-btn-tinted">
          ללוג
        </Link>
        <Button type="button" variant="plain" onClick={onAgain}>
          ייבוא נוסף
        </Button>
      </div>
    </section>
  );
}
