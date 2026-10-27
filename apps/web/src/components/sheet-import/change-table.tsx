/**
 * The preview table of a sheet import: one section per group, each line with a checkbox (when it
 * can be chosen), what kind of change it is, where it is in the sheet and before → after.
 * Generic over the module (logistics, kesher): the caller passes the labels of its change kinds.
 */
import type { CSSProperties, ReactNode } from "react";
import type { LineGroup, PreviewLineBase } from "@gdud/db/sheet-import/preview";
import { Chip, Serial } from "@gdud/ui";

const SECTIONS: { group: LineGroup; title: string; hint: string }[] = [
  { group: "change", title: "ישתנו", hint: "הגיליון שונה מהאפליקציה. בטלו סימון כדי להשאיר את הערך שבאפליקציה." },
  { group: "new", title: "חדשים", hint: "קיימים בגיליון, חסרים באפליקציה." },
  { group: "appOnly", title: "רק באפליקציה", hint: "קיימים באפליקציה ואינם בגיליון. לא יוסרו אלא אם תסמנו." },
  { group: "error", title: "לא נקראו", hint: "לא ייובאו. תקנו בגיליון והעלו שוב." },
];

const GROUP_LABEL: Record<LineGroup, string> = { new: "חדש", change: "שינוי", appOnly: "רק באפליקציה", error: "שגיאה" };
const DANGER_CHIP: CSSProperties = { background: "var(--danger-soft)", color: "var(--danger)" };

export interface ChangeTableProps {
  lines: PreviewLineBase[];
  selected: ReadonlySet<string>;
  onToggle(id: string): void;
  /** the module's change kinds → the chip label (other kinds show the group) */
  kindLabels: Readonly<Record<string, string>>;
  /** error lines with this message (a soldier missing from the app) collapse into one row per soldier */
  missingSoldier?: string;
  /** an ambiguous soldier was picked (key from the line's `pick`) */
  onPick?(key: string, personId: string): void;
}

export function ChangeTable({ lines, selected, onToggle, kindLabels, missingSoldier, onPick }: ChangeTableProps) {
  const sections = SECTIONS.map((s) => ({ ...s, lines: lines.filter((l) => l.group === s.group) })).filter((s) => s.lines.length);
  if (!sections.length) return <div className="p-6 text-center text-[15px] text-ink-muted">אין שינויים בלשונית הזו</div>;
  const row = (l: PreviewLineBase, on: boolean, toggle: (id: string) => void) => (
    <LineRow key={l.id} line={l} on={on} onToggle={toggle} kindLabels={kindLabels} onPick={onPick} />
  );
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
            {s.group === "error" ? (
              <ErrorRows lines={s.lines} missingSoldier={missingSoldier} row={row} />
            ) : (
              s.lines.map((l) => row(l, selected.has(l.id), onToggle))
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}

interface LineRowProps {
  line: PreviewLineBase;
  on: boolean;
  onToggle(id: string): void;
  kindLabels: Readonly<Record<string, string>>;
  onPick?(key: string, personId: string): void;
}

function LineRow({ line: l, on, onToggle, kindLabels, onPick }: LineRowProps) {
  const dim = l.selectable && !on;
  return (
    <tr className={dim ? "opacity-55" : undefined}>
      <td>
        {l.selectable ? (
          <input type="checkbox" checked={on} onChange={() => onToggle(l.id)} aria-label={`ייבוא ${l.item ?? ""} ${l.serial ?? ""}`} />
        ) : null}
      </td>
      <td>
        <Badge line={l} label={kindLabels[l.kind] ?? GROUP_LABEL[l.group]} />
      </td>
      <td className="tz-num">{l.row ?? "—"}</td>
      <td>{l.item ?? "—"}</td>
      <td>{l.serial ? <Serial>{l.serial}</Serial> : "—"}</td>
      <td>{l.personName ?? "—"}</td>
      <td className="whitespace-normal">
        <Change line={l} />
        {l.pick && onPick ? <PickSoldier pick={l.pick} onPick={onPick} /> : null}
      </td>
    </tr>
  );
}

function Badge({ line, label }: { line: PreviewLineBase; label: string }) {
  if (line.group === "error") return <span className="tz-chip" style={DANGER_CHIP}>{label}</span>;
  const tone = line.group === "new" ? "ok" : line.group === "change" ? "broken" : "brigade";
  return <Chip tone={tone}>{label}</Chip>;
}

function Change({ line: l }: { line: PreviewLineBase }): ReactNode {
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

/** A name that matches several soldiers: the admin picks one, for this import only. */
function PickSoldier({ pick, onPick }: { pick: NonNullable<PreviewLineBase["pick"]>; onPick(key: string, personId: string): void }) {
  return (
    <select
      className="tz-input mt-1.5 min-h-[34px] text-[14px]"
      value={pick.chosen ?? ""}
      onChange={(e) => e.target.value && onPick(pick.key, e.target.value)}
      aria-label="בחירת החייל"
    >
      <option value="">בחרו את החייל…</option>
      {pick.choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

/** Error rows; rows for the same soldier missing from the app collapse into one row with a count. */
function ErrorRows({
  lines,
  missingSoldier,
  row,
}: {
  lines: PreviewLineBase[];
  missingSoldier?: string;
  row(l: PreviewLineBase, on: boolean, toggle: (id: string) => void): ReactNode;
}) {
  const bySoldier = new Map<string, PreviewLineBase[]>();
  const other: PreviewLineBase[] = [];
  for (const l of lines) {
    if (missingSoldier && l.message === missingSoldier && l.personName && !l.pick) {
      bySoldier.set(l.personName, [...(bySoldier.get(l.personName) ?? []), l]);
    } else other.push(l);
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
          <td className="whitespace-normal">{missingSoldier}</td>
        </tr>
      ))}
      {other.map((l) => row(l, false, () => undefined))}
    </>
  );
}
