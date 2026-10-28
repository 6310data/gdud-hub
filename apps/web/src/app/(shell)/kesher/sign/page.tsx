import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { addDays, israelToday } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Icon } from "@gdud/ui";
import { PageHeader } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { loadKesher } from "@/lib/kesher/data";
import { loadPeople, personPlace } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { displayName, requireModule } from "@/lib/session";
import type { KitRecord } from "./_components/parts";
import { SignForm, type SignData } from "./_components/sign-form";

export const metadata = { title: "החתמה לפלוגה" };

const searchSchema = z.object({ unit: z.uuid().optional().catch(undefined) });

/**
 * החתמה (mockup #/sign), battalion kesher admin only: warehouse → a company, signed by a soldier
 * of it. 1 company + soldier · 2 warehouse צ׳ תקינים · 3 the cart with ציוד משלים from the תקן.
 * The מחתים is the signed-in user. Writes through signToCompany (_actions/moves.ts).
 */
export default async function KesherSign({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  if (!access.isAdmin) notFound();
  const f = searchSchema.parse(await searchParams);

  const { data, soldiers } = await withUser(s.claims, async (tx) => {
    const [data, soldiers] = await Promise.all([loadKesher(tx, s.units), loadPeople(tx, s.units)]);
    return { data, soldiers };
  });

  const companyIds = new Set(access.companies.map((c) => c.id));
  const warehouse = data.serials.filter((x) => x.location === "warehouse");
  const kits: KitRecord = Object.fromEntries([...data.kits].map(([parent, lines]) => [parent, lines.map((l) => ({ item: l.item, qty: l.qty }))]));
  const today = israelToday(new Date());

  const props: SignData = {
    companies: access.companies.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    // active soldiers of a company (its subtree): the signer must be one of the chosen company's
    people: soldiers.flatMap((p) =>
      p.active && p.companyId && companyIds.has(p.companyId) ? [{ id: p.id, name: p.name, personalNumber: p.personalNumber, place: personPlace(p), companyId: p.companyId }] : [],
    ),
    serials: warehouse.filter((x) => x.condition === "ok").map((x) => ({ id: x.id, serial: x.serial, item: x.itemName })),
    brokenInWarehouse: warehouse.filter((x) => x.condition !== "ok").length,
    items: data.items.filter((i) => i.kind === "bulk").map((i) => ({ id: i.id, name: i.name, category: i.category, available: Math.max(0, data.available(i.id)) })),
    kits,
    signer: displayName(s.user, s.claims),
    today,
    minDay: addDays(today, -365),
  };
  const initialUnit = f.unit && companyIds.has(f.unit) ? f.unit : undefined;

  return (
    <>
      <PageHeader
        title="החתמה לפלוגה"
        sub={`מהמחסן לפלוגה · ${fmtCount(props.serials.length)} צ׳ תקינים במחסן`}
        actions={
          <Link href={initialUnit ? `/kesher/companies/${initialUnit}` : "/kesher"} className="tz-btn tz-btn-plain tz-btn-sm">
            <Icon name="close" size={16} />
            ביטול
          </Link>
        }
      />
      <SignForm data={props} initialUnit={initialUnit} />
    </>
  );
}
