import { notFound } from "next/navigation";
import { z } from "zod";
import { kitToString } from "@gdud/core";
import { withUser } from "@gdud/db";
import { logisticsAccess } from "@/lib/logistics/access";
import { groupBy, loadHoldings, loadPeople, loadStorage, personPlace } from "@/lib/logistics/data";
import { requireModule } from "@/lib/session";
import { ReturnForm, type ReturnData } from "./return-form";

export const metadata = { title: "זיכוי" };

export default async function ReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);
  if (!access.isAdmin) notFound();
  const sp = z
    .object({ person: z.uuid().optional().catch(undefined), assignment: z.uuid().optional().catch(undefined) })
    .parse(await searchParams);

  const { people, holdings, stored } = await withUser(s.claims, async (tx) => {
    const [people, holdings, stored] = await Promise.all([loadPeople(tx, s.units, { includeInactive: true }), loadHoldings(tx), loadStorage(tx)]);
    return { people, holdings, stored };
  });
  const byPerson = groupBy(holdings, (h) => h.personId);
  const storedSerials = new Set(stored.map((x) => x.serialId).filter(Boolean));
  const holders = people.filter((p) => byPerson.has(p.id) && access.canAdminUnit(p.unitId));

  const data: ReturnData = {
    people: holders.map((p) => ({
      id: p.id,
      name: p.name,
      personalNumber: p.personalNumber,
      place: personPlace(p),
      keywords: byPerson.get(p.id)!.map((h) => h.serial).join(" | "),
      badge: byPerson.get(p.id)!.length,
    })),
    holdings: Object.fromEntries(
      holders.map((p) => [
        p.id,
        byPerson.get(p.id)!.map((h) => ({
          id: h.id,
          item: h.itemName,
          serial: h.serial,
          sub: [kitToString(h.kit), h.notes].filter(Boolean).join(" · "),
          stored: storedSerials.has(h.serialId),
        })),
      ]),
    ),
  };

  const initialPerson = sp.person && data.holdings[sp.person] ? sp.person : undefined;
  return <ReturnForm data={data} initialPersonId={initialPerson} initialAssignmentId={sp.assignment} />;
}
