/**
 * Selected change lines → writes, inside the caller's transaction (withUser for the app, so RLS
 * checks every write again). Never writes `people` or `units`. Any failure throws, and the
 * caller's transaction rolls the whole import back.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../index";
import * as schema from "../schema/index";
import { BLOCKED_REASON, chunks, expectRow } from "../sheet-import/index";
import { SHEET_NAMES, type SheetKey } from "./sheet";
import { LINE_GROUPS, type ChangeLine, type ChangeOp, type LineGroup, type OpKind, type SheetDiff } from "./types";

const { logisticsItems: items, logisticsKitItems: kitItems, logisticsSerials: serials } = schema;
const { logisticsAssignments: assignments, logisticsStorage: storage, logisticsEvents: events } = schema;

export interface ApplyResult {
  applied: Record<LineGroup, number>;
  blocked: { id: string; reason: string }[];
  /** 'לוג' rows written as events */
  logEvents: number;
}

/** Dependencies always point at an earlier kind in this order. */
const ORDER: readonly OpKind[] = [
  "item.add",
  "item.update",
  "serial.add",
  "serial.condition",
  "kit.add",
  "kit.remove",
  "assignment.return",
  "assignment.transfer",
  "assignment.add",
  "assignment.kit",
  "storage.release",
  "storage.add",
  "serial.delete",
  "log.add",
];
const INSERT_CHUNK = 500;
export { BLOCKED_REASON };

type Op<K extends OpKind> = Extract<ChangeOp, { t: K }>;

/**
 * Applies the lines that are in `selected`, selectable and have an op. Ids not in the diff are
 * ignored. A line whose dependency is not applied is skipped and listed in `blocked`.
 */
export async function applyLogistics(tx: Tx, diff: SheetDiff, selected: ReadonlySet<string>): Promise<ApplyResult> {
  const rank = (l: ChangeLine) => ORDER.indexOf(l.op!.t);
  const picked = diff.lines.filter((l) => selected.has(l.id) && l.selectable && l.op).sort((a, b) => rank(a) - rank(b));

  const result: ApplyResult = { applied: Object.fromEntries(LINE_GROUPS.map((g) => [g, 0])) as Record<LineGroup, number>, blocked: [], logEvents: 0 };
  const toApply: ChangeLine[] = [];
  const willApply = new Set<string>();
  for (const line of picked) {
    if (line.dependsOn.every((d) => willApply.has(d))) {
      willApply.add(line.id);
      toApply.push(line);
      result.applied[line.group]++;
    } else result.blocked.push({ id: line.id, reason: BLOCKED_REASON });
  }
  const ops = <K extends OpKind>(t: K) => toApply.map((l) => l.op!).filter((o): o is Op<K> => o.t === t);

  const itemIds = new Map((await tx.select({ id: items.id, name: items.name }).from(items)).map((i) => [i.name, i.id]));
  const serialIds = new Map((await tx.select({ id: serials.id, serial: serials.serial }).from(serials)).map((s) => [s.serial, s.id]));
  const itemId = (name: string) => itemIds.get(name) ?? fail(`item "${name}" missing`);
  const serialId = (serial: string) => serialIds.get(serial) ?? fail(`serial ${serial} missing`);
  const now = new Date();

  for (const part of chunks(ops("item.add"), INSERT_CHUNK)) {
    const rows = await tx
      .insert(items)
      .values(part.map((o) => ({ name: o.name, category: o.category, subcategory: o.subcategory, sku: o.sku })))
      .returning({ id: items.id, name: items.name });
    for (const r of rows) itemIds.set(r.name, r.id);
  }
  for (const o of ops("item.update")) {
    const set = { category: o.category, subcategory: o.subcategory, sku: o.sku };
    expectRow(await tx.update(items).set(set).where(eq(items.id, o.itemId)).returning({ id: items.id }), "item");
  }

  for (const part of chunks(ops("serial.add"), INSERT_CHUNK)) {
    const rows = await tx
      .insert(serials)
      .values(part.map((o) => ({ itemId: itemId(o.itemName), serial: o.serial, category: o.category, condition: o.condition })))
      .returning({ id: serials.id, serial: serials.serial });
    for (const r of rows) serialIds.set(r.serial, r.id);
  }
  for (const o of ops("serial.condition")) {
    expectRow(await tx.update(serials).set({ condition: o.condition }).where(eq(serials.id, o.serialId)).returning({ id: serials.id }), "serial");
  }

  for (const part of chunks(ops("kit.add"), INSERT_CHUNK)) {
    await tx.insert(kitItems).values(part.map((o) => ({ itemId: itemId(o.itemName), name: o.name, qty: o.qty, sortOrder: o.sortOrder })));
  }
  for (const o of ops("kit.remove")) {
    expectRow(await tx.delete(kitItems).where(eq(kitItems.id, o.kitItemId)).returning({ id: kitItems.id }), "kit line");
  }

  // returning / moving a serial closes its open assignment and its open אפסון row, like the app's return action
  const close = async (assignmentId: string) => {
    const row = expectRow(
      await tx
        .update(assignments)
        .set({ returnedAt: now })
        .where(and(eq(assignments.id, assignmentId), isNull(assignments.returnedAt)))
        .returning({ serialId: assignments.serialId }),
      "assignment",
    );
    await tx
      .update(storage)
      .set({ releasedAt: now })
      .where(and(eq(storage.serialId, row.serialId), isNull(storage.releasedAt)));
  };
  for (const o of ops("assignment.return")) await close(o.assignmentId);
  const transfers = ops("assignment.transfer");
  for (const o of transfers) await close(o.assignmentId);

  const newAssignments = [...transfers, ...ops("assignment.add")].map((o) => ({
    serialId: serialId(o.serial),
    personId: o.personId,
    notes: o.notes,
    kit: o.kit,
  }));
  for (const part of chunks(newAssignments, INSERT_CHUNK)) await tx.insert(assignments).values(part);
  for (const o of ops("assignment.kit")) {
    expectRow(await tx.update(assignments).set({ kit: o.kit }).where(eq(assignments.id, o.assignmentId)).returning({ id: assignments.id }), "assignment");
  }

  for (const o of ops("storage.release")) {
    const set = { releasedAt: new Date(o.releasedAt) };
    expectRow(await tx.update(storage).set(set).where(eq(storage.id, o.storageId)).returning({ id: storage.id }), "storage row");
  }
  const newStorage = ops("storage.add").map((o) => ({
    personId: o.personId,
    serialId: o.serial ? serialId(o.serial) : null,
    itemName: o.itemName,
    storedAt: new Date(o.storedAt),
    releasedAt: o.releasedAt ? new Date(o.releasedAt) : null,
  }));
  for (const part of chunks(newStorage, INSERT_CHUNK)) await tx.insert(storage).values(part);

  const deletes = ops("serial.delete").map((o) => o.serialId);
  for (const part of chunks(deletes, INSERT_CHUNK)) {
    const rows = await tx.delete(serials).where(inArray(serials.id, part)).returning({ id: serials.id });
    if (rows.length !== part.length) throw new Error("Sheet import: a serial was not deleted");
  }

  // actor_name is set to the importer by the logistics_events_actor trigger; the sheet's actor is sheet_actor
  const logRows = ops("log.add").flatMap((o) => o.events.map((e) => ({ ...e, at: new Date(e.at) })));
  for (const part of chunks(logRows, INSERT_CHUNK)) {
    const rows = await tx.insert(events).values(part).onConflictDoNothing().returning({ id: events.id });
    result.logEvents += rows.length;
  }

  return result;
}

function fail(what: string): never {
  throw new Error(`Sheet import: ${what}`);
}

const FILE_NAME_MAX = 120;

/** The import's line in the logistics log. Counts and tab names only — never cell values. */
export function summarizeImport(fileName: string, tabs: readonly SheetKey[], result: ApplyResult, unticked: number): string {
  const name = fileName.length > FILE_NAME_MAX ? `${fileName.slice(0, FILE_NAME_MAX)}…` : fileName;
  const a = result.applied;
  return [
    name,
    `לשוניות: ${tabs.map((t) => SHEET_NAMES[t]).join(", ")}`,
    `חדשים ${a.new}`,
    `שינויים ${a.change}`,
    `הוסרו ${a.appOnly}`,
    `לא סומנו ${unticked}`,
    ...(result.logEvents ? [`פעולות מהלוג ${result.logEvents}`] : []),
  ].join(" · ");
}
