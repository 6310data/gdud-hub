"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button, Serial } from "@gdud/ui";
import { FilePicker } from "@/components/file-picker";
import { compareBrigadeFile, type BrigadeCompareResult, type BrigadeSoldier } from "../../_actions/call-up";
import { setEnlistment } from "../../_actions/members";

const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
type Result = Exclude<BrigadeCompareResult, { error: string }>;

/**
 * "השוואה לרשימת החטיבה": upload the brigade's list of who showed up (xlsx / csv, by מספר אישי) and
 * see where it differs from our סטטוס גיוס. Nothing is saved; "סימון התייצב" marks one soldier.
 */
export function BrigadeCompare({ arrivedOption, back }: { arrivedOption: { id: string; name: string } | null; back: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string>();
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [pending, start] = useTransition();

  function run(f: File | null) {
    setFile(f);
    setResult(null);
    setError(undefined);
    setMarked(new Set());
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    start(async () => {
      const r = await compareBrigadeFile(fd);
      if ("error" in r) setError(r.error);
      else setResult(r);
    });
  }

  function mark(personIds: string[]) {
    if (!arrivedOption) return;
    setError(undefined);
    start(async () => {
      for (const personId of personIds) {
        const r = await setEnlistment({ personId, optionId: arrivedOption.id });
        if (r?.error) return setError(r.error);
        setMarked((s) => new Set(s).add(personId));
      }
      router.refresh();
    });
  }

  const card = (personId: string) => `/doch1/soldiers/${personId}?back=${encodeURIComponent(back)}`;
  const open = result ? result.notMarked.filter((x) => !marked.has(x.personId)) : [];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="tz-section-header">השוואה לרשימת החטיבה</h2>
      <FilePicker
        file={file}
        onFile={run}
        accept={ACCEPT}
        busy={pending && !result}
        busyLabel="משווה…"
        hint="רשימת המתייצבים מהחטיבה: xlsx או csv עם עמודת ״מספר אישי״ (ואם יש — עמודת סטטוס). הקובץ נקרא בזיכרון ולא נשמר."
      />
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
      {result ? (
        <>
          <p className="tz-footnote m-0">
            <span className="tz-num">{result.rows}</span> שורות בקובץ{result.hasStatus ? " (לפי עמודת הסטטוס)" : " (כל שורה = התייצב)"} · מתאימים{" "}
            <span className="tz-num">{result.agree}</span>
          </p>
          {result.warnings.map((w) => (
            <p key={w} className="tz-alert m-0">
              {w}
            </p>
          ))}

          <Group
            title="התייצבו לפי החטיבה ולא סומנו אצלנו"
            count={open.length}
            action={
              arrivedOption && open.length > 1 ? (
                <Button type="button" variant="tinted" small loading={pending} onClick={() => mark(open.map((x) => x.personId))}>
                  סימון כולם {arrivedOption.name}
                </Button>
              ) : null
            }
          >
            {open.map((x) => (
              <SoldierLine key={x.personId} x={x} href={card(x.personId)}>
                {arrivedOption ? (
                  <Button type="button" variant="plain" small disabled={pending} onClick={() => mark([x.personId])}>
                    סימון {arrivedOption.name}
                  </Button>
                ) : null}
              </SoldierLine>
            ))}
          </Group>

          <Group title="סומנו התייצב אצלנו ולא התייצבו לפי החטיבה" count={result.notInBrigade.length}>
            {result.notInBrigade.map((x) => (
              <SoldierLine key={x.personId} x={x} href={card(x.personId)} />
            ))}
          </Group>

          <Group title="ברשימת החטיבה ולא חיילים בסבב" count={result.unknown.length}>
            {result.unknown.map((r) => (
              <div key={r.line} className="tz-row">
                <span className="tz-row-body">
                  <span className="tz-row-title">{r.name || "ללא שם"}</span>
                  <span className="tz-row-value flex items-center gap-2">
                    {r.status ? <span>{r.status}</span> : null}
                    <Serial>{r.personalNumber}</Serial>
                    <span className="tz-footnote">שורה {r.line}</span>
                  </span>
                </span>
              </div>
            ))}
          </Group>
        </>
      ) : null}
    </section>
  );
}

function Group({ title, count, action, children }: { title: string; count: number; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="tz-headline">
          {title} · <span className="tz-num">{count}</span>
        </span>
        {action}
      </div>
      {count ? <div className="tz-group">{children}</div> : <p className="tz-footnote m-0 px-1">אין.</p>}
    </div>
  );
}

function SoldierLine({ x, href, children }: { x: BrigadeSoldier; href: string; children?: ReactNode }) {
  return (
    <div className="tz-row">
      <span className="tz-row-body">
        <span className="flex min-w-0 flex-col">
          <Link href={href} className="font-semibold text-ink">
            {x.name}
          </Link>
          <span className="tz-footnote">
            {[x.unit, `אצלנו: ${x.ours ?? "לא סומן"}`, x.theirs ? `בחטיבה: ${x.theirs}` : x.line ? null : "לא ברשימת החטיבה"].filter(Boolean).join(" · ")}
          </span>
        </span>
        {children}
      </span>
    </div>
  );
}
