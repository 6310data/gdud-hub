import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { addDays, byHe, israelToday } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Icon } from "@gdud/ui";
import { Empty, PageHeader } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { groupBy, loadKesher, placeTotal, stockKey } from "@/lib/kesher/data";
import { loadPeople, personPlace } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { displayName, requireModule } from "@/lib/session";
import { CompanyDot, pillCount } from "../_components/ui";
import type { KitRecord } from "../sign/_components/parts";
import { CreditForm, type CreditData } from "./_components/credit-form";

export const metadata = { title: "זיכוי מפלוגה" };

const searchSchema = z.object({ unit: z.uuid().optional().catch(undefined) });

/**
 * זיכוי (mockup #/credit), battalion kesher admin only: a company's צ׳ and ציוד משלים back to the
 * warehouse, each תקין or תקול. Company pills (?unit=); the form gets only that company's equipment.
 * Writes through creditFromCompany (_actions/moves.ts).
 */
export default async function KesherCredit({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  if (!access.isAdmin) notFound();
  const f = searchSchema.parse(await searchParams);
  const company = access.companies.find((c) => c.id === f.unit) ?? (access.companies.length === 1 ? access.companies[0] : undefined);

  const { data, soldiers } = await withUser(s.claims, async (tx) => {
    const [data, soldiers] = await Promise.all([loadKesher(tx, s.units), company ? loadPeople(tx, s.units) : Promise.resolve([])]);
    return { data, soldiers };
  });

  const byCompany = groupBy(
    data.serials.filter((x) => x.location === "company"),
    (x) => x.unitId,
  );
  const pills = (
    <nav className="tz-pills" aria-label="פלוגות">
      {access.companies.map((c) => (
        <Link key={c.id} href={`/kesher/credit?unit=${c.id}`} className="tz-pill" aria-current={c.id === company?.id ? "page" : undefined}>
          <CompanyDot color={c.color} />
          {c.name} {pillCount(byCompany.get(c.id)?.length ?? 0)}
        </Link>
      ))}
    </nav>
  );

  if (!company) {
    return (
      <>
        {pills}
        <PageHeader title="זיכוי מפלוגה" sub="ציוד שחוזר מפלוגה למחסן, תקין או תקול. בוחרים פלוגה:" />
        <div className="tz-card">
          <Empty>בחרו פלוגה למעלה.</Empty>
        </div>
      </>
    );
  }

  const mine = byCompany.get(company.id) ?? [];
  const today = israelToday(new Date());
  const kits: KitRecord = Object.fromEntries([...data.kits].map(([parent, lines]) => [parent, lines.map((l) => ({ item: l.item, qty: l.qty }))]));
  const props: CreditData = {
    unitId: company.id,
    companyName: company.name,
    groups: [...groupBy(mine, (x) => x.itemName)]
      .sort(([a], [b]) => byHe(a, b))
      .map(([type, list]) => ({
        type,
        rows: list.map((x) => ({
          id: x.id,
          serial: x.serial,
          holder: [x.holder?.holder?.name, x.holder?.holderRole].filter(Boolean).join(" · ") || null,
        })),
      })),
    items: data.items
      .filter((i) => i.kind === "bulk")
      .map((i) => ({ id: i.id, name: i.name, have: data.stock.get(stockKey(i.id, company.id)) ?? 0 }))
      .filter((i) => i.have > 0),
    kits,
    people: soldiers
      .filter((p) => p.active && p.companyId === company.id)
      .map((p) => ({ id: p.id, name: p.name, personalNumber: p.personalNumber, place: personPlace(p) })),
    user: displayName(s.user, s.claims),
    today,
    minDay: addDays(today, -365),
  };

  return (
    <>
      {pills}
      <PageHeader
        title={`זיכוי · ${company.name}`}
        sub={`${fmtCount(mine.length)} צ׳ · ${fmtCount(placeTotal(data, company.id))} פריטי ציוד משלים על הפלוגה`}
        actions={
          <Link href={`/kesher/companies/${company.id}`} className="tz-btn tz-btn-plain tz-btn-sm">
            <Icon name="close" size={16} />
            ביטול
          </Link>
        }
      />
      {mine.length || props.items.length ? (
        <CreditForm key={company.id} data={props} />
      ) : (
        <div className="tz-card">
          <Empty>אין ציוד על הפלוגה — אין מה לזכות.</Empty>
        </div>
      )}
    </>
  );
}
