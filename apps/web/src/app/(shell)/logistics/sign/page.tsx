import { notFound } from "next/navigation";
import { z } from "zod";
import { withUser } from "@gdud/db";
import { logisticsAccess } from "@/lib/logistics/access";
import { battalionName, loadHoldings, loadPeople, loadStock, personPlace } from "@/lib/logistics/data";
import { requireModule } from "@/lib/session";
import { SignOutForm, type SignData } from "./sign-out-form";

export const metadata = { title: "החתמה חדשה" };

export default async function SignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);
  if (!access.isAdmin) notFound();
  const sp = z
    .object({ person: z.uuid().optional().catch(undefined), serial: z.uuid().optional().catch(undefined) })
    .parse(await searchParams);

  const { stock, people, holdings } = await withUser(s.claims, async (tx) => {
    const [stock, people, holdings] = await Promise.all([loadStock(tx), loadPeople(tx, s.units, { includeInactive: true }), loadHoldings(tx)]);
    return { stock, people, holdings };
  });

  const personById = new Map(people.map((p) => [p.id, p]));
  const holderBySerial = new Map(holdings.map((h) => [h.serialId, h.personId]));
  const signable = people.filter((p) => p.active && access.canAdminUnit(p.unitId));

  const data: SignData = {
    battalion: battalionName(s.units),
    issuedBy: s.user.displayName ?? s.user.email,
    people: signable.map((p) => ({ id: p.id, name: p.name, personalNumber: p.personalNumber, place: personPlace(p) })),
    personCards: Object.fromEntries(
      signable.map((p) => [
        p.id,
        { id: p.id, name: p.name, personalNumber: p.personalNumber, companyName: p.companyName, platoonName: p.platoonName, phone: p.phone },
      ]),
    ),
    items: stock.items.map((i) => ({ id: i.id, name: i.name, category: i.category, kit: i.kit })),
    serials: stock.serials.map((x) => {
      const holderId = holderBySerial.get(x.id);
      return {
        id: x.id,
        serial: x.serial,
        itemId: x.itemId,
        condition: x.condition,
        held: x.held,
        holderId: holderId ?? null,
        holderName: holderId ? (personById.get(holderId)?.name ?? null) : null,
        // transfer only from soldiers the user may also return from
        transferable: Boolean(holderId && access.canAdminUnit(personById.get(holderId)?.unitId)),
      };
    }),
    holdings: holdings.map((h) => ({ personId: h.personId, item: h.itemName, serial: h.serial })),
  };

  return <SignOutForm data={data} initialPersonId={sp.person && data.personCards[sp.person] ? sp.person : undefined} initialSerialId={sp.serial} />;
}
