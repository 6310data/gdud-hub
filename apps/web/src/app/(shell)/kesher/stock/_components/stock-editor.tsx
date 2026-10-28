"use client";
/**
 * ציוד משלים by place. A company's quantities change only through החתמה / זיכוי, and the warehouse
 * is computed (מלאי כללי − the companies − the vehicles), so the one number a battalion admin edits
 * here is מלאי כללי: "עדכון מלאי כללי" turns that column into fields and the warehouse follows.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Chip, Icon, Spinner, tintStyle } from "@gdud/ui";
import { fmtCount as fmt } from "@/lib/logistics/format";
import { saveStock } from "../../_actions/stock";

export interface StockCol {
  id: string;
  name: string;
  color: string | null;
}
export interface StockRow {
  id: string;
  name: string;
  /** מלאי כללי; null = unknown */
  brigadeQty: number | null;
  /** of the warehouse's, תקול */
  brokenQty: number;
  /** company id → qty */
  qty: Record<string, number>;
  /** on vehicles */
  vehicles: number;
}

const TOAST_MS = 4000;
/** "" = blank; NaN = not a whole number */
const num = (v: string) => (v.trim() === "" ? null : /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);

export function StockEditor({ cats, cols, canEdit }: { cats: [string, StockRow[]][]; cols: StockCol[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  /** item id → typed מלאי כללי */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const all = cats.flatMap(([, list]) => list);
  const typed = (r: StockRow) => draft[r.id] ?? (r.brigadeQty === null ? "" : String(r.brigadeQty));
  const total = (r: StockRow) => (editing ? num(typed(r)) : r.brigadeQty);
  const signed = (r: StockRow) => cols.reduce((n, c) => n + (r.qty[c.id] ?? 0), 0) + r.vehicles;

  function changes() {
    const rows = [];
    for (const r of all) {
      const v = draft[r.id];
      if (v === undefined) continue;
      const n = num(v);
      if (n !== null && Number.isNaN(n)) throw new Error(`${r.name}: "${v}" אינו מספר שלם`);
      if (n !== r.brigadeQty) rows.push({ itemId: r.id, brigadeQty: n });
    }
    return rows;
  }

  function cancel() {
    setEditing(false);
    setDraft({});
    setError(undefined);
  }

  function save() {
    setError(undefined);
    let rows;
    try {
      rows = changes();
    } catch (e) {
      return setError((e as Error).message);
    }
    if (!rows.length) return cancel();
    start(async () => {
      const r = await saveStock({ rows });
      if (!r.ok) return setError(r.error);
      cancel();
      setToast(`עודכן מלאי כללי של ${r.data.changed} פריטים`);
      router.refresh();
    });
  }

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
              <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" disabled={pending} onClick={cancel}>
                ביטול
              </button>
              <span className="tz-footnote">שדה ריק = לא ידוע. המחסן מתעדכן לפי מה שמוקלד.</span>
            </>
          ) : (
            <>
              <button type="button" className="tz-btn tz-btn-tinted tz-btn-sm" onClick={() => setEditing(true)}>
                <Icon name="pencil" size={16} />
                עדכון מלאי כללי
              </button>
              <Link href="/kesher/sign" className="tz-btn tz-btn-plain tz-btn-sm">
                החתמה לפלוגה
              </Link>
              <Link href="/kesher/credit" className="tz-btn tz-btn-plain tz-btn-sm">
                זיכוי מפלוגה
              </Link>
            </>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0 whitespace-pre-line">
          {error}
        </p>
      ) : null}
      <div className="tz-table-wrap">
        <table className="tz-table">
          <thead>
            <tr>
              <th>פריט</th>
              <th>מלאי כללי</th>
              <th>במחסן</th>
              {cols.map((c) => (
                <th key={c.id} className={c.color ? "tz-tint" : undefined} style={tintStyle(c.color)}>
                  {c.name}
                </th>
              ))}
              <th>על רכבים</th>
            </tr>
          </thead>
          <tbody>
            {cats.map(([cat, list]) => (
              <CategoryRows key={cat || "—"} cat={cat} span={cols.length + 4}>
                {list.map((r) => {
                  const t = total(r);
                  const known = t !== null && !Number.isNaN(t);
                  const wh = known ? t - signed(r) : null;
                  return (
                    <tr key={r.id}>
                      <th scope="row">{r.name}</th>
                      <td className="tz-num">
                        {editing ? (
                          <input
                            className="tz-input tz-num min-h-8 w-[80px] px-2 py-0 text-center text-[15px]"
                            inputMode="numeric"
                            value={typed(r)}
                            onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                            aria-label={`${r.name} · מלאי כללי`}
                            disabled={pending}
                          />
                        ) : known ? (
                          <span className="font-semibold">{fmt(t)}</span>
                        ) : (
                          <span className="tz-zero">—</span>
                        )}
                      </td>
                      <td className="tz-num" data-sort={wh ?? ""}>
                        {wh === null ? (
                          <span className="tz-zero">—</span>
                        ) : (
                          <span className={wh < 0 ? "font-semibold text-danger" : wh - r.brokenQty <= 1 ? "font-semibold text-danger" : "font-semibold"}>{fmt(wh)}</span>
                        )}
                        {r.brokenQty ? (
                          <>
                            {" "}
                            <Chip tone="broken">{fmt(r.brokenQty)} תקול</Chip>
                          </>
                        ) : null}
                        {wh !== null && wh < 0 ? (
                          <>
                            {" "}
                            <Chip tone="broken">חסר במלאי הכללי</Chip>
                          </>
                        ) : null}
                      </td>
                      {cols.map((c) => {
                        const n = r.qty[c.id] ?? 0;
                        return (
                          <td key={c.id} className={`tz-num ${n ? "" : "tz-zero"} ${c.color ? "tz-tint" : ""}`} style={tintStyle(c.color)}>
                            {fmt(n)}
                          </td>
                        );
                      })}
                      <td className={`tz-num ${r.vehicles ? "" : "tz-zero"}`}>{fmt(r.vehicles)}</td>
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
