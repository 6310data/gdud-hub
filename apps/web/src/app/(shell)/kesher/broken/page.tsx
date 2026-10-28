import { notFound } from "next/navigation";
import { byHe } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Kpi, PageHeader, SmallTile } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { loadKesher, type KSerial } from "@/lib/kesher/data";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { companyRefs } from "../_components/ui";
import { BrokenList, type BrokenBulk, type BrokenSerial } from "./_components/broken-list";
import { MarkBroken, type OkBulk, type OkSerial } from "./_components/mark-broken";

export const metadata = { title: "ציוד תקול" };

/**
 * ציוד תקול (battalion kesher admin): the תקול צ׳ and ציוד משלים — normally in the warehouse, back
 * from a זיכוי — to mark fixed or send back to the brigade; and marking warehouse equipment תקול.
 */
export default async function KesherBroken() {
  const s = await requireModule("kesher");
  if (!kesherAccess(s).isAdmin) notFound();
  const data = await withUser(s.claims, (tx) => loadKesher(tx, s.units));

  const companies = companyRefs(s.units);
  const place = (x: KSerial) => (x.location === "company" ? (companies.get(x.unitId ?? "")?.name ?? "פלוגה") : x.location === "none" ? "ללא שיוך" : "במחסן");
  const byCategory = (a: { category: string | null }, b: { category: string | null }) =>
    (a.category ?? "") === (b.category ?? "") ? 0 : a.category ? (b.category ? byHe(a.category, b.category) : -1) : 1;
  const bulk = data.items.filter((i) => i.kind === "bulk").sort(byCategory);

  const brokenSerials = data.serials.filter((x) => x.condition === "broken");
  const brokenInWarehouse = brokenSerials.filter((x) => x.location === "warehouse").length;
  const brokenBulk = bulk.filter((i) => i.brokenQty > 0);
  const brokenUnits = brokenBulk.reduce((n, i) => n + i.brokenQty, 0);

  return (
    <>
      <PageHeader title="ציוד תקול" sub="תיקון, או זיכוי לחטיבה" />
      <div className="tz-card grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] lg:max-w-[560px]">
        <Kpi value={fmtCount(brokenInWarehouse)} label="צ׳ תקולים במחסן" tile={<SmallTile color="var(--tile-broken)" icon="alert" />} />
        <Kpi value={fmtCount(brokenUnits)} label="יח׳ ציוד משלים תקולות" tile={<SmallTile color="var(--tile-broken)" icon="box" />} />
      </div>

      <BrokenList
        serials={brokenSerials.map((x): BrokenSerial => ({ id: x.id, serial: x.serial, item: x.itemName, place: place(x), inWarehouse: x.location === "warehouse" }))}
        bulk={brokenBulk.map((i): BrokenBulk => ({ id: i.id, name: i.name, category: i.category, broken: i.brokenQty }))}
      />

      <MarkBroken
        serials={data.serials.filter((x) => x.location === "warehouse" && x.condition === "ok").map((x): OkSerial => ({ id: x.id, serial: x.serial, item: x.itemName }))}
        bulk={bulk
          .map((i): OkBulk => ({ id: i.id, name: i.name, category: i.category, available: Math.max(0, data.available(i.id)) }))
          .filter((i) => i.available > 0)}
      />
    </>
  );
}
