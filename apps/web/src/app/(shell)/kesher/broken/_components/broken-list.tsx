"use client";
/**
 * The תקול צ׳ (grouped by device type) and ציוד משלים: pick what was fixed and mark it תקין, or go
 * to זיכוי לחטיבה to send it back.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { Button, Serial } from "@gdud/ui";
import { Empty, Panel } from "@/components/page-parts";
import { fmtCount } from "@/lib/logistics/format";
import { setCondition } from "../../_actions/moves";
import { ErrorAlert, qtyOf, QtyInput, Toast, useToast } from "../../brigade/_components/shared";

export interface BrokenSerial {
  id: string;
  serial: string;
  item: string;
  /** במחסן / the company / ללא שיוך */
  place: string;
  inWarehouse: boolean;
}
export interface BrokenBulk {
  id: string;
  name: string;
  category: string | null;
  broken: number;
}

export function BrokenList({ serials, bulk }: { serials: BrokenSerial[]; bulk: BrokenBulk[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [toast, setToast] = useToast();
  const [pending, start] = useTransition();

  const groups = useMemo(() => {
    const out = new Map<string, BrokenSerial[]>();
    for (const x of serials) {
      const g = out.get(x.item);
      if (g) g.push(x);
      else out.set(x.item, [x]);
    }
    return [...out];
  }, [serials]);

  const toggle = (ids: readonly string[], on: boolean) =>
    setChosen((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const lines = bulk.map((b) => ({ b, qty: qtyOf(qty[b.id]) }));
  const bad = lines.filter((l) => Number.isNaN(l.qty) || l.qty > l.b.broken);
  const fixedUnits = lines.reduce((n, l) => n + (l.qty > 0 ? l.qty : 0), 0);
  const ids = [...chosen].filter((id) => serials.some((x) => x.id === id));

  function fix() {
    setError(undefined);
    if (bad.length) return setError(bad.map((l) => `${l.b.name}: במחסן ${l.b.broken} תקולים`).join("\n"));
    if (!ids.length && !fixedUnits) return setError("לא נבחר ציוד");
    start(async () => {
      const r = await setCondition({ broken: false, serialIds: ids, lines: lines.filter((l) => l.qty > 0).map((l) => ({ itemId: l.b.id, qty: l.qty })), notes: notes.trim() || null });
      if (!r.ok) return setError(r.error);
      setToast(`סומנו כתקינים: ${[ids.length ? `${fmtCount(ids.length)} צ׳` : "", fixedUnits ? `${fmtCount(fixedUnits)} יח׳ ציוד משלים` : ""].filter(Boolean).join(" · ")}`);
      setChosen(new Set());
      setQty({});
      setNotes("");
      router.refresh();
    });
  }

  if (!serials.length && !bulk.length) {
    return (
      <>
        <Panel title="ציוד תקול">
          <Empty>אין ציוד תקול במחסן</Empty>
        </Panel>
        <Toast msg={toast} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {serials.length ? (
        <Panel title={`צ׳ תקולים · ${fmtCount(ids.length)}/${fmtCount(serials.length)} נבחרו`} bodyClassName="tz-table-wrap">
          <table className="tz-table">
            <thead>
              <tr>
                <th aria-label="בחירה" />
                <th>צ׳</th>
                <th>מיקום</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([type, list]) => {
                const groupIds = list.map((x) => x.id);
                const on = groupIds.filter((id) => chosen.has(id)).length;
                return (
                  <Fragment key={type}>
                    <tr className="tz-group-row">
                      <th colSpan={3}>
                        <span className="flex items-center justify-between gap-2">
                          <span>
                            {type} <span className="tz-num font-normal">· {fmtCount(list.length)}</span>
                          </span>
                          <button type="button" className="tz-btn tz-btn-plain tz-btn-sm min-h-0 px-0 py-0" onClick={() => toggle(groupIds, on < groupIds.length)} disabled={pending}>
                            {on < groupIds.length ? "בחירת הקבוצה" : "ביטול הקבוצה"}
                          </button>
                        </span>
                      </th>
                    </tr>
                    {list.map((x) => (
                      <tr key={x.id} data-selected={chosen.has(x.id) || undefined} className="tz-hover" onClick={() => !pending && toggle([x.id], !chosen.has(x.id))}>
                        <td className="w-10">
                          <input
                            type="checkbox"
                            className="size-5"
                            checked={chosen.has(x.id)}
                            onChange={(e) => toggle([x.id], e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={pending}
                            aria-label={`${x.item} ${x.serial}`}
                          />
                        </td>
                        <td>
                          <Serial>{x.serial}</Serial>
                        </td>
                        <td className={x.inWarehouse ? "text-ink-muted" : ""}>{x.place}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ) : null}

      {bulk.length ? (
        <Panel title="ציוד משלים תקול" bodyClassName="tz-table-wrap">
          <table className="tz-table">
            <thead>
              <tr>
                <th>פריט</th>
                <th>קטגוריה</th>
                <th>תקול</th>
                <th>תוקנו</th>
              </tr>
            </thead>
            <tbody>
              {bulk.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td className="text-ink-muted">{b.category ?? "—"}</td>
                  <td className="tz-num font-semibold">{fmtCount(b.broken)}</td>
                  <td>
                    <span className="flex items-center gap-2">
                      <QtyInput value={qty[b.id] ?? ""} max={b.broken} label={`${b.name} · תוקנו`} onChange={(v) => setQty((cur) => ({ ...cur, [b.id]: v }))} disabled={pending} />
                      <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-1" onClick={() => setQty((cur) => ({ ...cur, [b.id]: String(b.broken) }))} disabled={pending}>
                        הכל
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <section className="tz-card flex flex-col gap-3 p-4" aria-label="פעולה על הציוד התקול">
        <label className="tz-field">
          <span className="tz-label">הערה</span>
          <input className="tz-input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="למשל: תוקן אצל הטכנאי" disabled={pending} />
        </label>
        <ErrorAlert error={error} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={fix} loading={pending} disabled={!ids.length && !fixedUnits}>
            סימון כתקין (תוקן)
          </Button>
          <Link href="/kesher/brigade?tab=out" className="tz-btn tz-btn-tinted">
            זיכוי לחטיבה
          </Link>
          <span className="tz-footnote">{[ids.length ? `${fmtCount(ids.length)} צ׳` : "", fixedUnits ? `${fmtCount(fixedUnits)} יח׳` : ""].filter(Boolean).join(" · ") || "בחרו מה תוקן"}</span>
        </div>
      </section>
      <Toast msg={toast} />
    </div>
  );
}
