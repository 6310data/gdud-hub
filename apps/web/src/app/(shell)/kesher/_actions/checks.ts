"use server";
/**
 * דוח צ׳: a company's visual check, filed by anyone covering the company (kesher_checks_insert). The
 * reporter is the signed-in user (kesher_checks_fill). The lines are built from the company's צ׳ at
 * commit time: a צ׳ that left the company meanwhile isn't in the report, one that arrived meanwhile
 * counts as not found and the result says so. One `check` event with the counts.
 */
import { z } from "zod";
import { and, eq, schema, withUser } from "@gdud/db";
import { actionError, type ActionOutcome } from "@/lib/action-result";
import { firstIssue, kesherCtx, NO_PERMISSION, optionalText, revalidateKesher, uuid } from "./common";

const { kesherSerials: serials, kesherItems: items, kesherChecks: checks, kesherCheckLines: lines, kesherEvents: events } = schema;

const checkSchema = z.object({
  unitId: uuid,
  note: optionalText(1000),
  /** the צ׳ ticked as seen */
  foundIds: z.array(uuid).max(2000),
  /** every צ׳ the screen listed — anything else on the company now arrived meanwhile */
  shownIds: z.array(uuid).max(2000),
});

export interface CheckFiled {
  total: number;
  found: number;
  /** צ׳ on the company that the screen didn't list (counted as not found) */
  added: number;
}

export async function fileCheck(input: z.input<typeof checkSchema>): Promise<ActionOutcome<CheckFiled>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = checkSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { unitId, note, foundIds, shownIds } = parsed.data;
  const { s, access } = ctx;
  const company = access.companies.find((c) => c.id === unitId);
  if (!company) return NO_PERMISSION;
  const found = new Set(foundIds);
  const shown = new Set(shownIds);

  try {
    const data = await withUser(s.claims, async (tx) => {
      const now = await tx
        .select({ id: serials.id, serial: serials.serial, item: items.name })
        .from(serials)
        .innerJoin(items, eq(items.id, serials.itemId))
        .where(and(eq(serials.location, "company"), eq(serials.unitId, unitId)));
      if (!now.length) return { total: 0, found: 0, added: 0 };
      const seen = now.filter((x) => found.has(x.id)).length;
      const [check] = await tx.insert(checks).values({ unitId, total: now.length, found: seen, note }).returning({ id: checks.id });
      await tx.insert(lines).values(now.map((x) => ({ checkId: check!.id, serialId: x.id, serial: x.serial, item: x.item, found: found.has(x.id) })));
      const missing = now.filter((x) => !found.has(x.id));
      await tx.insert(events).values({
        kind: "check",
        unitId,
        company: company.name,
        qty: now.length - seen,
        details: [`${seen}/${now.length} נראו בעין`, missing.length ? `לא נמצאו: ${missing.map((x) => x.serial).join(", ")}` : null, note]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 2000),
      });
      return { total: now.length, found: seen, added: now.filter((x) => !shown.has(x.id)).length };
    });
    if (!data.total) return { error: "אין צ׳ על הפלוגה — אין מה לדווח." };
    revalidateKesher();
    return { ok: true, data };
  } catch (e) {
    return { error: actionError(e) };
  }
}
