"use server";
/**
 * שיוך בתוך הפלוגה and חותם על הפלוגה (company page). Anyone covering the company sets who holds a
 * צ׳ inside it (soldier · תפקיד · מסגרת); only a battalion kesher admin changes who signed for it
 * (the kesher_holders_guard trigger enforces both). The צ׳ never changes company here.
 */
import { z } from "zod";
import { placement } from "@gdud/core";
import { eq, inArray, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { unitsById } from "@/lib/logistics/data";
import { firstIssue, kesherCtx, NO_PERMISSION, revalidateKesher, uuid } from "./common";

const { people, kesherHolders: holders, kesherSerials: serials, kesherItems: items, kesherEvents: events } = schema;

const TEXT_MAX = 40;
/** undefined = leave as is; "" or null = clear */
const patchText = z
  .string()
  .trim()
  .max(TEXT_MAX, `תפקיד / מסגרת עד ${TEXT_MAX} תווים`)
  .nullish()
  .transform((s) => (s === undefined ? undefined : s || null));

const rowSchema = z.object({
  serialId: uuid,
  holderPersonId: uuid.nullish(),
  holderRole: patchText,
  frame: patchText,
  signerPersonId: uuid.nullish(),
  signerRole: patchText,
});
const saveSchema = z.object({
  unitId: uuid,
  rows: z.array(rowSchema).min(1, "לא נבחרו צ׳").max(500, "יותר מדי צ׳ בבת אחת"),
});
export type HolderPatch = z.input<typeof rowSchema>;

const show = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || "ללא";

export async function saveHolders(input: z.input<typeof saveSchema>): Promise<ActionOutcome<{ changed: number }>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { unitId, rows } = parsed.data;
  const { s, access } = ctx;
  if (!access.covers(unitId)) return NO_PERMISSION;
  const signing = rows.some((r) => r.signerPersonId !== undefined || r.signerRole !== undefined);
  if (signing && !access.isAdmin) return { error: "רק מנהל קשר גדודי משנה את החותם על הפלוגה." };
  const company = s.units.find((u) => u.id === unitId);

  try {
    const changed = await withUser(s.claims, async (tx) => {
      const ids = [...new Set(rows.map((r) => r.serialId))];
      const current = new Map(
        (
          await tx
            .select({
              serialId: holders.serialId,
              unitId: holders.unitId,
              signerPersonId: holders.signerPersonId,
              signerRole: holders.signerRole,
              holderPersonId: holders.holderPersonId,
              holderRole: holders.holderRole,
              frame: holders.frame,
              serial: serials.serial,
              item: items.name,
            })
            .from(holders)
            .innerJoin(serials, eq(serials.id, holders.serialId))
            .innerJoin(items, eq(items.id, serials.itemId))
            .where(inArray(holders.serialId, ids))
        ).map((h) => [h.serialId, h]),
      );

      // every soldier named: active and in this company (the trigger checks again)
      const personIds = [...new Set(rows.flatMap((r) => [r.holderPersonId, r.signerPersonId]).filter((id): id is string => Boolean(id)))];
      const byUnit = unitsById(s.units);
      const found = personIds.length
        ? await tx.select({ id: people.id, fullName: people.fullName, unitId: people.unitId, active: people.active }).from(people).where(inArray(people.id, personIds))
        : [];
      const person = new Map(found.map((p) => [p.id, p]));
      const errors: string[] = [];
      for (const id of personIds) {
        const p = person.get(id);
        if (!p) errors.push("אחד החיילים לא נמצא ברשימת דוח 1");
        else if (!p.active) errors.push(`${p.fullName} הוסר מרשימת דוח 1`);
        else if (placement(p.unitId, byUnit).company?.id !== unitId) errors.push(`${p.fullName} לא בפלוגה ${company?.name ?? ""}`.trim());
      }
      for (const r of rows) {
        const h = current.get(r.serialId);
        if (!h || h.unitId !== unitId) errors.push(h ? `הצ׳ ${h.serial} כבר לא על הפלוגה — רעננו את הדף` : "אחד הצ׳ כבר לא על הפלוגה — רעננו את הדף");
      }
      if (errors.length) throw new UserError([...new Set(errors)].join("\n"));

      const name = (id: string | null) => (id ? (person.get(id)?.fullName ?? null) : null);
      const knownName = async (id: string | null) => {
        if (!id || person.has(id)) return name(id);
        const [p] = await tx.select({ id: people.id, fullName: people.fullName, unitId: people.unitId, active: people.active }).from(people).where(eq(people.id, id));
        if (p) person.set(p.id, p);
        return p?.fullName ?? "—";
      };

      let n = 0;
      for (const r of rows) {
        const h = current.get(r.serialId)!;
        const next = {
          holderPersonId: r.holderPersonId === undefined ? h.holderPersonId : r.holderPersonId,
          holderRole: r.holderRole === undefined ? h.holderRole : r.holderRole,
          frame: r.frame === undefined ? h.frame : r.frame,
          signerPersonId: r.signerPersonId === undefined ? h.signerPersonId : r.signerPersonId,
          signerRole: r.signerRole === undefined ? h.signerRole : r.signerRole,
        };
        const holderChanged = next.holderPersonId !== h.holderPersonId || next.holderRole !== h.holderRole || next.frame !== h.frame;
        const signerChanged = next.signerPersonId !== h.signerPersonId || next.signerRole !== h.signerRole;
        if (!holderChanged && !signerChanged) continue;
        // only the columns that change: a user's update must not touch the signer columns
        await tx
          .update(holders)
          .set({
            ...(holderChanged ? { holderPersonId: next.holderPersonId, holderRole: next.holderRole, frame: next.frame } : {}),
            ...(signerChanged ? { signerPersonId: next.signerPersonId, signerRole: next.signerRole } : {}),
          })
          .where(eq(holders.serialId, h.serialId));
        const base = { unitId, company: company?.name ?? null, item: h.item, serial: h.serial } as const;
        if (holderChanged) {
          await tx.insert(events).values({
            ...base,
            kind: "assign",
            personId: next.holderPersonId,
            personName: name(next.holderPersonId),
            personRole: next.holderRole,
            details: `שיוך בפלוגה: ${show(await knownName(h.holderPersonId), h.holderRole, h.frame)} ← ${show(name(next.holderPersonId), next.holderRole, next.frame)}`,
          });
        }
        if (signerChanged) {
          await tx.insert(events).values({
            ...base,
            kind: "assign",
            personId: next.signerPersonId,
            personName: name(next.signerPersonId),
            personRole: next.signerRole,
            details: `חותם על הפלוגה: ${show(await knownName(h.signerPersonId), h.signerRole)} ← ${show(name(next.signerPersonId), next.signerRole)}`,
          });
        }
        n++;
      }
      return n;
    });
    revalidateKesher();
    return { ok: true, data: { changed } };
  } catch (e) {
    return { error: actionError(e) };
  }
}
