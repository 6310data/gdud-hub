/** The יומן table (also the overview's "חתימות אחרונות"). */
import { KESHER_EVENT_LABEL, type KesherEventKind } from "@gdud/core";
import { Chip, Serial } from "@gdud/ui";
import { Empty } from "@/components/page-parts";
import { fmtWhen } from "@/lib/logistics/format";

export interface EventRow {
  id: number;
  at: Date;
  kind: KesherEventKind;
  company: string | null;
  personName: string | null;
  personRole: string | null;
  actorName: string | null;
  sheetActor: string | null;
  item: string | null;
  serial: string | null;
  qty: number | null;
  details: string | null;
  backdated: boolean;
}

const TONE: Partial<Record<KesherEventKind, "ok" | "brigade" | "signed" | "admin" | "broken">> = {
  sign: "signed",
  credit: "brigade",
  intake: "ok",
  assign: "signed",
  import: "admin",
  legacy: "admin",
};

export function EventsTable({ rows, compact, now = new Date() }: { rows: readonly EventRow[]; compact?: boolean; now?: Date }) {
  if (!rows.length) return <Empty>אין רישום תואם</Empty>;
  return (
    <table className="tz-table">
      <thead>
        <tr>
          <th>מתי</th>
          <th>פלוגה</th>
          <th>חותם</th>
          {compact ? null : <th>מחתים</th>}
          <th>פריט</th>
          {compact ? null : <th>כמות</th>}
          <th>פעולה</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="whitespace-nowrap text-ink-muted">
              {fmtWhen(r.at, now)}
              {r.backdated ? <span className="tz-row-sub text-xs">רטרואקטיבי</span> : null}
            </td>
            <td>{r.company ?? "—"}</td>
            <td>
              {r.personName ?? "—"}
              {!compact && r.personRole ? <span className="tz-row-sub text-xs">{r.personRole}</span> : null}
            </td>
            {compact ? null : <td>{r.sheetActor ?? r.actorName ?? "—"}</td>}
            <td className="whitespace-normal">
              {r.item ?? (r.kind === "import" ? r.details : "—")} {r.serial ? <Serial>{r.serial}</Serial> : null}
            </td>
            {compact ? null : <td className="tz-num">{r.qty ?? ""}</td>}
            <td>
              <Chip tone={TONE[r.kind] ?? "signed"}>{r.kind === "legacy" && r.details ? r.details : KESHER_EVENT_LABEL[r.kind]}</Chip>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
