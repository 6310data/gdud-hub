import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withUser } from "@gdud/db";
import { logisticsAccess } from "@/lib/logistics/access";
import { groupBy, loadHoldings, loadItems, loadPeople, loadStorage, personPlace } from "@/lib/logistics/data";
import { fmtDate } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import type { StorageData } from "./storage-form";

/** Data for the store-in / store-out screens (admins; soldiers they may act for). */
export async function loadStorageForm(
  mode: StorageData["mode"],
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<{ data: StorageData; initialPersonId?: string }> {
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);
  if (!access.isAdmin) notFound();
  const { person } = z.object({ person: z.uuid().optional().catch(undefined) }).parse(await searchParams);

  const { people, holdings, stored, items } = await withUser(s.claims, async (tx) => ({
    people: await loadPeople(tx, s.units, { includeInactive: true }),
    holdings: await loadHoldings(tx),
    stored: await loadStorage(tx),
    items: mode === "in" ? await loadItems(tx) : [],
  }));
  const storedSerials = new Set(stored.map((x) => x.serialId).filter(Boolean));
  const source = mode === "in" ? groupBy(holdings, (h) => h.personId) : groupBy(stored, (x) => x.personId);
  const eligible = people.filter((p) => source.has(p.id) && access.canAdminUnit(p.unitId));

  const lines: StorageData["lines"] = {};
  for (const p of eligible) {
    lines[p.id] =
      mode === "in"
        ? holdings
            .filter((h) => h.personId === p.id)
            .map((h) => ({ id: h.serialId, item: h.itemName, serial: h.serial, disabledReason: storedSerials.has(h.serialId) ? "כבר באפסון" : undefined }))
        : stored.filter((x) => x.personId === p.id).map((x) => ({ id: x.id, item: x.itemName, serial: x.serial, sub: `מ-${fmtDate(x.storedAt)}` }));
  }

  const data: StorageData = {
    mode,
    people: eligible.map((p) => ({
      id: p.id,
      name: p.name,
      personalNumber: p.personalNumber,
      place: personPlace(p),
      keywords: (lines[p.id] ?? []).map((l) => l.serial ?? "").join(" | "),
      badge: lines[p.id]?.length ?? 0,
    })),
    lines,
    itemNames: items.map((i) => i.name),
  };
  return { data, initialPersonId: person && lines[person] ? person : undefined };
}
