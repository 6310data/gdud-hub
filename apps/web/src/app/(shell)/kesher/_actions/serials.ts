"use server";
/**
 * Editing a צ׳ — the same fields on צ׳ במערכת and on the company page. Anyone covering the company
 * sets who holds a צ׳ inside it (soldier · תפקיד · מסגרת); only a battalion kesher admin changes its
 * place (מחסן / פלוגה / ללא שיוך), who signed for it (חותם על הפלוגה), its vehicle (from דוח 1's list)
 * and its note.
 * RLS and the triggers of 0018_kesher_security.sql enforce the same: kesher_serials updates and
 * kesher_holders inserts are admin-only, the signer columns too (kesher_holders_guard), and moving a
 * צ׳ to another place drops its holder row (kesher_serials_moved).
 */
import { z } from "zod";
import { placement, type KesherLocation } from "@gdud/core";
import { eq, inArray, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { loadVehicles } from "@/lib/kesher/data";
import { unitsById } from "@/lib/logistics/data";
import { firstIssue, kesherCtx, NO_PERMISSION, revalidateKesher, uuid } from "./common";

const { people, kesherHolders: holders, kesherSerials: serials, kesherItems: items, kesherEvents: events } = schema;

const TEXT_MAX = 40;
const NOTES_MAX = 500;
/** undefined = leave as is; "" or null = clear */
const patchText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((s) => (s === undefined ? undefined : s || null));

const rowSchema = z.object({
  serialId: uuid,
  /** the company the screen showed the צ׳ on (null = not on a company): a stale screen is refused */
  seenUnitId: uuid.nullable(),
  place: z
    .object({ location: z.enum(["warehouse", "company", "none"]), unitId: uuid.nullable() })
    .refine((p) => (p.location === "company") === Boolean(p.unitId), "בחרו פלוגה")
    .optional(),
  holderPersonId: uuid.nullish(),
  holderRole: patchText(TEXT_MAX, `תפקיד / מסגרת עד ${TEXT_MAX} תווים`),
  frame: patchText(TEXT_MAX, `תפקיד / מסגרת עד ${TEXT_MAX} תווים`),
  signerPersonId: uuid.nullish(),
  signerRole: patchText(TEXT_MAX, `תפקיד החותם עד ${TEXT_MAX} תווים`),
  vehicle: patchText(TEXT_MAX, `מספר רכב עד ${TEXT_MAX} תווים`).transform((s) => (s ? s.replace(/\s+/g, " ") : s)),
  notes: patchText(NOTES_MAX, `הערה עד ${NOTES_MAX} תווים`),
});
const saveSchema = z.object({
  rows: z.array(rowSchema).min(1, "לא נבחרו צ׳").max(500, "יותר מדי צ׳ בבת אחת"),
});
export type SerialPatch = z.input<typeof rowSchema>;

const show = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || "ללא";

export async function saveSerials(input: z.input<typeof saveSchema>): Promise<ActionOutcome<{ changed: number }>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { rows } = parsed.data;
  const { s, access } = ctx;
  const adminOnly = rows.some(
    (r) => r.place !== undefined || r.signerPersonId !== undefined || r.signerRole !== undefined || r.vehicle !== undefined || r.notes !== undefined,
  );
  if (adminOnly && !access.isAdmin) return { error: "רק מנהל קשר גדודי משנה מיקום, חותם על הפלוגה, רכב או הערה." };
  const byUnit = unitsById(s.units);
  const unitName = (id: string | null) => (id ? (byUnit.get(id)?.name ?? null) : null);
  const placeName = (location: KesherLocation, unitId: string | null) => (location === "warehouse" ? "מחסן" : location === "company" ? (unitName(unitId) ?? "פלוגה") : "ללא שיוך");

  try {
    const changed = await withUser(s.claims, async (tx) => {
      const ids = [...new Set(rows.map((r) => r.serialId))];
      const found = await tx
        .select({
          id: serials.id,
          serial: serials.serial,
          location: serials.location,
          unitId: serials.unitId,
          vehicle: serials.vehicle,
          notes: serials.notes,
          item: items.name,
        })
        .from(serials)
        .innerJoin(items, eq(items.id, serials.itemId))
        .where(inArray(serials.id, ids));
      const current = new Map(found.map((x) => [x.id, x]));
      const holderRows = await tx.select().from(holders).where(inArray(holders.serialId, ids));
      const holderOf = new Map(holderRows.map((h) => [h.serialId, h]));

      const errors: string[] = [];
      for (const r of rows) {
        const x = current.get(r.serialId);
        if (!x) errors.push("אחד הצ׳ לא נמצא — רעננו את הדף");
        else if (x.unitId !== r.seenUnitId) errors.push(`הצ׳ ${x.serial} עבר מקום בינתיים — רעננו את הדף`);
        else {
          const unitId = r.place ? r.place.unitId : x.unitId;
          if (unitId && !access.covers(unitId)) errors.push(NO_PERMISSION.error);
          const holding = [r.holderPersonId, r.holderRole, r.frame, r.signerPersonId, r.signerRole].some((v) => v !== undefined && v !== null);
          if (holding && !unitId) errors.push(`הצ׳ ${x.serial} לא על פלוגה — אין לו חותם`);
        }
      }

      // every soldier named: active and in the צ׳'s company (the trigger checks again)
      const personIds = [...new Set(rows.flatMap((r) => [r.holderPersonId, r.signerPersonId]).filter((id): id is string => Boolean(id)))];
      const person = new Map(
        (personIds.length
          ? await tx.select({ id: people.id, fullName: people.fullName, unitId: people.unitId, active: people.active }).from(people).where(inArray(people.id, personIds))
          : []
        ).map((p) => [p.id, p]),
      );
      for (const r of rows) {
        const x = current.get(r.serialId);
        const unitId = r.place ? r.place.unitId : x?.unitId;
        for (const id of [r.holderPersonId, r.signerPersonId]) {
          if (!id) continue;
          const p = person.get(id);
          if (!p) errors.push("אחד החיילים לא נמצא ברשימת דוח 1");
          else if (!p.active) errors.push(`${p.fullName} הוסר מרשימת דוח 1`);
          else if (placement(p.unitId, byUnit).company?.id !== unitId) errors.push(`${p.fullName} לא בפלוגה ${unitName(unitId ?? null) ?? ""}`.trim());
        }
      }
      // a vehicle comes from דוח 1's list
      const numbers = rows.some((r) => r.vehicle) ? new Set((await loadVehicles(tx)).map((v) => v.number)) : null;
      for (const r of rows) if (r.vehicle && !numbers!.has(r.vehicle)) errors.push(`הרכב ${r.vehicle} לא ברשימת הרכבים של דוח 1`);
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
        const x = current.get(r.serialId)!;
        const details: string[] = [];

        /* the צ׳ itself: place, vehicle, note */
        const place = r.place && (r.place.location !== x.location || r.place.unitId !== x.unitId) ? r.place : undefined;
        const vehicle = r.vehicle !== undefined && r.vehicle !== x.vehicle ? r.vehicle : undefined;
        const notes = r.notes !== undefined && r.notes !== x.notes ? r.notes : undefined;
        if (place || vehicle !== undefined || notes !== undefined) {
          await tx
            .update(serials)
            .set({
              ...(place ? { location: place.location, unitId: place.unitId } : {}),
              ...(vehicle !== undefined ? { vehicle } : {}),
              ...(notes !== undefined ? { notes } : {}),
            })
            .where(eq(serials.id, x.id));
          if (place) details.push(`מיקום: ${placeName(x.location, x.unitId)} ← ${placeName(place.location, place.unitId)}`);
          if (vehicle !== undefined) details.push(`רכב: ${x.vehicle ?? "ללא"} ← ${vehicle ?? "ללא"}`);
          if (notes !== undefined) details.push(`הערה: ${notes ?? "נמחקה"}`);
        }
        const unitId = place ? place.unitId : x.unitId;
        const base = { unitId, company: unitName(unitId), item: x.item, serial: x.serial } as const;
        if (details.length) await tx.insert(events).values({ ...base, kind: "serial_edit", details: details.join(" · ") });

        /* holders: a move to another company dropped the old row */
        const h = place ? undefined : holderOf.get(x.id);
        const was = {
          holderPersonId: h?.holderPersonId ?? null,
          holderRole: h?.holderRole ?? null,
          frame: h?.frame ?? null,
          signerPersonId: h?.signerPersonId ?? null,
          signerRole: h?.signerRole ?? null,
        };
        const next = {
          holderPersonId: r.holderPersonId === undefined ? was.holderPersonId : r.holderPersonId,
          holderRole: r.holderRole === undefined ? was.holderRole : r.holderRole,
          frame: r.frame === undefined ? was.frame : r.frame,
          signerPersonId: r.signerPersonId === undefined ? was.signerPersonId : r.signerPersonId,
          signerRole: r.signerRole === undefined ? was.signerRole : r.signerRole,
        };
        const holderChanged = next.holderPersonId !== was.holderPersonId || next.holderRole !== was.holderRole || next.frame !== was.frame;
        const signerChanged = next.signerPersonId !== was.signerPersonId || next.signerRole !== was.signerRole;
        if (unitId && (holderChanged || signerChanged)) {
          if (h) {
            // only the columns that change: a user's update must not touch the signer columns
            await tx
              .update(holders)
              .set({
                ...(holderChanged ? { holderPersonId: next.holderPersonId, holderRole: next.holderRole, frame: next.frame } : {}),
                ...(signerChanged ? { signerPersonId: next.signerPersonId, signerRole: next.signerRole } : {}),
              })
              .where(eq(holders.serialId, x.id));
          } else {
            // a צ׳ on a company without a holder row yet (just moved, or imported without one): admin only (RLS)
            if (!access.isAdmin) throw new UserError(`לצ׳ ${x.serial} עוד אין חותם על הפלוגה — מנהל קשר גדודי צריך לשייך אותו קודם`);
            await tx.insert(holders).values({ serialId: x.id, unitId, ...next });
          }
          if (holderChanged) {
            await tx.insert(events).values({
              ...base,
              kind: "assign",
              personId: next.holderPersonId,
              personName: name(next.holderPersonId),
              personRole: next.holderRole,
              details: `שיוך בפלוגה: ${show(await knownName(was.holderPersonId), was.holderRole, was.frame)} ← ${show(name(next.holderPersonId), next.holderRole, next.frame)}`,
            });
          }
          if (signerChanged) {
            await tx.insert(events).values({
              ...base,
              kind: "assign",
              personId: next.signerPersonId,
              personName: name(next.signerPersonId),
              personRole: next.signerRole,
              details: `חותם על הפלוגה: ${show(await knownName(was.signerPersonId), was.signerRole)} ← ${show(name(next.signerPersonId), next.signerRole)}`,
            });
          }
        }
        if (details.length || (unitId && (holderChanged || signerChanged))) n++;
      }
      return n;
    });
    revalidateKesher();
    return { ok: true, data: { changed } };
  } catch (e) {
    return { error: actionError(e) };
  }
}
