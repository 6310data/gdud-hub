import { notFound } from "next/navigation";
import { byHe, checkAge } from "@gdud/core";
import { withUser } from "@gdud/db";
import { PageHeader } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { groupBy, loadKesher, loadLastEye, type KSerial } from "@/lib/kesher/data";
import { companiesOf } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { AgeChip } from "../_components/ui";
import { EyeForm, type EyePlace } from "./_components/eye-form";

export const metadata = { title: "צהוב בעיניים" };

/**
 * צהוב בעיניים (battalion kesher admin): someone of מחלקת הקשר ticks every צ׳ they saw with their
 * own eyes. Every צ׳ in the battalion (not the ones returned to the brigade), by place — the
 * warehouse, each company, ללא שיוך — then device type, the longest unchecked first.
 */
export default async function KesherEye() {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  if (!access.isAdmin) notFound();
  const now = new Date();

  const { data, lastEye } = await withUser(s.claims, async (tx) => {
    const [data, lastEye] = await Promise.all([loadKesher(tx, s.units), loadLastEye(tx)]);
    return { data, lastEye };
  });

  const placeKey = (x: KSerial) => (x.location === "company" ? (x.unitId ?? "none") : x.location);
  const byPlace = groupBy(data.serials, placeKey);
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const companies = companiesOf(s.units).map((c) => c.id);
  // a company that is no longer active still shows, after the active ones
  const others = [...byPlace.keys()].filter((k) => k !== "warehouse" && k !== "none" && !companies.includes(k));
  const order = ["warehouse", ...companies, ...others, "none"];

  const ageMs = (x: KSerial) => lastEye.get(x.id)?.at.getTime() ?? Number.NEGATIVE_INFINITY;
  const places: EyePlace[] = order
    .filter((k) => byPlace.has(k))
    .map((k) => ({
      id: k,
      name: k === "warehouse" ? "מחסן" : k === "none" ? "ללא שיוך" : (unitById.get(k)?.name ?? "פלוגה"),
      color: unitById.get(k)?.color ?? null,
      groups: [...groupBy(byPlace.get(k)!, (x) => x.itemName)]
        .sort(([a], [b]) => byHe(a, b))
        .map(([type, list]) => ({
          type,
          rows: [...list]
            .sort((a, b) => ageMs(a) - ageMs(b))
            .map((x) => {
              const eye = lastEye.get(x.id);
              return {
                id: x.id,
                serial: x.serial,
                holder: x.holder?.holder?.name ?? null,
                tone: checkAge(eye?.at, now, data.warnDays, data.alertDays).tone,
                chip: <AgeChip at={eye?.at} by={eye?.byName} now={now} warnDays={data.warnDays} alertDays={data.alertDays} />,
              };
            }),
        })),
    }));

  return (
    <>
      <PageHeader
        title="צהוב בעיניים"
        sub={`${fmtCount(data.serials.length)} צ׳ · מסמנים כל צ׳ שראיתם בעיניים · צהוב אחרי ${data.warnDays} ימים, אדום אחרי ${data.alertDays}`}
      />
      <EyeForm places={places} />
    </>
  );
}
