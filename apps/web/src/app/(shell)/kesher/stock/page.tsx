import { z } from "zod";
import { byHe } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Chip, tintStyle } from "@gdud/ui";
import { Empty, PageHeader, Panel } from "@/components/page-parts";
import { groupBy, loadKesher, stockKey } from "@/lib/kesher/data";
import { companiesOf } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { SegLinks } from "../_components/ui";

export const metadata = { title: "ציוד משלים" };

const searchSchema = z.object({ tab: z.enum(["stock", "kits"]).catch("stock") });

/**
 * ציוד משלים (mockup #/stock): quantities per place (not personal — every member reads them) and the
 * תקן. Phase 1: read-only; "עדכון כמויות" and the תקן steppers arrive in Phase 2.
 */
export default async function KesherStock({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const f = searchSchema.parse(await searchParams);
  const data = await withUser(s.claims, (tx) => loadKesher(tx, s.units));
  const bulk = data.items.filter((i) => i.kind === "bulk");
  const inWarehouse = bulk.reduce((n, i) => n + (data.stock.get(stockKey(i.id, null)) ?? 0), 0);

  return (
    <>
      <PageHeader title="ציוד משלים" sub={`${bulk.length} סוגי פריטים · ${fmtCount(inWarehouse)} במחסן`} />
      <SegLinks
        label="תצוגה"
        items={[
          { href: "/kesher/stock", label: "מלאי לפי פלוגה", on: f.tab === "stock" },
          { href: "/kesher/stock?tab=kits", label: "תקן ציוד משלים", on: f.tab === "kits" },
        ]}
      />
      {f.tab === "kits" ? <Kits data={data} /> : <StockTable data={data} companies={companiesOf(s.units)} />}
    </>
  );
}

type Data = Awaited<ReturnType<typeof loadKesher>>;

function StockTable({ data, companies }: { data: Data; companies: ReturnType<typeof companiesOf> }) {
  const bulk = data.items.filter((i) => i.kind === "bulk");
  if (!bulk.length) return <div className="tz-card"><Empty>עדיין אין ציוד משלים. מייבאים אותו מלשונית &quot;כללי&quot; של הגיליון.</Empty></div>;
  const cols = [{ id: null as string | null, name: "במחסן", color: null as string | null }, ...companies.map((c) => ({ id: c.id, name: c.name, color: c.color }))];
  const cats = [...groupBy(bulk, (i) => i.category ?? "")].sort(([a], [b]) => (a ? (b ? byHe(a, b) : -1) : 1));
  return (
    <>
      <div className="tz-table-wrap">
        <table className="tz-table">
          <thead>
            <tr>
              <th>פריט</th>
              {cols.map((c) => (
                <th key={c.id ?? "wh"} className={c.color ? "tz-tint" : undefined} style={tintStyle(c.color)}>
                  {c.name}
                </th>
              ))}
              <th>סה״כ</th>
              <th className="max-md:hidden">מלאי חטיבה</th>
            </tr>
          </thead>
          <tbody>
            {cats.map(([cat, list]) => (
              <CategoryRows key={cat || "—"} cat={cat} list={list} cols={cols} data={data} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="tz-section-footer">
        {data.warehouseTracked ? "" : "המחסן לא מנוהל (מלאי חלקי): הכמויות בעמודת המחסן לא מעודכנות בהחתמה ובזיכוי. "}
        מלאי חטיבה = הכמות לפי קבלות החטיבה. &quot;מעל&quot; מסמן פריט שרשום אצלנו יותר ממה שהחטיבה החתימה.
      </p>
    </>
  );
}

function CategoryRows({ cat, list, cols, data }: { cat: string; list: Data["items"]; cols: { id: string | null; name: string; color: string | null }[]; data: Data }) {
  return (
    <>
      <tr className="tz-group-row">
        <th colSpan={cols.length + 3}>{cat || "ללא קטגוריה"}</th>
      </tr>
      {list.map((i) => {
        const qty = (unitId: string | null) => data.stock.get(stockKey(i.id, unitId)) ?? 0;
        const total = cols.reduce((n, c) => n + qty(c.id), 0);
        return (
          <tr key={i.id}>
            <th scope="row">{i.name}</th>
            {cols.map((c) => {
              const n = qty(c.id);
              const wh = c.id === null;
              const cls = wh ? (!data.warehouseTracked ? "text-ink-muted" : n <= 1 ? "font-semibold text-danger" : "font-semibold") : n ? "" : "tz-zero";
              return (
                <td key={c.id ?? "wh"} className={`tz-num ${cls} ${c.color ? "tz-tint" : ""}`} style={tintStyle(c.color)}>
                  {fmtCount(n)}
                </td>
              );
            })}
            <td className="tz-num font-semibold">{fmtCount(total)}</td>
            <td className="tz-num max-md:hidden">
              {i.brigadeQty === null ? <span className="tz-zero">—</span> : fmtCount(i.brigadeQty)}
              {i.brigadeQty !== null && total > i.brigadeQty ? (
                <>
                  {" "}
                  <Chip tone="broken">מעל</Chip>
                </>
              ) : null}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Kits({ data }: { data: Data }) {
  const parents = [...data.kits.keys()].sort(byHe);
  const bulkNames = new Set(data.items.filter((i) => i.kind === "bulk").map((i) => i.name));
  if (!parents.length) return <div className="tz-card"><Empty>עדיין אין תקן. מייבאים אותו מלשונית &quot;תקן ציוד משלים&quot; של הגיליון.</Empty></div>;
  return (
    <>
      <div className="flex flex-wrap items-start gap-[22px]">
        {parents.map((p) => (
          <div key={p} className="min-w-0 flex-[1_1_300px]">
            <Panel
              title={
                <span className="inline-flex items-center gap-2">
                  {p}
                  {bulkNames.has(p) ? <Chip tone="brigade">ציוד משלים</Chip> : null}
                </span>
              }
            >
              {data.kits.get(p)!.map((k) => (
                <div key={k.item} className="tz-row">
                  <span className="tz-row-body min-h-[42px] py-0">
                    <span className="tz-row-title text-[14px]">
                      {k.item}
                      {data.kits.has(k.item) ? <span className="tz-row-sub text-xs">כולל את התקן שלו</span> : null}
                    </span>
                    <span className="tz-num">×{k.qty}</span>
                  </span>
                </div>
              ))}
            </Panel>
          </div>
        ))}
      </div>
      <p className="tz-section-footer">בהחתמה, כל צ׳ מוסיף אוטומטית את הציוד המשלים שלו לפי התקן. פריט משלים שיש לו תקן משלו (למשל מגבר) מוסיף גם אותו, בשרשור.</p>
    </>
  );
}
