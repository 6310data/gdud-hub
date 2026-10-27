/**
 * Snapshot of the app's kesher data that the diff compares the sheet against. Read through the
 * caller's transaction, so RLS decides what is visible (the import runs as a battalion admin).
 */
import { isNotNull } from "drizzle-orm";
import { ancestorOfKind, searchKey, type KesherLocation } from "@gdud/core";
import type { Tx } from "../index";
import * as schema from "../schema/index";
import { nameKey } from "./sheet";

const { units, people, kesherItems, kesherKitItems, kesherSerials, kesherHolders, kesherStock, kesherEvents, kesherChecks, kesherCheckLines, kesherSettings } =
  schema;

export interface CompanyRef {
  id: string;
  name: string;
}
export interface PersonRef {
  id: string;
  fullName: string;
  /** "פלס״ר · מחלקה 1" — shown when a name matches several soldiers */
  place: string;
}
export interface ItemRef {
  id: string;
  name: string;
  kind: "serial" | "bulk";
  category: string | null;
  brigadeQty: number | null;
}
export interface SerialRef {
  id: string;
  serial: string;
  itemId: string;
  location: KesherLocation;
  unitId: string | null;
  vehicle: string | null;
  notes: string | null;
}
export interface HolderRef {
  unitId: string;
  signerPersonId: string | null;
  signerRole: string | null;
  holderPersonId: string | null;
  holderRole: string | null;
  frame: string | null;
}
export interface KitRef {
  id: string;
  parentItemId: string;
  itemId: string;
  qty: number;
}

export interface State {
  /** searchKey(company name) → company (active companies only) */
  companiesByKey: Map<string, CompanyRef>;
  companiesById: Map<string, CompanyRef>;
  peopleById: Map<string, PersonRef>;
  /** `${companyId}|${searchKey(full name)}` → the active soldiers of that company with that name */
  peopleByName: Map<string, PersonRef[]>;
  itemsByName: Map<string, ItemRef>;
  itemsById: Map<string, ItemRef>;
  kits: KitRef[];
  serialsBySerial: Map<string, SerialRef>;
  serialsById: Map<string, SerialRef>;
  /** serialId → holder row */
  holders: Map<string, HolderRef>;
  /** `${itemId}|${unitId ?? ""}` → qty */
  stock: Map<string, number>;
  warehouseTracked: boolean;
  logKeys: Set<string>;
  /** sheet_key → check id, for reports already imported */
  checkKeys: Map<string, string>;
  /** `${checkId}|${serial}` of lines already in the app */
  checkLineKeys: Set<string>;
}

export const personKey = (companyId: string, name: string) => `${companyId}|${searchKey(nameKey(name))}`;
export const stockKey = (itemId: string, unitId: string | null) => `${itemId}|${unitId ?? ""}`;

export async function loadState(tx: Tx): Promise<State> {
  const st: State = {
    companiesByKey: new Map(),
    companiesById: new Map(),
    peopleById: new Map(),
    peopleByName: new Map(),
    itemsByName: new Map(),
    itemsById: new Map(),
    kits: [],
    serialsBySerial: new Map(),
    serialsById: new Map(),
    holders: new Map(),
    stock: new Map(),
    warehouseTracked: true,
    logKeys: new Set(),
    checkKeys: new Map(),
    checkLineKeys: new Set(),
  };

  const unitRows = await tx.select({ id: units.id, parentId: units.parentId, kind: units.kind, name: units.name, active: units.active }).from(units);
  const unitById = new Map(unitRows.map((u) => [u.id, u]));
  for (const u of unitRows) {
    if (u.kind !== "company" || !u.active) continue;
    const ref = { id: u.id, name: u.name };
    st.companiesById.set(u.id, ref);
    st.companiesByKey.set(searchKey(u.name), ref);
  }

  const ppl = await tx.select({ id: people.id, fullName: people.fullName, unitId: people.unitId, active: people.active }).from(people);
  for (const p of ppl) {
    const company = ancestorOfKind(p.unitId, "company", unitById);
    const platoon = ancestorOfKind(p.unitId, "platoon", unitById);
    const ref: PersonRef = { id: p.id, fullName: p.fullName, place: [company?.name, platoon?.name].filter(Boolean).join(" · ") };
    st.peopleById.set(p.id, ref);
    if (!p.active || !company) continue;
    const key = personKey(company.id, p.fullName);
    st.peopleByName.set(key, [...(st.peopleByName.get(key) ?? []), ref]);
  }

  for (const i of await tx
    .select({ id: kesherItems.id, name: kesherItems.name, kind: kesherItems.kind, category: kesherItems.category, brigadeQty: kesherItems.brigadeQty })
    .from(kesherItems)) {
    st.itemsByName.set(i.name, i);
    st.itemsById.set(i.id, i);
  }
  st.kits = await tx
    .select({ id: kesherKitItems.id, parentItemId: kesherKitItems.parentItemId, itemId: kesherKitItems.itemId, qty: kesherKitItems.qty })
    .from(kesherKitItems);

  for (const s of await tx
    .select({
      id: kesherSerials.id,
      serial: kesherSerials.serial,
      itemId: kesherSerials.itemId,
      location: kesherSerials.location,
      unitId: kesherSerials.unitId,
      vehicle: kesherSerials.vehicle,
      notes: kesherSerials.notes,
    })
    .from(kesherSerials)) {
    st.serialsBySerial.set(s.serial, s);
    st.serialsById.set(s.id, s);
  }
  for (const { serialId, ...h } of await tx
    .select({
      serialId: kesherHolders.serialId,
      unitId: kesherHolders.unitId,
      signerPersonId: kesherHolders.signerPersonId,
      signerRole: kesherHolders.signerRole,
      holderPersonId: kesherHolders.holderPersonId,
      holderRole: kesherHolders.holderRole,
      frame: kesherHolders.frame,
    })
    .from(kesherHolders)) {
    st.holders.set(serialId, h);
  }
  for (const s of await tx.select({ itemId: kesherStock.itemId, unitId: kesherStock.unitId, qty: kesherStock.qty }).from(kesherStock)) {
    st.stock.set(stockKey(s.itemId, s.unitId), s.qty);
  }
  const [settings] = await tx.select({ warehouseTracked: kesherSettings.warehouseTracked }).from(kesherSettings);
  st.warehouseTracked = settings?.warehouseTracked ?? true;

  for (const e of await tx.select({ key: kesherEvents.sheetKey }).from(kesherEvents).where(isNotNull(kesherEvents.sheetKey))) st.logKeys.add(e.key!);
  for (const c of await tx.select({ id: kesherChecks.id, key: kesherChecks.sheetKey }).from(kesherChecks).where(isNotNull(kesherChecks.sheetKey))) {
    st.checkKeys.set(c.key!, c.id);
  }
  for (const l of await tx.select({ checkId: kesherCheckLines.checkId, serial: kesherCheckLines.serial }).from(kesherCheckLines)) {
    st.checkLineKeys.add(`${l.checkId}|${l.serial}`);
  }
  return st;
}
