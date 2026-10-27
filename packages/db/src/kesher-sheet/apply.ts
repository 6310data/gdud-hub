/**
 * Selected change lines → writes, inside the caller's transaction (withUser, so RLS and the
 * kesher triggers check every write again). Never writes `people` or `units`. Any failure throws,
 * and the caller's transaction rolls the whole import back.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../index";
import * as schema from "../schema/index";
import { BLOCKED_REASON, chunks, expectRow } from "../sheet-import/index";
import { LINE_GROUPS, type LineGroup } from "../sheet-import/preview";
import { KESHER_TABS, COMPANY_TABS_NAME, type KesherSheetKey } from "./sheet";
import type { ApplyResult, ChangeLine, ChangeOp, OpKind, SheetDiff } from "./types";

const { kesherItems: items, kesherKitItems: kits, kesherSerials: serials, kesherHolders: holders, kesherStock: stock } = schema;
const { kesherEvents: events, kesherChecks: checks, kesherCheckLines: checkLines } = schema;

/** Dependencies always point at an earlier kind in this order. */
const ORDER: readonly OpKind[] = [
  "item.add",
  "item.brigade",
  "serial.add",
  "serial.update",
  "signer.set",
  "holder.set",
  "stock.set",
  "kit.add",
  "kit.qty",
  "kit.remove",
  "serial.delete",
  "log.add",
  "checks.add",
];
const INSERT_CHUNK = 500;

type Op<K extends OpKind> = Extract<ChangeOp, { t: K }>;

function fail(what: string): never {
  throw new Error(`Sheet import: ${what}`);
}

/**
 * Applies the lines that are in `selected`, selectable and have an op. Ids not in the diff are
 * ignored. A line whose dependency is not applied is skipped and listed in `blocked`.
 */
export async function applyKesher(tx: Tx, diff: SheetDiff, selected: ReadonlySet<string>): Promise<ApplyResult> {
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
  const serialRows = await tx.select({ id: serials.id, serial: serials.serial, unitId: serials.unitId }).from(serials);
  const serialIds = new Map(serialRows.map((s) => [s.serial, s.id]));
  const serialUnits = new Map(serialRows.map((s) => [s.serial, s.unitId]));
  const itemId = (name: string) => itemIds.get(name) ?? fail(`item "${name}" missing`);
  const serialId = (serial: string) => serialIds.get(serial) ?? fail(`serial ${serial} missing`);

  for (const part of chunks(ops("item.add"), INSERT_CHUNK)) {
    const rows = await tx
      .insert(items)
      .values(part.map((o) => ({ name: o.name, kind: o.kind, category: o.category, brigadeQty: o.brigadeQty })))
      .returning({ id: items.id, name: items.name });
    for (const r of rows) itemIds.set(r.name, r.id);
  }
  for (const o of ops("item.brigade")) {
    expectRow(await tx.update(items).set({ brigadeQty: o.brigadeQty }).where(eq(items.id, o.itemId)).returning({ id: items.id }), "item");
  }

  // serials; one landing on a company gets its holder row with who signed (unit_id: the serial's, by trigger)
  const newHolders: { serialId: string; unitId: string; signerPersonId: string | null; signerRole: string | null }[] = [];
  for (const part of chunks(ops("serial.add"), INSERT_CHUNK)) {
    const rows = await tx
      .insert(serials)
      .values(part.map((o) => ({ itemId: itemId(o.itemName), serial: o.serial, location: o.location, unitId: o.unitId, vehicle: o.vehicle, notes: o.notes })))
      .returning({ id: serials.id, serial: serials.serial, unitId: serials.unitId });
    for (const r of rows) {
      serialIds.set(r.serial, r.id);
      serialUnits.set(r.serial, r.unitId);
    }
    for (const o of part) {
      if (o.unitId) newHolders.push({ serialId: serialId(o.serial), unitId: o.unitId, signerPersonId: o.signer?.personId ?? null, signerRole: o.signer?.role ?? null });
    }
  }
  for (const o of ops("serial.update")) {
    const [row] = await tx
      .update(serials)
      .set({ location: o.location, unitId: o.unitId, vehicle: o.vehicle, notes: o.notes })
      .where(eq(serials.id, o.serialId))
      .returning({ id: serials.id, serial: serials.serial });
    if (!row) fail("serial was not updated");
    serialUnits.set(row.serial, o.unitId);
    // moved onto a company: the trigger dropped the old holder row
    if (o.unitId && o.signer) newHolders.push({ serialId: row.id, unitId: o.unitId, signerPersonId: o.signer.personId, signerRole: o.signer.role });
  }
  for (const part of chunks(newHolders, INSERT_CHUNK)) await tx.insert(holders).values(part).onConflictDoNothing();

  /** The holder row of a צ׳ on a company, created (empty) if it has none yet. */
  const ensureHolder = async (serial: string) => {
    const id = serialId(serial);
    const unitId = serialUnits.get(serial) ?? fail(`serial ${serial} is not on a company`);
    await tx.insert(holders).values({ serialId: id, unitId }).onConflictDoNothing();
    return id;
  };
  for (const o of ops("signer.set")) {
    const id = await ensureHolder(o.serial);
    expectRow(
      await tx.update(holders).set({ signerPersonId: o.personId, signerRole: o.role }).where(eq(holders.serialId, id)).returning({ id: holders.serialId }),
      "signer",
    );
  }
  for (const o of ops("holder.set")) {
    const id = await ensureHolder(o.serial);
    expectRow(
      await tx
        .update(holders)
        .set({ holderPersonId: o.personId, holderRole: o.role, frame: o.frame })
        .where(eq(holders.serialId, id))
        .returning({ id: holders.serialId }),
      "holder",
    );
  }

  for (const o of ops("stock.set")) {
    const item = itemId(o.itemName);
    for (const c of o.cells) {
      const where = and(eq(stock.itemId, item), c.unitId ? eq(stock.unitId, c.unitId) : isNull(stock.unitId));
      const updated = await tx.update(stock).set({ qty: c.qty }).where(where).returning({ id: stock.id });
      if (!updated.length) await tx.insert(stock).values({ itemId: item, unitId: c.unitId, qty: c.qty });
    }
  }

  for (const part of chunks(ops("kit.add"), INSERT_CHUNK)) {
    await tx.insert(kits).values(part.map((o) => ({ parentItemId: itemId(o.parentName), itemId: itemId(o.childName), qty: o.qty, sortOrder: o.sortOrder })));
  }
  for (const o of ops("kit.qty")) {
    expectRow(await tx.update(kits).set({ qty: o.qty }).where(eq(kits.id, o.kitId)).returning({ id: kits.id }), "kit line");
  }
  for (const o of ops("kit.remove")) {
    expectRow(await tx.delete(kits).where(eq(kits.id, o.kitId)).returning({ id: kits.id }), "kit line");
  }

  const deletes = ops("serial.delete").map((o) => o.serialId);
  for (const part of chunks(deletes, INSERT_CHUNK)) {
    const rows = await tx.delete(serials).where(inArray(serials.id, part)).returning({ id: serials.id });
    if (rows.length !== part.length) fail("a serial was not deleted");
  }

  // actor_name is the importer (kesher_events_actor); the sheet's typed issuer is sheet_actor
  const logRows = ops("log.add").flatMap((o) => o.events.map((e) => ({ ...e, at: new Date(e.at) })));
  for (const part of chunks(logRows, INSERT_CHUNK)) {
    const rows = await tx.insert(events).values(part).onConflictDoNothing().returning({ id: events.id });
    result.logEvents += rows.length;
  }

  // reports first (their lines may come from either tab), then the lines by the report's sheet key
  const checkOps = ops("checks.add");
  const checkIds = new Map<string, string>();
  for (const part of chunks(checkOps.flatMap((o) => o.checks), INSERT_CHUNK)) {
    const rows = await tx
      .insert(checks)
      .values(part.map((c) => ({ ...c, at: new Date(c.at) })))
      .onConflictDoNothing()
      .returning({ id: checks.id, key: checks.sheetKey });
    for (const r of rows) checkIds.set(r.key!, r.id);
  }
  const lines = checkOps.flatMap((o) => o.lines);
  const missing = [...new Set(lines.map((l) => l.checkKey).filter((k) => !checkIds.has(k)))];
  for (const part of chunks(missing, INSERT_CHUNK)) {
    for (const r of await tx.select({ id: checks.id, key: checks.sheetKey }).from(checks).where(inArray(checks.sheetKey, part))) checkIds.set(r.key!, r.id);
  }
  const lineRows = lines.map((l) => ({
    checkId: checkIds.get(l.checkKey) ?? fail("report missing"),
    serialId: serialIds.get(l.serial) ?? null,
    serial: l.serial,
    item: l.item,
    found: l.found,
  }));
  for (const part of chunks(lineRows, INSERT_CHUNK)) await tx.insert(checkLines).values(part).onConflictDoNothing();

  return result;
}

const FILE_NAME_MAX = 120;
const TAB_NAME: Record<KesherSheetKey, string> = { ...KESHER_TABS, companies: COMPANY_TABS_NAME };

/** The import's line in the יומן. Counts and tab names only — never cell values. */
export function summarizeImport(fileName: string, tabs: readonly KesherSheetKey[], result: ApplyResult, unticked: number): string {
  const name = fileName.length > FILE_NAME_MAX ? `${fileName.slice(0, FILE_NAME_MAX)}…` : fileName;
  const a = result.applied;
  return [
    name,
    `לשוניות: ${tabs.map((t) => TAB_NAME[t]).join(", ")}`,
    `חדשים ${a.new}`,
    `שינויים ${a.change}`,
    `הוסרו ${a.appOnly}`,
    `לא סומנו ${unticked}`,
    ...(result.logEvents ? [`רישומים מהיומן ${result.logEvents}`] : []),
  ].join(" · ");
}
