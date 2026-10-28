/**
 * Snapshot of the app's logistics data that the diff compares the sheet against.
 * Read through the caller's transaction, so RLS decides what is visible.
 */
import { isNotNull } from "drizzle-orm";
import type { Condition, KitLine } from "@gdud/core";
import type { Tx } from "../index";
import * as schema from "../schema/index";
import { loadPreviousNames } from "../sheet-import/previous-names";
import { nameKey } from "./sheet";

const { people } = schema;
const { logisticsItems: items, logisticsKitItems: kitItems, logisticsSerials: serials } = schema;
const { logisticsAssignments: assignments, logisticsStorage: storage, logisticsEvents: events } = schema;

export interface PersonRef {
  id: string;
  fullName: string;
  personalNumber: string | null;
}
export interface ItemRef {
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  sku: string | null;
}
export interface KitRef {
  id: string;
  itemId: string;
  name: string;
}
export interface SerialRef {
  id: string;
  serial: string;
  itemId: string;
  condition: Condition;
}
export interface OpenAssignment {
  id: string;
  serialId: string;
  personId: string;
  notes: string | null;
  kit: KitLine[];
}
export interface StorageRef {
  id: string;
  personId: string;
  serialId: string | null;
  itemName: string;
  storedAt: Date;
  releasedAt: Date | null;
}

export interface State {
  peopleById: Map<string, PersonRef>;
  peopleByPid: Map<string, PersonRef>;
  /** nameKey(full name) → everyone with that name */
  peopleByName: Map<string, PersonRef[]>;
  /** nameKey(a previous name, from an approved ניהול פלוגה name change) → soldiers once called that */
  peopleByPreviousName: Map<string, PersonRef[]>;
  itemsByName: Map<string, ItemRef>;
  itemsById: Map<string, ItemRef>;
  kit: KitRef[];
  serialsBySerial: Map<string, SerialRef>;
  serialsById: Map<string, SerialRef>;
  /** serialId → its open assignment */
  openAssignments: Map<string, OpenAssignment>;
  storage: StorageRef[];
  /** serial ids with any assignment or storage row, open or closed (not deletable) */
  usedSerials: Set<string>;
  /** sheet_key of every 'לוג' row already imported */
  logKeys: Set<string>;
}

export async function loadState(tx: Tx): Promise<State> {
  const state: State = {
    peopleById: new Map(),
    peopleByPid: new Map(),
    peopleByName: new Map(),
    peopleByPreviousName: new Map(),
    itemsByName: new Map(),
    itemsById: new Map(),
    kit: [],
    serialsBySerial: new Map(),
    serialsById: new Map(),
    openAssignments: new Map(),
    storage: [],
    usedSerials: new Set(),
    logKeys: new Set(),
  };

  const ppl = await tx.select({ id: people.id, fullName: people.fullName, personalNumber: people.personalNumber }).from(people);
  for (const p of ppl) {
    state.peopleById.set(p.id, p);
    if (p.personalNumber) state.peopleByPid.set(p.personalNumber, p);
    const key = nameKey(p.fullName);
    state.peopleByName.set(key, [...(state.peopleByName.get(key) ?? []), p]);
  }
  for (const prev of await loadPreviousNames(tx)) {
    const p = state.peopleById.get(prev.personId);
    const key = nameKey(prev.name);
    if (!p || key === nameKey(p.fullName)) continue;
    const list = state.peopleByPreviousName.get(key) ?? [];
    if (!list.includes(p)) state.peopleByPreviousName.set(key, [...list, p]);
  }

  const itemRows = await tx
    .select({ id: items.id, name: items.name, category: items.category, subcategory: items.subcategory, sku: items.sku })
    .from(items);
  for (const i of itemRows) {
    state.itemsByName.set(i.name, i);
    state.itemsById.set(i.id, i);
  }

  state.kit = await tx.select({ id: kitItems.id, itemId: kitItems.itemId, name: kitItems.name }).from(kitItems);

  const serialRows = await tx
    .select({ id: serials.id, serial: serials.serial, itemId: serials.itemId, condition: serials.condition })
    .from(serials);
  for (const s of serialRows) {
    state.serialsBySerial.set(s.serial, s);
    state.serialsById.set(s.id, s);
  }

  const asg = await tx
    .select({
      id: assignments.id,
      serialId: assignments.serialId,
      personId: assignments.personId,
      notes: assignments.notes,
      kit: assignments.kit,
      returnedAt: assignments.returnedAt,
    })
    .from(assignments);
  for (const { returnedAt, ...a } of asg) {
    state.usedSerials.add(a.serialId);
    if (!returnedAt) state.openAssignments.set(a.serialId, a);
  }

  state.storage = await tx
    .select({
      id: storage.id,
      personId: storage.personId,
      serialId: storage.serialId,
      itemName: storage.itemName,
      storedAt: storage.storedAt,
      releasedAt: storage.releasedAt,
    })
    .from(storage);
  for (const s of state.storage) if (s.serialId) state.usedSerials.add(s.serialId);

  const logged = await tx.select({ key: events.sheetKey }).from(events).where(isNotNull(events.sheetKey));
  for (const e of logged) state.logKeys.add(e.key!);

  return state;
}
