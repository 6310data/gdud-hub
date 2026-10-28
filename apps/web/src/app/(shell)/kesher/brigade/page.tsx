import { notFound } from "next/navigation";
import { z } from "zod";
import { byHe, israelToday } from "@gdud/core";
import { desc, eq, schema, withUser } from "@gdud/db";
import { Serial } from "@gdud/ui";
import { Empty, PageHeader, Panel } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { loadKesher } from "@/lib/kesher/data";
import { fmtCount, fmtDate } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { SegLinks } from "../_components/ui";
import { BrigadeIn, type InBulk, type KnownSerial } from "./_components/brigade-in";
import { BrigadeOut, type OutBulk, type OutSerial } from "./_components/brigade-out";

export const metadata = { title: "מול חטיבה" };

const { kesherSerials: serials, kesherItems: items } = schema;
const RETURNED_SHOWN = 50;
const searchSchema = z.object({ tab: z.enum(["in", "out"]).catch("in") });

/**
 * מול חטיבה (battalion kesher admin): קבלה מחטיבה (new צ׳ into the warehouse, ציוד משלים onto מלאי
 * כללי) and זיכוי לחטיבה (warehouse צ׳ and ציוד משלים go back). A צ׳ returned to the brigade stays in
 * the table as "הוחזר לחטיבה" and can be received again later.
 */
export default async function KesherBrigade({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  if (!kesherAccess(s).isAdmin) notFound();
  const f = searchSchema.parse(await searchParams);

  const { data, returned } = await withUser(s.claims, async (tx) => {
    const [data, returned] = await Promise.all([
      loadKesher(tx, s.units, { returned: true }),
      tx
        .select({ id: serials.id, serial: serials.serial, item: items.name, at: serials.updatedAt })
        .from(serials)
        .innerJoin(items, eq(items.id, serials.itemId))
        .where(eq(serials.location, "brigade"))
        .orderBy(desc(serials.updatedAt))
        .limit(RETURNED_SHOWN),
    ]);
    return { data, returned };
  });

  const today = israelToday(new Date());
  const bulkItems = data.items.filter((i) => i.kind === "bulk");
  const byCategory = (a: { category: string | null; name: string }, b: { category: string | null; name: string }) =>
    (a.category ?? "") === (b.category ?? "") ? 0 : a.category ? (b.category ? byHe(a.category, b.category) : -1) : 1;
  const returnedTotal = data.serials.filter((x) => x.location === "brigade").length;
  const inWarehouse = data.serials.filter((x) => x.location === "warehouse");

  return (
    <>
      <PageHeader title="מול חטיבה" sub={`${fmtCount(inWarehouse.length)} צ׳ במחסן · ${fmtCount(returnedTotal)} הוחזרו לחטיבה`} />
      <SegLinks
        label="פעולה"
        items={[
          { href: "/kesher/brigade", label: "קבלה מחטיבה", on: f.tab === "in" },
          { href: "/kesher/brigade?tab=out", label: "זיכוי לחטיבה", on: f.tab === "out" },
        ]}
      />
      {f.tab === "out" ? (
        <BrigadeOut
          key="out"
          today={today}
          serials={inWarehouse.map((x): OutSerial => ({ id: x.id, serial: x.serial, item: x.itemName, broken: x.condition === "broken" }))}
          bulk={bulkItems
            .map((i): OutBulk => ({ id: i.id, name: i.name, category: i.category, available: Math.max(0, data.available(i.id)), broken: i.brokenQty }))
            .filter((i) => i.available > 0 || i.broken > 0)
            .sort(byCategory)}
        />
      ) : (
        <BrigadeIn
          key="in"
          today={today}
          types={data.items.filter((i) => i.kind === "serial").map((i) => ({ id: i.id, name: i.name }))}
          bulk={[...bulkItems].sort(byCategory).map((i): InBulk => ({ id: i.id, name: i.name, category: i.category, brigadeQty: i.brigadeQty }))}
          known={data.serials.map((x): KnownSerial => ({ serial: x.serial, itemId: x.itemId, item: x.itemName, location: x.location }))}
        />
      )}

      <Panel title={`הוחזרו לחטיבה · ${fmtCount(returnedTotal)}`}>
        {returned.length ? (
          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead>
                <tr>
                  <th>צ׳</th>
                  <th>סוג מכשיר</th>
                  <th>עדכון אחרון</th>
                </tr>
              </thead>
              <tbody>
                {returned.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <Serial>{x.serial}</Serial>
                    </td>
                    <td>{x.item}</td>
                    <td className="tz-num text-ink-muted">{fmtDate(x.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>עדיין לא הוחזרו צ׳ לחטיבה</Empty>
        )}
      </Panel>
      {returnedTotal > returned.length ? <p className="tz-section-footer">מוצגים {RETURNED_SHOWN} האחרונים. ההיסטוריה המלאה ביומן.</p> : null}
    </>
  );
}
