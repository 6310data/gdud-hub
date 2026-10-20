"use server";
/** החתמה, העברה, זיכוי — ported from signOut() / returnItems() / updateNotes() in Code.gs. */
import { z } from "zod";
import { cleanKit, CONDITION_LABEL, CONDITION_PLACE, kitToString, LOGISTICS_CONDITIONS } from "@gdud/core";
import { and, eq, inArray, isNull, schema, withUser, type Tx } from "@gdud/db";
import { actionError, UserError, type ActionOutcome, type ActionResult } from "@/lib/action-result";
import { battalionName, loadHeldSerialIds, loadPerson } from "@/lib/logistics/data";
import { signOutForm } from "@/lib/logistics/forms";
import { firstIssue, kitList, logEvents, logisticsCtx, NO_PERMISSION, optionalText, revalidateLogistics, uuid, type EventInput } from "./common";

const { people, logisticsItems: items, logisticsSerials: serials } = schema;
const { logisticsAssignments: assignments, logisticsStorage: storage, logisticsForms: forms } = schema;

/** Close open storage rows of these serials (returning or transferring ends אפסון). */
async function closeStorage(tx: Tx, serialIds: string[]) {
  if (!serialIds.length) return [];
  const closed = await tx
    .update(storage)
    .set({ releasedAt: new Date() })
    .where(and(inArray(storage.serialId, serialIds), isNull(storage.releasedAt)))
    .returning({ personId: storage.personId, itemName: storage.itemName, serialId: storage.serialId });
  if (!closed.length) return [];
  const names = await tx
    .select({ id: people.id, name: people.fullName })
    .from(people)
    .where(inArray(people.id, [...new Set(closed.map((c) => c.personId))]));
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return closed.map((c) => ({ ...c, personName: nameOf.get(c.personId) ?? "" }));
}

/** "הוצאה מאפסון" events for storage rows closed automatically (as closeStorageForSerial_ logged). */
function releaseEvents(
  released: Array<{ personId: string; personName: string; itemName: string; serialId: string | null }>,
  bySerial: ReadonlyMap<string, { item: string; serial: string }>,
  reason: string,
): EventInput[] {
  return released.map((r) => ({
    kind: "release",
    personId: r.personId,
    personName: r.personName,
    item: r.itemName,
    serial: r.serialId ? (bySerial.get(r.serialId)?.serial ?? null) : null,
    details: `אוטומטי – ${reason}`,
  }));
}

/* ── sign-out ────────────────────────────────────────────────────────────── */

const signSchema = z.object({
  personId: uuid,
  signer: z.string().trim().min(1, "הזן את שם המחתים").max(80),
  notes: z.string().trim().max(500, "הערות ארוכות מדי").default(""),
  /** take serials that are signed on someone else ("העבר") */
  transfer: z.boolean().default(false),
  lines: z
    .array(z.object({ serialId: uuid, kit: kitList }))
    .min(1, "לא נבחרו פריטים")
    .max(60, "יותר מדי פריטים בטופס אחד")
    .refine((l) => new Set(l.map((x) => x.serialId)).size === l.length, "צ׳ נבחר פעמיים"),
});
export type SignOutInput = z.input<typeof signSchema>;

export async function signOut(input: SignOutInput): Promise<ActionOutcome<{ formId: string; count: number; transferred: number }>> {
  const ctx = await logisticsCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { s, access, actorName } = ctx;

  try {
    const data = await withUser(s.claims, async (tx) => {
      const person = await loadPerson(tx, s.units, v.personId);
      if (!person || !person.active) throw new UserError("החייל לא נמצא");
      if (!access.canAdminUnit(person.unitId)) throw new UserError(NO_PERMISSION.error);

      const ids = v.lines.map((l) => l.serialId);
      const rows = await tx
        .select({ id: serials.id, serial: serials.serial, condition: serials.condition, item: items.name })
        .from(serials)
        .innerJoin(items, eq(items.id, serials.itemId))
        .where(inArray(serials.id, ids));
      // no row lock: company-scoped admins may not lock serials (their UPDATE policy is battalion-only);
      // the unique open-assignment index is what prevents signing one serial out twice.
      const byId = new Map(rows.map((r) => [r.id, r]));
      const held = await loadHeldSerialIds(tx);
      const open = await tx
        .select({ id: assignments.id, serialId: assignments.serialId, personId: assignments.personId, holder: people.fullName })
        .from(assignments)
        .innerJoin(people, eq(people.id, assignments.personId))
        .where(and(inArray(assignments.serialId, ids), isNull(assignments.returnedAt)));
      const openBySerial = new Map(open.map((o) => [o.serialId, o]));

      const errors: string[] = [];
      const transfers: typeof open = [];
      for (const l of v.lines) {
        const r = byId.get(l.serialId);
        if (!r) {
          errors.push("אחד הצ׳ים לא נמצא – רענן ונסה שוב");
          continue;
        }
        const cur = openBySerial.get(l.serialId);
        if (cur?.personId === person.id) errors.push(`צ׳ ${r.serial} כבר מוחתם על ${person.name}`);
        else if (cur && v.transfer) transfers.push(cur);
        else if (cur) errors.push(`צ׳ ${r.serial} מוחתם על ${cur.holder} (אפשר לבחור "העבר")`);
        else if (held.has(l.serialId)) errors.push(`צ׳ ${r.serial} מוחתם על חייל מחוץ למסגרת שלך`);
        else if (r.condition !== "ok") errors.push(`צ׳ ${r.serial} במצב "${CONDITION_LABEL[r.condition]}" – לא ניתן להחתמה`);
      }
      if (errors.length) throw new UserError(errors.join("\n"));

      const events: EventInput[] = [];
      if (transfers.length) {
        const closed = await tx
          .update(assignments)
          .set({ returnedAt: new Date(), returnNotes: `הועבר אל ${person.name}` })
          .where(and(inArray(assignments.id, transfers.map((t) => t.id)), isNull(assignments.returnedAt)))
          .returning({ id: assignments.id });
        if (closed.length !== transfers.length) throw new UserError("אין לך הרשאה להעביר ציוד מהחייל הזה");
        const released = await closeStorage(tx, transfers.map((t) => t.serialId));
        events.push(...releaseEvents(released, byId, "העברה"));
        for (const t of transfers) {
          const r = byId.get(t.serialId)!;
          events.push({ kind: "transfer", personId: t.personId, personName: t.holder, item: r.item, serial: r.serial, details: `הועבר אל ${person.name}` });
        }
      }

      const lines = v.lines.map((l) => ({ ...l, kit: cleanKit(l.kit), row: byId.get(l.serialId)! }));
      const formData = signOutForm({
        battalion: battalionName(s.units),
        person,
        issuedBy: actorName,
        signer: v.signer,
        notes: v.notes,
        lines: lines.map((l) => ({ item: l.row.item, serial: l.row.serial, kit: l.kit })),
      });
      const [form] = await tx.insert(forms).values({ kind: "signout", personId: person.id, data: formData }).returning({ id: forms.id });
      const formId = form!.id;

      await tx.insert(assignments).values(
        lines.map((l) => ({
          serialId: l.serialId,
          personId: person.id,
          kit: l.kit,
          notes: v.notes || null,
          signerName: v.signer,
          formId,
        })),
      );
      for (const l of lines) {
        events.push({
          kind: "sign",
          personId: person.id,
          personName: person.name,
          item: l.row.item,
          serial: l.row.serial,
          details: [`מחתים: ${v.signer}`, kitToString(l.kit), v.notes].filter(Boolean).join(" | "),
          formId,
        });
      }
      await logEvents(tx, actorName, events);
      return { formId, count: lines.length, transferred: transfers.length };
    });
    revalidateLogistics();
    return { ok: true, data };
  } catch (e) {
    return { error: actionError(e) };
  }
}

/* ── return (זיכוי) ──────────────────────────────────────────────────────── */

const returnSchema = z.object({
  assignmentIds: z.array(uuid).min(1, "לא נבחרו פריטים").max(100),
  destination: z.enum(LOGISTICS_CONDITIONS, "יעד זיכוי לא חוקי"),
  notes: z.string().trim().max(500).default(""),
});
export type ReturnInput = z.input<typeof returnSchema>;

export async function returnItems(input: ReturnInput): Promise<ActionOutcome<{ count: number; personId: string | null }>> {
  const ctx = await logisticsCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { s, access, actorName } = ctx;

  try {
    const data = await withUser(s.claims, async (tx) => {
      const rows = await tx
        .select({
          id: assignments.id,
          serialId: assignments.serialId,
          personId: assignments.personId,
          personName: people.fullName,
          unitId: people.unitId,
          serial: serials.serial,
          item: items.name,
        })
        .from(assignments)
        .innerJoin(people, eq(people.id, assignments.personId))
        .innerJoin(serials, eq(serials.id, assignments.serialId))
        .innerJoin(items, eq(items.id, serials.itemId))
        .where(and(inArray(assignments.id, v.assignmentIds), isNull(assignments.returnedAt)));
      if (rows.length !== new Set(v.assignmentIds).size) throw new UserError("חלק מהפריטים כבר זוכו – רענן ונסה שוב");
      if (rows.some((r) => !access.canAdminUnit(r.unitId))) throw new UserError(NO_PERMISSION.error);

      // "still open" is re-checked by the update itself; a concurrent return makes the count short → rollback
      const closed = await tx
        .update(assignments)
        .set({ returnedAt: new Date(), returnedTo: v.destination, returnNotes: v.notes || null })
        .where(and(inArray(assignments.id, rows.map((r) => r.id)), isNull(assignments.returnedAt)))
        .returning({ id: assignments.id });
      if (closed.length !== rows.length) throw new UserError("חלק מהפריטים כבר זוכו – רענן ונסה שוב");
      // the serial's new condition is set by the app.logistics_assignments_guard trigger
      const released = await closeStorage(tx, rows.map((r) => r.serialId));
      const bySerial = new Map(rows.map((r) => [r.serialId, { item: r.item, serial: r.serial }]));
      await logEvents(tx, actorName, [
        ...releaseEvents(released, bySerial, "זיכוי"),
        ...rows.map((r) => ({
          kind: "return" as const,
          personId: r.personId,
          personName: r.personName,
          item: r.item,
          serial: r.serial,
          details: [CONDITION_PLACE[v.destination], v.notes].filter(Boolean).join(" | "),
        })),
      ]);
      const personIds = [...new Set(rows.map((r) => r.personId))];
      return { count: rows.length, personId: personIds.length === 1 ? personIds[0]! : null };
    });
    revalidateLogistics();
    return { ok: true, data };
  } catch (e) {
    return { error: actionError(e) };
  }
}

/* ── notes / kit of a signed serial ──────────────────────────────────────── */

const holdingSchema = z.object({
  assignmentId: uuid,
  notes: optionalText(500),
  kit: z.string().trim().max(500).default(""),
});

/** FormData action: notes + kit typed as "3 תופים, רצועה" (parsed back into lines). */
export async function updateHolding(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await logisticsCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = holdingSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const kit = cleanKit(
    v.kit
      .split(/[,،\n]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const m = /^(\d{1,2})\s+(.+)$/.exec(part);
        return m ? { qty: Number(m[1]), name: m[2]! } : { qty: 1, name: part };
      }),
  );
  const { s, access, actorName } = ctx;
  try {
    await withUser(s.claims, async (tx) => {
      const [row] = await tx
        .select({ personId: assignments.personId, personName: people.fullName, unitId: people.unitId, serial: serials.serial, item: items.name })
        .from(assignments)
        .innerJoin(people, eq(people.id, assignments.personId))
        .innerJoin(serials, eq(serials.id, assignments.serialId))
        .innerJoin(items, eq(items.id, serials.itemId))
        .where(and(eq(assignments.id, v.assignmentId), isNull(assignments.returnedAt)));
      if (!row) throw new UserError("הצ׳ כבר לא מוחתם – רענן");
      if (!access.canAdminUnit(row.unitId)) throw new UserError(NO_PERMISSION.error);
      await tx.update(assignments).set({ notes: v.notes, kit }).where(eq(assignments.id, v.assignmentId));
      await logEvents(tx, actorName, [
        { kind: "notes", personId: row.personId, personName: row.personName, item: row.item, serial: row.serial, details: [v.notes, kitToString(kit)].filter(Boolean).join(" | ") },
      ]);
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidateLogistics();
  return { ok: true };
}
