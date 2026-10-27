"use client";
/**
 * ציוד משלים by place. A battalion admin turns on "עדכון כמויות": every quantity and מלאי כללי
 * becomes a field, the totals follow what is typed, and "שמירה" sends only the changed cells.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Chip, Icon, Spinner, tintStyle } from "@gdud/ui";
import { fmtCount as fmt } from "@/lib/logistics/format";
import { saveStock } from "../../_actions/stock";

export interface StockCol {
  /** null = the warehouse */
  id: string | null;
  name: string;
  color: string | null;
}
export interface StockRow {
  id: string;
  name: string;
  brigadeQty: number | null;
  /** place key (unit id, "" = warehouse) → qty */
  qty: Record<string, number>;
}

const TOAST_MS = 4000;
const key = (unitId: string | null) => unitId ?? "";
/** "" = blank; NaN = not a whole number */
const num = (v: string) => (v.trim() === "" ? null : /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);

type Draft = Record<string, string>;

export function StockEditor({
  cats,
  cols,
  canEdit,
  warehouseTracked,
}: {
  cats: [string, StockRow[]][];
  cols: StockCol[];
  canEdit: boolean;
  warehouseTracked: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  /** `${itemId}|${placeKey}` or `${itemId}|brigade` → typed text */
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const cell = (r: StockRow, c: StockCol) => draft[`${r.id}|${key(c.id)}`] ?? String(r.qty[key(c.id)] ?? 0);
  const brigade = (r: StockRow) => draft[`${r.id}|brigade`] ?? (r.brigadeQty === null ? "" : String(r.brigadeQty));
  const qtyOf = (r: StockRow, c: StockCol) => (editing ? (num(cell(r, c)) ?? 0) : (r.qty[key(c.id)] ?? 0));
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const all = cats.flatMap(([, list]) => list);

  function changes() {
    const rows = [];
    for (const r of all) {
      const cells = [];
      for (const c of cols) {
        const v = draft[`${r.id}|${key(c.id)}`];
        if (v === undefined) continue;
        const n = num(v) ?? 0;
        if (Number.isNaN(n)) throw new Error(`${r.name} · ${c.name}: "${v}" אינו מספר שלם`);
        if (n !== (r.qty[key(c.id)] ?? 0)) cells.push({ unitId: c.id, qty: n });
      }
      const b = draft[`${r.id}|brigade`];
      const bq = b === undefined ? undefined : num(b);
      if (bq !== undefined && bq !== null && (Number.isNaN(bq) || bq < 0)) throw new Error(`${r.name} · מלאי כללי: "${b}" אינו מספר שלם`);
      const brigadeQty = bq === undefined || bq === r.brigadeQty ? undefined : bq;
      if (cells.length || brigadeQty !== undefined) rows.push({ itemId: r.id, cells, brigadeQty });
    }
    return rows;
  }

  function save() {
    setError(undefined);
    let rows;
    try {
      rows = changes();
    } catch (e) {
      return setError((e as Error).message);
    }
    if (!rows.length) {
      setEditing(false);
      setDraft({});
      return;
    }
    start(async () => {
      const r = await saveStock({ rows });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      setDraft({});
      setToast(`עודכנו ${r.data.changed} כמויות`);
      router.refresh();
    });
  }

  const input = (k: string, value: string, label: string) => (
    <input
      className="tz-input tz-num min-h-8 w-[72px] px-2 py-0 text-center text-[15px]"
      inputMode="numeric"
      value={value}
      onChange={(e) => set(k, e.target.value)}
      aria-label={label}
      disabled={pending}
    />
  );

  return (
    <>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button type="button" className="tz-btn tz-btn-filled tz-btn-sm" onClick={save} disabled={pending} aria-busy={pending || undefined}>
                {pending ? <Spinner size={14} /> : null}
                שמירה
              </button>
              <button
                type="button"
                className="tz-btn tz-btn-plain tz-btn-sm"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setDraft({});
                  setError(undefined);
                }}
              >
                ביטול
              </button>
              <span className="tz-footnote">שדה ריק = 0. מלאי כללי ריק = לא ידוע.</span>
            </>
          ) : (
            <button type="button" className="tz-btn tz-btn-tinted tz-btn-sm" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={16} />
              עדכון כמויות
            </button>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
      <div className="tz-table-wrap">
        <table className="tz-table">
          <thead>
            <tr>
              <th>פריט</th>
              {cols.map((c) => (
                <th key={key(c.id)} className={c.color ? "tz-tint" : undefined} style={tintStyle(c.color)}>
                  {c.name}
                </th>
              ))}
              <th>סה״כ</th>
              <th className={editing ? undefined : "max-md:hidden"}>מלאי כללי</th>
            </tr>
          </thead>
          <tbody>
            {cats.map(([cat, list]) => (
              <CategoryRows key={cat || "—"} cat={cat} span={cols.length + 3}>
                {list.map((r) => {
                  const total = cols.reduce((n, c) => n + qtyOf(r, c), 0);
                  const ref = editing ? num(brigade(r)) : r.brigadeQty;
                  return (
                    <tr key={r.id}>
                      <th scope="row">{r.name}</th>
                      {cols.map((c) => {
                        const n = qtyOf(r, c);
                        const wh = c.id === null;
                        const cls = wh ? (!warehouseTracked ? "text-ink-muted" : n <= 1 ? "font-semibold text-danger" : "font-semibold") : n ? "" : "tz-zero";
                        return (
                          <td key={key(c.id)} className={`tz-num ${editing ? "" : cls} ${c.color ? "tz-tint" : ""}`} style={tintStyle(c.color)}>
                            {editing ? input(`${r.id}|${key(c.id)}`, cell(r, c), `${r.name} · ${c.name}`) : fmt(n)}
                          </td>
                        );
                      })}
                      <td className="tz-num font-semibold">{fmt(total)}</td>
                      <td className={`tz-num ${editing ? "" : "max-md:hidden"}`}>
                        {editing ? (
                          input(`${r.id}|brigade`, brigade(r), `${r.name} · מלאי כללי`)
                        ) : ref === null || Number.isNaN(ref) ? (
                          <span className="tz-zero">—</span>
                        ) : (
                          fmt(ref)
                        )}
                        {!editing && ref !== null && !Number.isNaN(ref) && total > ref ? (
                          <>
                            {" "}
                            <Chip tone="broken">מעל</Chip>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </CategoryRows>
            ))}
          </tbody>
        </table>
      </div>
      {toast ? (
        <div className="tz-toast lg:bottom-6" role="status">
          <span>{toast}</span>
        </div>
      ) : null}
    </>
  );
}

function CategoryRows({ cat, span, children }: { cat: string; span: number; children: ReactNode }) {
  return (
    <>
      <tr className="tz-group-row">
        <th colSpan={span}>{cat || "ללא קטגוריה"}</th>
      </tr>
      {children}
    </>
  );
}
