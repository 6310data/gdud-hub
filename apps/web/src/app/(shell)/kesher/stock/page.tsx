import { z } from "zod";
import { byHe } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Empty, PageHeader } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { groupBy, loadKesher, loadKitLines, stockKey } from "@/lib/kesher/data";
import { companiesOf } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { SegLinks } from "../_components/ui";
import { KitEditor } from "./_components/kit-editor";
import { StockEditor, type StockCol, type StockRow } from "./_components/stock-editor";

export const metadata = { title: "ציוד משלים" };

const searchSchema = z.object({ tab: z.enum(["stock", "kits"]).catch("stock") });

/**
 * ציוד משלים (mockup #/stock): quantities per place (not personal — every member reads them) and the
 * תקן. A battalion kesher admin edits the quantities, מלאי כללי and the תקן lines here.
 */
export default async function KesherStock({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  const f = searchSchema.parse(await searchParams);
  const { data, kitLines } = await withUser(s.claims, async (tx) => {
    const [data, kitLines] = await Promise.all([loadKesher(tx, s.units), f.tab === "kits" ? loadKitLines(tx) : Promise.resolve([])]);
    return { data, kitLines };
  });
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
      {f.tab === "kits" ? (
        <>
          <KitEditor items={data.items.map((i) => ({ id: i.id, name: i.name, bulk: i.kind === "bulk" }))} lines={kitLines} canEdit={access.isAdmin} />
          <p className="tz-section-footer">בהחתמה, כל צ׳ מוסיף אוטומטית את הציוד המשלים שלו לפי התקן. פריט משלים שיש לו תקן משלו (למשל מגבר) מוסיף גם אותו, בשרשור.</p>
        </>
      ) : (
        <StockTable data={data} companies={companiesOf(s.units)} canEdit={access.isAdmin} />
      )}
    </>
  );
}

type Data = Awaited<ReturnType<typeof loadKesher>>;

function StockTable({ data, companies, canEdit }: { data: Data; companies: ReturnType<typeof companiesOf>; canEdit: boolean }) {
  const bulk = data.items.filter((i) => i.kind === "bulk");
  if (!bulk.length) return <div className="tz-card"><Empty>עדיין אין ציוד משלים. מייבאים אותו מלשונית &quot;כללי&quot; של הגיליון.</Empty></div>;
  const cols: StockCol[] = [{ id: null, name: "במחסן", color: null }, ...companies.map((c) => ({ id: c.id, name: c.name, color: c.color }))];
  const cats = [...groupBy(bulk, (i) => i.category ?? "")].sort(([a], [b]) => (a ? (b ? byHe(a, b) : -1) : 1));
  const rows: [string, StockRow[]][] = cats.map(([cat, list]) => [
    cat,
    list.map((i) => ({
      id: i.id,
      name: i.name,
      brigadeQty: i.brigadeQty,
      qty: Object.fromEntries(cols.map((c) => [c.id ?? "", data.stock.get(stockKey(i.id, c.id)) ?? 0])),
    })),
  ]);
  return (
    <>
      <StockEditor cats={rows} cols={cols} canEdit={canEdit} warehouseTracked={data.warehouseTracked} />
      <p className="tz-section-footer">
        {data.warehouseTracked ? "" : "המחסן לא מנוהל (מלאי חלקי): הכמויות בעמודת המחסן לא מעודכנות בהחתמה ובזיכוי. "}
        מלאי כללי = הכמות הכוללת של הפריט בגדוד (מעמודת &quot;מלאי כללי&quot; בגיליון, או מקבלות החטיבה). &quot;מעל&quot; מסמן פריט שרשום אצלנו יותר מהמלאי הכללי.
      </p>
    </>
  );
}
