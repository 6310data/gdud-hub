import Link from "next/link";
import { EVENT_LABEL, type EventKind } from "@gdud/core";
import type { schema } from "@gdud/db";
import { Serial, type IconName } from "@gdud/ui";
import { fmtWhen } from "@/lib/logistics/format";
import { Empty, SmallTile } from "./ui";

type EventRow = typeof schema.logisticsEvents.$inferSelect;

const KIND_TILE: Partial<Record<EventKind, { color: string; icon: IconName }>> = {
  sign: { color: "var(--primary)", icon: "pencil" },
  return: { color: "var(--tile-ok)", icon: "undo" },
  transfer: { color: "var(--tile-neutral)", icon: "swap" },
  serials_add: { color: "var(--tile-ok)", icon: "plus" },
  item_add: { color: "var(--tile-ok)", icon: "plus" },
  serial_remove: { color: "var(--tile-document)", icon: "trash" },
  condition: { color: "var(--tile-broken)", icon: "wrench" },
  store: { color: "var(--tile-brigade)", icon: "archive" },
  release: { color: "var(--tile-brigade)", icon: "archive" },
  holdings_form: { color: "var(--tile-document)", icon: "doc" },
};
const DEFAULT_TILE = { color: "var(--tile-neutral)", icon: "list" as IconName };

export function EventsTable({ rows, showDetails = false }: { rows: EventRow[]; showDetails?: boolean }) {
  if (!rows.length) return <Empty>אין פעולות עדיין</Empty>;
  const now = new Date();
  return (
    <table className="tz-table">
      <thead>
        <tr>
          <th scope="col">פעולה</th>
          <th scope="col">חייל</th>
          <th scope="col">ציוד</th>
          {showDetails ? <th scope="col">פרטים</th> : null}
          <th scope="col">בוצע ע״י</th>
          <th scope="col">זמן</th>
          <th scope="col">
            <span className="sr-only">טופס</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const tile = KIND_TILE[e.kind] ?? DEFAULT_TILE;
          return (
            <tr key={e.id}>
              <td>
                <span className="inline-flex items-center gap-2">
                  <SmallTile color={tile.color} icon={tile.icon} size={22} />
                  {EVENT_LABEL[e.kind]}
                </span>
              </td>
              <td>
                {e.personId && e.personName ? (
                  <Link href={`/logistics/people?person=${e.personId}`}>{e.personName}</Link>
                ) : (
                  <span className="text-ink-muted">{e.personName ?? "—"}</span>
                )}
              </td>
              <td>
                {e.item ?? ""}
                {e.serial ? (
                  <>
                    {" "}
                    <Serial>{e.serial}</Serial>
                  </>
                ) : null}
              </td>
              {showDetails ? <td className="max-w-[360px] truncate whitespace-normal text-[13px] text-ink-muted">{e.details}</td> : null}
              <td className="text-ink-muted">{e.actorName ?? "—"}</td>
              <td className="text-ink-muted">{fmtWhen(e.at, now)}</td>
              <td>
                {e.formId ? (
                  <Link href={`/logistics/forms/${e.formId}`} className="text-[13px] font-semibold">
                    טופס
                  </Link>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
