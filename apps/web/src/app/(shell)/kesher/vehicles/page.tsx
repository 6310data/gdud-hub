import Link from "next/link";
import { z } from "zod";
import { byHe, matches } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Serial } from "@gdud/ui";
import { Empty, Kpi, PageHeader, SmallTile } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { groupBy, loadKesher, type KSerial } from "@/lib/kesher/data";
import { companiesOf } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { CompanyChip, CompanyDot, LocationChip, SearchBox, companyRefs, type CompanyRef } from "../_components/ui";
import { EditVehicleButton, VehicleProvider } from "./_components/vehicle-editor";

export const metadata = { title: "ציוד על רכבים" };

const searchSchema = z.object({ q: z.string().trim().max(80).optional().catch(undefined) });

const WAREHOUSE = "wh";
const NONE = "none";

/**
 * ציוד על רכבים: every vehicle (the sheet's האמר column) with the צ׳ mounted on it, grouped under
 * the company whose gear it carries. Not personal (every member reads it); holders only for the
 * companies the user covers (RLS). A battalion admin puts צ׳ on a vehicle or takes them off.
 */
export default async function KesherVehicles({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  const f = searchSchema.parse(await searchParams);
  const data = await withUser(s.claims, (tx) => loadKesher(tx, s.units));
  const companies = companiesOf(s.units);
  const refs = companyRefs(companies);

  const mounted = data.serials.filter((x) => x.vehicle);
  const vehicles = [...groupBy(mounted, (x) => x.vehicle!)].map(([vehicle, gear]) => ({ vehicle, gear, owner: ownerOf(gear) }));
  const shown = vehicles.filter((v) => !f.q || matches(f.q, v.vehicle, refs.get(v.owner)?.name, ...v.gear.flatMap((x) => [x.serial, x.itemName, x.holder?.holder?.name])));
  const sections: { key: string; title: string; company: CompanyRef | null }[] = [
    ...companies.map((c) => ({ key: c.id, title: c.name, company: refs.get(c.id)! })),
    { key: WAREHOUSE, title: "במחסן", company: null },
    { key: NONE, title: "ללא שיוך", company: null },
  ];
  const byOwner = groupBy(shown, (v) => v.owner);

  const page = (
    <>
      <PageHeader
        title="ציוד על רכבים"
        sub={`${fmtCount(vehicles.length)} רכבים · ${fmtCount(mounted.length)} צ׳ מותקנים`}
        actions={access.isAdmin ? <EditVehicleButton vehicle={null} /> : null}
      />
      <div className="tz-card grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        <Kpi value={fmtCount(vehicles.length)} label="רכבים" tile={<SmallTile color="var(--primary)" icon="truck" />} />
        <Kpi value={fmtCount(mounted.length)} label="צ׳ על רכבים" tile={<SmallTile color="var(--tile-brigade)" icon="antenna" />} />
        <Kpi
          value={fmtCount(data.serials.filter((x) => x.location === "company" && !x.vehicle).length)}
          label="צ׳ בפלוגות בלי רכב"
          tile={<SmallTile color="var(--tile-neutral)" icon="list" />}
        />
      </div>
      <SearchBox action="/kesher/vehicles" q={f.q} placeholder="מספר רכב, צ׳, מכשיר או פלוגה" />

      {shown.length ? (
        sections
          .filter((sec) => byOwner.get(sec.key)?.length)
          .map((sec) => {
            const list = byOwner.get(sec.key)!.sort((a, b) => a.vehicle.localeCompare(b.vehicle, "en", { numeric: true }));
            return (
              <section key={sec.key} className="flex flex-col gap-2.5" aria-label={sec.title}>
                <h2 className="flex items-center gap-2 px-1 text-[15px] font-semibold">
                  {sec.company ? <CompanyDot color={sec.company.color} /> : null}
                  {sec.title}
                  <span className="text-[13px] font-normal text-ink-muted">· {fmtCount(list.length)} רכבים</span>
                </h2>
                <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((v) => (
                    <VehicleCard key={v.vehicle} vehicle={v.vehicle} gear={v.gear} owner={v.owner} refs={refs} admin={access.isAdmin} />
                  ))}
                </div>
              </section>
            );
          })
      ) : (
        <div className="tz-card">
          <Empty>{vehicles.length ? "לא נמצא רכב תואם" : "עדיין אין צ׳ משויכים לרכבים. השיוך מגיע מעמודת \"האמר\" בגיליון או מכאן."}</Empty>
        </div>
      )}
    </>
  );

  if (!access.isAdmin) return page;
  return (
    <VehicleProvider
      serials={data.serials.map((x) => ({
        id: x.id,
        serial: x.serial,
        item: x.itemName,
        place: x.location === "company" ? (refs.get(x.unitId ?? "")?.name ?? "פלוגה") : x.location === "warehouse" ? "במחסן" : "ללא שיוך",
        vehicle: x.vehicle,
      }))}
    >
      {page}
    </VehicleProvider>
  );
}

/** The company whose gear a vehicle carries most of; the warehouse or "none" when no company's. */
function ownerOf(gear: readonly KSerial[]): string {
  const counts = new Map<string, number>();
  for (const x of gear) {
    const k = x.location === "company" ? x.unitId! : x.location === "warehouse" ? WAREHOUSE : NONE;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // a company beats the warehouse on a tie
  return [...counts].sort(([a, n], [b, m]) => m - n || Number(a === WAREHOUSE || a === NONE) - Number(b === WAREHOUSE || b === NONE))[0]![0];
}

function VehicleCard({ vehicle, gear, owner, refs, admin }: { vehicle: string; gear: KSerial[]; owner: string; refs: ReadonlyMap<string, CompanyRef>; admin: boolean }) {
  const sorted = [...gear].sort((a, b) => byHe(a.itemName, b.itemName) || a.serial.localeCompare(b.serial, "en", { numeric: true }));
  // gear of another place than the vehicle's company gets its own chip
  const mixed = gear.some((x) => (x.location === "company" ? x.unitId : x.location === "warehouse" ? WAREHOUSE : NONE) !== owner);
  return (
    <article className="tz-card flex flex-col" aria-label={`רכב ${vehicle}`}>
      <header className="flex items-center gap-3 border-b border-separator px-4 py-3">
        <SmallTile color={refs.get(owner)?.color ?? "var(--tile-neutral)"} icon="truck" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[16px] font-semibold">
            <Serial>{vehicle}</Serial>
          </span>
          <span className="text-xs text-ink-muted">{fmtCount(gear.length)} צ׳</span>
        </span>
        {refs.get(owner) ? <CompanyChip company={refs.get(owner)!} /> : null}
        {admin ? <EditVehicleButton vehicle={vehicle} /> : null}
      </header>
      <ul className="m-0 list-none p-0">
        {sorted.map((x) => (
          <li key={x.id} className="flex items-center gap-2 border-b border-separator px-4 py-2 text-[14px] last:border-0">
            <span className="min-w-0 flex-1">
              {x.itemName}
              {x.holder?.holder ? <span className="block text-xs text-ink-muted">{[x.holder.holder.name, x.holder.holderRole].filter(Boolean).join(" · ")}</span> : null}
            </span>
            {mixed ? <LocationChip serial={x} company={refs.get(x.unitId ?? "")} /> : null}
            <Link href={`/kesher/serials?sel=${x.id}`} className="no-underline">
              <Serial>{x.serial}</Serial>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
