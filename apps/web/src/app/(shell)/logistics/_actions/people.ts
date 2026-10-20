"use server";
/** אלפון: add / edit / remove soldiers, and the holdings form (טופס ציוד חתום). */
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeSerial } from "@gdud/core";
import { and, eq, isNull, ne, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionOutcome, type ActionResult } from "@/lib/action-result";
import { battalionName, loadHoldings, loadPerson } from "@/lib/logistics/data";
import { holdingsForm } from "@/lib/logistics/forms";
import { firstIssue, logEvents, logisticsCtx, NO_PERMISSION, optionalText, revalidateLogistics, uuid } from "./common";

const { people, logisticsAssignments: assignments, logisticsStorage: storage, logisticsForms: forms } = schema;

const personSchema = z.object({
  id: z.union([uuid, z.literal("")]).transform((s) => s || null),
  fullName: z
    .string()
    .trim()
    .min(2, "חסר שם מלא")
    .max(80)
    .transform((s) => s.replace(/\s+/g, " ")),
  personalNumber: z
    .string()
    .trim()
    .max(20)
    .transform((s) => normalizeSerial(s) || null)
    .refine((s) => s === null || /^[0-9A-Za-z]{1,12}$/.test(s), "מספר אישי: עד 12 ספרות/אותיות"),
  phone: z
    .string()
    .trim()
    .max(20)
    .transform((s) => s.replace(/[^\d+]/g, "") || null)
    .refine((s) => s === null || /^\+?\d{9,13}$/.test(s), "מספר טלפון לא תקין"),
  unitId: uuid,
  roleTitle: optionalText(60),
});

export async function savePerson(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await logisticsCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = personSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { id, ...v } = parsed.data;
  const { s, access, actorName } = ctx;
  const unit = s.units.find((u) => u.id === v.unitId);
  if (!unit || unit.kind === "battalion" || !unit.active) return { error: "בחרו פלוגה או מחלקה" };
  if (!access.canEditPeople(v.unitId)) return NO_PERMISSION;

  let savedId: string;
  try {
    savedId = await withUser(s.claims, async (tx) => {
      const old = id ? await loadPerson(tx, s.units, id) : null;
      if (id && !old) throw new UserError("החייל לא נמצא – רענן ונסה שוב");
      if (old && !access.canEditPeople(old.unitId)) throw new UserError(NO_PERMISSION.error);
      const [sameName] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.fullName, v.fullName), eq(people.active, true), id ? ne(people.id, id) : undefined));
      if (sameName) throw new UserError(`כבר קיים חייל בשם "${v.fullName}"`);
      if (v.personalNumber) {
        const [samePn] = await tx
          .select({ name: people.fullName })
          .from(people)
          .where(and(eq(people.personalNumber, v.personalNumber), id ? ne(people.id, id) : undefined));
        if (samePn) throw new UserError(`מספר אישי ${v.personalNumber} כבר שייך ל${samePn.name}`);
      }

      let rowId: string;
      if (old) {
        const r = await tx.update(people).set(v).where(eq(people.id, old.id)).returning({ id: people.id });
        if (!r.length) throw new UserError(NO_PERMISSION.error);
        rowId = old.id;
      } else {
        const [r] = await tx.insert(people).values(v).returning({ id: people.id });
        rowId = r!.id;
      }
      // no phone / personal number: the log is append-only and widely readable
      const details = [unit.name, old && old.name !== v.fullName ? `שם קודם: ${old.name}` : null].filter(Boolean).join(" · ");
      await logEvents(tx, actorName, [
        { kind: old ? "person_update" : "person_add", personId: rowId, personName: v.fullName, details },
      ]);
      return rowId;
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidateLogistics();
  redirect(`/logistics/people?person=${savedId}`);
}

/** Remove from the active roster (kept for history). Only when nothing is signed or stored. */
export async function deactivatePerson(personId: string): Promise<ActionResult> {
  const ctx = await logisticsCtx();
  if (!ctx) return NO_PERMISSION;
  if (!uuid.safeParse(personId).success) return { error: "קלט לא תקין" };
  const { s, access, actorName } = ctx;
  try {
    await withUser(s.claims, async (tx) => {
      const p = await loadPerson(tx, s.units, personId);
      if (!p) throw new UserError("החייל לא נמצא");
      if (!access.canEditPeople(p.unitId)) throw new UserError(NO_PERMISSION.error);
      const held = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(and(eq(assignments.personId, personId), isNull(assignments.returnedAt)));
      if (held.length) throw new UserError(`על ${p.name} מוחתמים ${held.length} פריטים – יש לזכות קודם`);
      const stored = await tx
        .select({ id: storage.id })
        .from(storage)
        .where(and(eq(storage.personId, personId), isNull(storage.releasedAt)));
      if (stored.length) throw new UserError(`ל${p.name} יש ${stored.length} פריטים באפסון – יש להוציא קודם`);
      const r = await tx.update(people).set({ active: false }).where(eq(people.id, personId)).returning({ id: people.id });
      if (!r.length) throw new UserError(NO_PERMISSION.error);
      await logEvents(tx, actorName, [{ kind: "person_remove", personId, personName: p.name }]);
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidateLogistics();
  redirect("/logistics/people");
}

const holdingsSchema = z.object({ personId: uuid, signer: z.string().trim().max(80).default("") });

/** Save the current holdings of a soldier as a form (viewers can still print the preview). */
export async function issueHoldingsForm(input: z.input<typeof holdingsSchema>): Promise<ActionOutcome<{ formId: string }>> {
  const ctx = await logisticsCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = holdingsSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { s, access, actorName } = ctx;
  try {
    const formId = await withUser(s.claims, async (tx) => {
      const person = await loadPerson(tx, s.units, parsed.data.personId);
      if (!person) throw new UserError("החייל לא נמצא");
      if (!access.canAdminUnit(person.unitId)) throw new UserError(NO_PERMISSION.error);
      const holdings = await loadHoldings(tx, { personId: person.id });
      if (!holdings.length) throw new UserError(`אין ציוד מוחתם על ${person.name}`);
      const data = holdingsForm({
        battalion: battalionName(s.units),
        person,
        issuedBy: actorName,
        signer: parsed.data.signer,
        lines: holdings.map((h) => ({ item: h.itemName, serial: h.serial, kit: h.kit, notes: h.notes, signedAt: h.signedAt })),
      });
      const [f] = await tx.insert(forms).values({ kind: "holdings", personId: person.id, data }).returning({ id: forms.id });
      await logEvents(tx, actorName, [
        {
          kind: "holdings_form",
          personId: person.id,
          personName: person.name,
          details: `${holdings.length} פריטים${parsed.data.signer ? ` | מאשר: ${parsed.data.signer}` : ""}`,
          formId: f!.id,
        },
      ]);
      return f!.id;
    });
    revalidateLogistics();
    return { ok: true, data: { formId } };
  } catch (e) {
    return { error: actionError(e) };
  }
}
