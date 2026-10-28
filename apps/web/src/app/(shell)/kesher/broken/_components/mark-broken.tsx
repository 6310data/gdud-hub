"use client";
/**
 * סימון ציוד במחסן כתקול: find warehouse צ׳ תקינים by צ׳ or device type, and move ציוד משלים
 * quantities from תקין to תקול. A צ׳ on a company comes back תקול only through a זיכוי.
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { matches } from "@gdud/core";
import { Button, Icon, Serial } from "@gdud/ui";
import { Panel } from "@/components/page-parts";
import { fmtCount } from "@/lib/logistics/format";
import { setCondition } from "../../_actions/moves";
import { ErrorAlert, qtyOf, QtyInput, Toast, useToast } from "../../brigade/_components/shared";

export interface OkSerial {
  id: string;
  serial: string;
  item: string;
}
export interface OkBulk {
  id: string;
  name: string;
  category: string | null;
  /** warehouse תקין */
  available: number;
}

const SHOWN = 30;

export function MarkBroken({ serials, bulk }: { serials: OkSerial[]; bulk: OkBulk[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [toast, setToast] = useToast();
  const [pending, start] = useTransition();

  const byId = useMemo(() => new Map(serials.map((x) => [x.id, x])), [serials]);
  const picked = chosen.map((id) => byId.get(id)).filter((x): x is OkSerial => Boolean(x));
  const hits = q.trim().length >= 2 ? serials.filter((x) => !chosen.includes(x.id) && matches(q, x.serial, x.item)).slice(0, SHOWN) : [];

  const lines = bulk.map((b) => ({ b, qty: qtyOf(qty[b.id]) }));
  const bad = lines.filter((l) => Number.isNaN(l.qty) || l.qty > l.b.available);
  const units = lines.reduce((n, l) => n + (l.qty > 0 ? l.qty : 0), 0);

  function mark() {
    setError(undefined);
    if (bad.length) return setError(bad.map((l) => `${l.b.name}: במחסן ${l.b.available} תקינים`).join("\n"));
    if (!picked.length && !units) return setError("לא נבחר ציוד");
    start(async () => {
      const r = await setCondition({
        broken: true,
        serialIds: picked.map((x) => x.id),
        lines: lines.filter((l) => l.qty > 0).map((l) => ({ itemId: l.b.id, qty: l.qty })),
        notes: notes.trim() || null,
      });
      if (!r.ok) return setError(r.error);
      setToast(`סומנו כתקולים: ${[picked.length ? `${fmtCount(picked.length)} צ׳` : "", units ? `${fmtCount(units)} יח׳ ציוד משלים` : ""].filter(Boolean).join(" · ")}`);
      setChosen([]);
      setQ("");
      setQty({});
      setNotes("");
      router.refresh();
    });
  }

  return (
    <Panel title="סימון ציוד במחסן כתקול" bodyClassName="flex flex-col gap-4 p-4">
      <section className="flex flex-col gap-2" aria-label="צ׳ תקינים במחסן">
        <label className="tz-search">
          <Icon name="search" size={15} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש צ׳ תקין במחסן — צ׳ או סוג מכשיר" aria-label="חיפוש צ׳ תקין במחסן" autoComplete="off" disabled={pending} />
        </label>
        {hits.length ? (
          <div className="flex flex-col rounded-control border border-separator p-1">
            {hits.map((x) => (
              <button
                key={x.id}
                type="button"
                className="flex items-center gap-3 rounded-control border-0 bg-transparent px-3 py-2 text-start hover:bg-ground"
                onClick={() => setChosen((cur) => [...cur, x.id])}
                disabled={pending}
              >
                <Icon name="plus" size={16} />
                <span className="flex-1 text-[14px]">
                  {x.item} · <Serial>{x.serial}</Serial>
                </span>
              </button>
            ))}
          </div>
        ) : q.trim().length >= 2 ? (
          <p className="tz-footnote m-0 px-1">לא נמצא צ׳ תקין במחסן</p>
        ) : null}
        {picked.length ? (
          <div className="flex flex-col gap-1">
            <span className="tz-label">יסומנו כתקולים · {fmtCount(picked.length)}</span>
            <div className="flex flex-wrap gap-2">
              {picked.map((x) => (
                <span key={x.id} className="tz-chip tz-chip-broken">
                  {x.item} · <Serial>{x.serial}</Serial>
                  <button type="button" className="grid size-5 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-inherit" onClick={() => setChosen((cur) => cur.filter((id) => id !== x.id))} aria-label={`הסרת ${x.serial}`} disabled={pending}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {bulk.length ? (
        <section className="tz-table-wrap border border-separator" aria-label="ציוד משלים תקין במחסן">
          <table className="tz-table">
            <thead>
              <tr>
                <th>פריט</th>
                <th>קטגוריה</th>
                <th>תקין במחסן</th>
                <th>לסימון כתקול</th>
              </tr>
            </thead>
            <tbody>
              {bulk.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td className="text-ink-muted">{b.category ?? "—"}</td>
                  <td className="tz-num">{fmtCount(b.available)}</td>
                  <td>
                    <QtyInput value={qty[b.id] ?? ""} max={b.available} label={`${b.name} · לסימון כתקול`} onChange={(v) => setQty((cur) => ({ ...cur, [b.id]: v }))} disabled={pending} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <label className="tz-field">
        <span className="tz-label">הערה</span>
        <input className="tz-input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="מה התקלה" disabled={pending} />
      </label>
      <ErrorAlert error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="danger" onClick={mark} loading={pending} disabled={!picked.length && !units}>
          סימון כתקול
        </Button>
        <span className="tz-footnote">צ׳ שעל פלוגה חוזר כתקול רק בזיכוי.</span>
      </div>
      <Toast msg={toast} />
    </Panel>
  );
}
