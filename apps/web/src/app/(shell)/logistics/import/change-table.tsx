/**
 * The preview table of an import: one section per group, each line with a checkbox (when it can
 * be chosen), what kind of change it is, where it is in the sheet and before → after.
 * Generic over PreviewLine so other imports (דוח 1) can reuse it.
 */
import type { CSSProperties, ReactNode } from "react";
import type { LineGroup, LineKind, PreviewLine } from "@gdud/db/logistics-sheet";
import { MSG } from "@gdud/db/logistics-sheet/preview";
import { Chip, Serial } from "@gdud/ui";

const SECTIONS: { group: LineGroup; title: string; hint: string }[] = [
  { group: "change", title: "ישתנו", hint: "הגיליון שונה מהאפליקציה. בטלו סימון כדי להשאיר את הערך שבאפליקציה." },
  { group: "new", title: "חדשים", hint: "קיימים בגיליון, חסרים באפליקציה." },
  { group: "appOnly", title: "רק באפליקציה", hint: "קיימים באפליקציה ואינם בגיליון. לא יוסרו אלא אם תסמנו." },
  { group: "error", title: "לא נקראו", hint: "לא ייובאו. תקנו בגיליון והעלו שוב." },
];

const KIND_LABEL: Partial<Record<LineKind, string>> = {
  "item.update": "קטלוג",
  "serial.condition": "מצב",
  "assignment.transfer": "העברה",
  "assignment.kit": "ציוד משלים",
  "assignment.return": "זיכוי",
  "storage.release": "שחרור מאפסון",
  "serial.delete": "מחיקה",
  "kit.remove": "הסרה מהתקן",
  "log.add": "היסטוריה",
};
const GROUP_LABEL: Record<LineGroup, string> = { new: "חדש", change: "שינוי", appOnly: "רק באפליקציה", error: "שגיאה" };
const DANGER_CHIP: CSSProperties = { background: "var(--danger-soft)", color: "var(--danger)" };

/** Rows for a soldier missing from the app are grouped per soldier. */
const NO_SOLDIER = MSG.noSoldier;

export interface ChangeTableProps {
  lines: PreviewLine[];
  selected: ReadonlySet<string>;
  onToggle(id: string): void;
}

export function ChangeTable({ lines, selected, onToggle }: ChangeTableProps) {
  const sections = SECTIONS.map((s) => ({ ...s, lines: lines.filter((l) => l.group === s.group) })).filter((s) => s.lines.length);
  if (!sections.length) return <div className="p-6 text-center text-[15px] text-ink-muted">אין שינויים בלשונית הזו</div>;
  return (
    <div className="tz-table-wrap">
      <table className="tz-table">
        <thead>
          <tr>
            <th aria-label="ייבוא" />
            <th>שינוי</th>
            <th>שורה</th>
            <th>פריט</th>
            <th>צ׳</th>
            <th>חייל</th>
            <th>באפליקציה עכשיו ← אחרי הייבוא</th>
          </tr>
        </thead>
        {sections.map((s) => (
          <tbody key={s.group}>
            <tr className="tz-group-row">
              <th colSpan={7}>
                {s.title} ({s.lines.length}) · <span className="font-normal">{s.hint}</span>
              </th>
            </tr>
            {s.group === "error" ? <ErrorRows lines={s.lines} /> : s.lines.map((l) => <LineRow key={l.id} line={l} on={selected.has(l.id)} onToggle={onToggle} />)}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function LineRow({ line: l, on, onToggle }: { line: PreviewLine; on: boolean; onToggle(id: string): void }) {
  const dim = l.selectable && !on;
  return (
    <tr className={dim ? "opacity-55" : undefined}>
      <td>
        {l.selectable ? (
          <input type="checkbox" checked={on} onChange={() => onToggle(l.id)} aria-label={`ייבוא ${l.item ?? ""} ${l.serial ?? ""}`} />
        ) : null}
      </td>
      <td>
        <Badge line={l} />
      </td>
      <td className="tz-num">{l.row ?? "—"}</td>
      <td>{l.item ?? "—"}</td>
      <td>{l.serial ? <Serial>{l.serial}</Serial> : "—"}</td>
      <td>{l.personName ?? "—"}</td>
      <td className="whitespace-normal">
        <Change line={l} />
      </td>
    </tr>
  );
}

function Badge({ line }: { line: PreviewLine }) {
  const label = KIND_LABEL[line.kind] ?? GROUP_LABEL[line.group];
  if (line.group === "error") return <span className="tz-chip" style={DANGER_CHIP}>{label}</span>;
  const tone = line.group === "new" ? "ok" : line.group === "change" ? "broken" : "brigade";
  return <Chip tone={tone}>{label}</Chip>;
}

function Change({ line: l }: { line: PreviewLine }): ReactNode {
  if (l.group === "error") return <span>{l.message}</span>;
  if (l.group === "appOnly") {
    if (!l.selectable) return <span className="text-ink-muted">{l.message ?? "יישאר כמו שהוא"}</span>;
    return (
      <span>
        {l.before ? <s className="text-ink-muted">{l.before}</s> : null} <span className="text-ink-muted">יישאר כמו שהוא (סמנו כדי להסיר)</span>
      </span>
    );
  }
  const after = l.after ?? (l.group === "new" ? "יתווסף" : "");
  return (
    <span>
      {l.before !== null ? (
        <>
          <s className="text-ink-muted">{l.before || "ריק"}</s> ←{" "}
        </>
      ) : null}
      <span className="font-semibold">{after || "ריק"}</span>
      {l.message ? <span className="tz-footnote block">{l.message}</span> : null}
    </span>
  );
}

/** Error rows; rows for the same soldier missing from the app collapse into one row with a count. */
function ErrorRows({ lines }: { lines: PreviewLine[] }) {
  const bySoldier = new Map<string, PreviewLine[]>();
  const other: PreviewLine[] = [];
  for (const l of lines) {
    if (l.message === NO_SOLDIER && l.personName) bySoldier.set(l.personName, [...(bySoldier.get(l.personName) ?? []), l]);
    else other.push(l);
  }
  return (
    <>
      {[...bySoldier].map(([name, rows]) => (
        <tr key={`soldier:${name}`}>
          <td />
          <td>
            <span className="tz-chip" style={DANGER_CHIP}>
              חייל חסר
            </span>
          </td>
          <td className="tz-num whitespace-normal">{rows.map((r) => r.row).join(", ")}</td>
          <td colSpan={2} className="text-ink-muted">
            {rows.length} שורות
          </td>
          <td className="font-semibold">{name}</td>
          <td className="whitespace-normal">{NO_SOLDIER}</td>
        </tr>
      ))}
      {other.map((l) => (
        <LineRow key={l.id} line={l} on={false} onToggle={() => undefined} />
      ))}
    </>
  );
}
