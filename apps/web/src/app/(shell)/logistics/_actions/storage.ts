"use server";
/**
 * אפסון — ported from storeItems() / releaseItems(). Storing does not return the item:
 * it stays signed on the soldier. Returning or transferring a stored serial closes its storage row.
 */
import { z } from "zod";
import { and, eq, inArray, isNull, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { loadHoldings, loadPerson } from "@/lib/logistics/data";
import { firstIssue, logEvents, logisticsCtx, NO_PERMISSION, revalidateLogistics, uuid } from "./common";

const { people, logisticsStorage: storage, logisticsSerials: serials, logisticsAssignments: assignments } = schema;

const storeSchema = z
  .object({
    personId: uuid,
    notes: z.string().trim().max(300).default(""),
    serialIds: z.array(uuid).max(60).default([]),
    /** items without a serial, by name */
    extras: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  })
  .refine((v) => v.serialIds.length + v.extras.length > 0, "לא נבחרו פריטים");

export async function storeItems(input: z.input<typeof storeSchema>): Promise<ActionOutcome<{ count: number }>> {
  const ctx = await logisticsCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = storeSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { s, access, actorName } = ctx;
  try {
    const count = await withUser(s.claims, async (tx) => {
      const person = await loadPerson(tx, s.units, v.personId);
      if (!person) throw new UserError("החייל לא נמצא");
      if (!access.canAdminUnit(person.unitId)) throw new UserError(NO_PERMISSION.error);

      // lock the soldier's open assignments so a concurrent return can't leave an orphan storage row
      if (v.serialIds.length) {
        await tx
          .select({ id: assignments.id })
          .from(assignments)
          .where(and(eq(assignments.personId, person.id), inArray(assignments.serialId, v.serialIds), isNull(assignments.returnedAt)))
          .for("update");
      }
      const holdings = new Map((await loadHoldings(tx, { personId: person.id })).map((h) => [h.serialId, h]));
      const open = v.serialIds.length
        ? await tx
            .select({ serialId: storage.serialId })
            .from(storage)
            .where(and(inArray(storage.serialId, v.serialIds), isNull(storage.releasedAt)))
        : [];
      const stored = new Set(open.map((o) => o.serialId));
      const errors: string[] = [];
      for (const id of new Set(v.serialIds)) {
        const h = holdings.get(id);
        if (!h) errors.push("אחד הצ׳ים לא מוחתם על החייל – רענן ונסה שוב");
        else if (stored.has(id)) errors.push(`צ׳ ${h.serial} כבר באפסון`);
      }
      if (errors.length) throw new UserError(errors.join("\n"));

      const rows = [
        ...[...new Set(v.serialIds)].map((id) => ({ personId: person.id, serialId: id, itemName: holdings.get(id)!.itemName, notes: v.notes || null })),
        ...v.extras.map((name) => ({ personId: person.id, serialId: null, itemName: name, notes: v.notes || null })),
      ];
      await tx.insert(storage).values(rows);
      await logEvents(
        tx,
        actorName,
        rows.map((r) => ({
          kind: "store" as const,
          personId: person.id,
          personName: person.name,
          item: r.itemName,
          serial: r.serialId ? holdings.get(r.serialId)!.serial : null,
          details: [person.companyName, v.notes].filter(Boolean).join(" | ") || null,
        })),
      );
      return rows.length;
    });
    revalidateLogistics();
    return { ok: true, data: { count } };
  } catch (e) {
    return { error: actionError(e) };
  }
}

const releaseSchema = z.object({
  storageIds: z.array(uuid).min(1, "לא נבחרו פריטים").max(100),
  notes: z.string().trim().max(300).default(""),
});

export async function releaseItems(input: z.input<typeof releaseSchema>): Promise<ActionOutcome<{ count: number }>> {
  const ctx = await logisticsCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { s, access, actorName } = ctx;
  try {
    const count = await withUser(s.claims, async (tx) => {
      const rows = await tx
        .select({
          id: storage.id,
          personId: storage.personId,
          personName: people.fullName,
          unitId: people.unitId,
          itemName: storage.itemName,
          serial: serials.serial,
        })
        .from(storage)
        .innerJoin(people, eq(people.id, storage.personId))
        .leftJoin(serials, eq(serials.id, storage.serialId))
        .where(and(inArray(storage.id, v.storageIds), isNull(storage.releasedAt)));
      if (rows.length !== new Set(v.storageIds).size) throw new UserError("חלק מהפריטים כבר לא באפסון – רענן ונסה שוב");
      if (rows.some((r) => !access.canAdminUnit(r.unitId))) throw new UserError(NO_PERMISSION.error);
      const closed = await tx
        .update(storage)
        .set({ releasedAt: new Date() })
        .where(and(inArray(storage.id, rows.map((r) => r.id)), isNull(storage.releasedAt)))
        .returning({ id: storage.id });
      if (closed.length !== rows.length) throw new UserError("חלק מהפריטים כבר לא באפסון – רענן ונסה שוב");
      await logEvents(
        tx,
        actorName,
        rows.map((r) => ({
          kind: "release" as const,
          personId: r.personId,
          personName: r.personName,
          item: r.itemName,
          serial: r.serial,
          details: v.notes || null,
        })),
      );
      return rows.length;
    });
    revalidateLogistics();
    return { ok: true, data: { count } };
  } catch (e) {
    return { error: actionError(e) };
  }
}
