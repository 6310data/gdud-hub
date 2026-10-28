import Link from "next/link";
import { z } from "zod";
import { byHe, matches } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Chip, Serial } from "@gdud/ui";
import { Empty, Kpi, PageHeader, SmallTile } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { groupBy, loadKesher, loadVehicles, vehicleLabel, type KSerial, type KVehicle } from "@/lib/kesher/data";
import { companiesOf } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { CompanyChip, LocationChip, SearchBox, companyRefs, type CompanyRef } from "../_components/ui";
import { EditVehicleButton, VehicleProvider } from "./_components/vehicle-editor";

export const metadata = { title: "ציוד על רכבים" };

const searchSchema = z.object({ q: z.string().trim().max(80).optional().catch(undefined) });

/** A vehicle with what kesher put on it. `vehicle` is null for a number the צ׳ carry that דוח 1 doesn't list. */
interface Card {
  number: string;
  vehicle: KVehicle | null;
  gear: KSerial[];
  bulk: { name: string; qty: number }[];
}

const NO_STANDBY = "";

/**
 * ציוד על רכבים: דוח 1's vehicles that carry kesher gear — the צ׳ mounted on them and their ציוד
 * משלים — grouped by the standby team (כוננות) of the active round that has the vehicle. Not personal
 * (every member reads it); holders only for the companies the user covers (RLS). A battalion admin
 * picks a vehicle from דוח 1's list and puts צ׳ and ציוד משלים on it.
 */
export default async function KesherVehicles({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  const f = searchSchema.parse(await searchParams);
  const { data, vehicles } = await withUser(s.claims, async (tx) => {
    const [data, vehicles] = await Promise.all([loadKesher(tx, s.units), loadVehicles(tx)]);
    return { data, vehicles };
  });
  const refs = companyRefs(companiesOf(s.units));
  const byNumber = new Map(vehicles.map((v) => [v.number, v]));
  const itemName = (id: string) => data.itemsById.get(id)?.name ?? "—";

  const gearOf = groupBy(
    data.serials.filter((x) => x.vehicle),
    (x) => x.vehicle!,
  );
  const cards: Card[] = [];
  for (const v of vehicles) {
    const bulk = [...(data.vehicleStock.get(v.id) ?? new Map<string, number>())].map(([id, qty]) => ({ name: itemName(id), qty })).sort((a, b) => byHe(a.name, b.name));
    const gear = gearOf.get(v.number) ?? [];
    if (gear.length || bulk.length) cards.push({ number: v.number, vehicle: v, gear, bulk });
  }
  // numbers from the sheet's האמר column that דוח 1 doesn't list
  for (const [number, gear] of gearOf) if (!byNumber.has(number)) cards.push({ number, vehicle: null, gear, bulk: [] });

  const shown = cards.filter(
    (c) => !f.q || matches(f.q, c.number, c.vehicle?.kind, c.vehicle?.standby, ...c.gear.flatMap((x) => [x.serial, x.itemName, x.holder?.holder?.name]), ...c.bulk.map((b) => b.name)),
  );
  const sections = [...groupBy(shown, (c) => (c.vehicle ? (c.vehicle.standby ?? NO_STANDBY) : null))].sort(([a], [b]) =>
    a === null ? 1 : b === null ? -1 : a === NO_STANDBY ? 1 : b === NO_STANDBY ? -1 : byHe(a, b),
  );
  const mounted = cards.reduce((n, c) => n + c.gear.length, 0);
  const bulkTotal = cards.reduce((n, c) => n + c.bulk.reduce((m, b) => m + b.qty, 0), 0);
  const bare = vehicles.filter((v) => v.active && !cards.some((c) => c.vehicle?.id === v.id)).length;

  const page = (
    <>
      <PageHeader
        title="ציוד על רכבים"
        sub={`${fmtCount(cards.length)} רכבים עם ציוד קשר · ${fmtCount(mounted)} צ׳ · ${fmtCount(bulkTotal)} ציוד משלים`}
        actions={access.isAdmin ? <EditVehicleButton vehicleId={null} /> : null}
      />
      <div className="tz-card grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        <Kpi value={fmtCount(cards.length)} label="רכבים עם ציוד" tile={<SmallTile color="var(--primary)" icon="truck" />} />
        <Kpi value={fmtCount(mounted)} label="צ׳ על רכבים" tile={<SmallTile color="var(--tile-brigade)" icon="antenna" />} />
        <Kpi value={fmtCount(bulkTotal)} label="ציוד משלים על רכבים" tile={<SmallTile color="var(--tile-ok)" icon="box" />} />
        <Kpi value={fmtCount(bare)} label="רכבים בדוח 1 בלי ציוד" tile={<SmallTile color="var(--tile-neutral)" icon="list" />} />
      </div>
      <SearchBox action="/kesher/vehicles" q={f.q} placeholder="מספר רכב, כוננות, צ׳ או פריט" />

      {shown.length ? (
        sections.map(([standby, list]) => {
          const title = standby === null ? "לא ברשימת הרכבים של דוח 1" : standby === NO_STANDBY ? "ללא כוננות" : standby;
          return (
            <section key={standby ?? "\u0000"} className="flex flex-col gap-2.5" aria-label={title}>
              <h2 className="flex items-center gap-2 px-1 text-[15px] font-semibold">
                {title}
                <span className="text-[13px] font-normal text-ink-muted">· {fmtCount(list.length)} רכבים</span>
              </h2>
              {standby === null ? (
                <p className="tz-footnote m-0 px-1">המספרים האלה הגיעו מעמודת &quot;האמר&quot; בגיליון ואינם ברשימת הרכבים של דוח 1. יש להוסיף את הרכב בדוח 1 או לשייך את הצ׳ לרכב מהרשימה.</p>
              ) : null}
              <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list
                  .sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }))
                  .map((c) => (
                    <VehicleCard key={c.number} card={c} refs={refs} admin={access.isAdmin} />
                  ))}
              </div>
            </section>
          );
        })
      ) : (
        <div className="tz-card">
          <Empty>{cards.length ? "לא נמצא רכב תואם" : "עדיין אין ציוד קשר על רכבים. בוחרים רכב מרשימת דוח 1 ומשייכים אליו צ׳ וציוד משלים."}</Empty>
        </div>
      )}
    </>
  );

  if (!access.isAdmin) return page;
  return (
    <VehicleProvider
      vehicles={vehicles.map((v) => ({
        id: v.id,
        number: v.number,
        label: vehicleLabel(v),
        stock: Object.fromEntries(data.vehicleStock.get(v.id) ?? []),
      }))}
      serials={data.serials.map((x) => ({
        id: x.id,
        serial: x.serial,
        item: x.itemName,
        place: x.location === "company" ? (refs.get(x.unitId ?? "")?.name ?? "פלוגה") : x.location === "warehouse" ? "במחסן" : "ללא שיוך",
        vehicle: x.vehicle,
      }))}
      items={data.items.filter((i) => i.kind === "bulk").map((i) => ({ id: i.id, name: i.name, available: data.available(i.id) }))}
    >
      {page}
    </VehicleProvider>
  );
}

function VehicleCard({ card, refs, admin }: { card: Card; refs: ReadonlyMap<string, CompanyRef>; admin: boolean }) {
  const { number, vehicle, gear, bulk } = card;
  const sorted = [...gear].sort((a, b) => byHe(a.itemName, b.itemName) || a.serial.localeCompare(b.serial, "en", { numeric: true }));
  const companies = [...new Set(gear.filter((x) => x.location === "company").map((x) => x.unitId!))];
  return (
    <article className="tz-card flex flex-col" aria-label={`רכב ${number}`}>
      <header className="flex items-center gap-3 border-b border-separator px-4 py-3">
        <SmallTile color={companies.length === 1 ? (refs.get(companies[0]!)?.color ?? "var(--tile-neutral)") : "var(--tile-neutral)"} icon="truck" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[16px] font-semibold">
            <Serial>{number}</Serial>
            {vehicle?.kind ? <span className="ms-2 text-[13px] font-normal text-ink-muted">{vehicle.kind}</span> : null}
          </span>
          <span className="text-xs text-ink-muted">
            {vehicle ? (vehicle.standby ? `כוננות: ${vehicle.standby}` : "לא משויך לכוננות") : "לא ברשימת דוח 1"}
          </span>
        </span>
        {vehicle && vehicle.state !== "ok" ? <Chip tone="broken">{vehicle.state === "broken" ? "תקול" : "בטיפול"}</Chip> : null}
        {admin && vehicle ? <EditVehicleButton vehicleId={vehicle.id} label={number} /> : null}
      </header>
      {sorted.length ? (
        <ul className="m-0 list-none p-0">
          {sorted.map((x) => (
            <li key={x.id} className="flex items-center gap-2 border-b border-separator px-4 py-2 text-[14px] last:border-0">
              <span className="min-w-0 flex-1">
                {x.itemName}
                {x.holder?.holder ? <span className="block text-xs text-ink-muted">{[x.holder.holder.name, x.holder.holderRole].filter(Boolean).join(" · ")}</span> : null}
              </span>
              {x.location === "company" ? (
                refs.get(x.unitId ?? "") ? <CompanyChip company={refs.get(x.unitId ?? "")!} /> : null
              ) : (
                <LocationChip serial={x} />
              )}
              <Link href={`/kesher/serials?sel=${x.id}`} className="no-underline">
                <Serial>{x.serial}</Serial>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {bulk.length ? (
        <div className="flex flex-col gap-1 border-t border-separator px-4 py-2.5">
          <span className="tz-footnote">ציוד משלים</span>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[14px]">
            {bulk.map((b) => (
              <li key={b.name}>
                {b.name} <span className="tz-num font-semibold">×{fmtCount(b.qty)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
