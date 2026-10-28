"use server";
/**
 * Moving equipment, battalion kesher admin only (kesher_serials, kesher_holders, kesher_stock and
 * kesher_items writes are admin-only in 0018_kesher_security.sql):
 *
 *   החתמה        warehouse → a company, signed by a soldier of it (צ׳ תקינים, ציוד משלים תקין)
 *   זיכוי         a company → warehouse; each צ׳ and each ציוד משלים line comes back תקין or תקול
 *   קבלה מחטיבה   new צ׳ into the warehouse, מלאי כללי up
 *   זיכוי לחטיבה  צ׳ out of the warehouse (kept as "הוחזר לחטיבה"), מלאי כללי down
 *   תיקון         תקול → תקין
 *
 * Each runs in one withUser transaction: serials, holders, quantities and the יומן together or not
 * at all. A צ׳ is claimed with a guarded UPDATE (… where location = 'warehouse'), so one that someone
 * else just moved is refused by name; ציוד משלים items are locked (lockBulk) before they are counted.
 */
import { z } from "zod";
import { normalizeSerial, placement } from "@gdud/core";
import { and, eq, inArray, schema, withUser, type Tx } from "@gdud/db";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { unitsById } from "@/lib/logistics/data";
import { firstIssue, kesherCtx, NO_PERMISSION, optionalText, revalidateKesher, uuid, type KesherCtx } from "./common";
import { addCompanyStock, companyQty, lockBulk, moveAt, moveDay, personName, qtyText } from "./moves-common";

const { people, kesherItems: items, kesherSerials: serials, kesherHolders: holders, kesherEvents: events } = schema;

const ADMIN_ONLY = { error: "רק מנהל קשר גדודי מחתים, מזכה ומעדכן מלאי." } as const;
const count = (max: number) => z.number({ error: "כמות לא תקינה" }).int("כמות שלמה בלבד").min(0, "כמות לא יכולה להיות שלילית").max(max, "כמות גדולה מדי");
const ids = z.array(uuid).max(300, "יותר מדי צ׳ בבת אחת");

type Event = typeof events.$inferInsert;

/** The admin's session, or the error to return. */
async function adminCtx(): Promise<KesherCtx | { error: string }> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  if (!ctx.access.isAdmin) return ADMIN_ONLY;
  return ctx;
}

/** The serials of `serialIds` with their device type, in the order asked. */
async function loadSerials(tx: Tx, serialIds: readonly string[]) {
  if (!serialIds.length) return [];
  const rows = await tx
    .select({ id: serials.id, serial: serials.serial, location: serials.location, unitId: serials.unitId, condition: serials.condition, item: items.name })
    .from(serials)
    .innerJoin(items, eq(items.id, serials.itemId))
    .where(inArray(serials.id, [...serialIds]));
  if (rows.length !== new Set(serialIds).size) throw new UserError("אחד הצ׳ לא נמצא — רעננו את הדף");
  return rows;
}

function companyOf(ctx: KesherCtx, unitId: string): string {
  const u = ctx.s.units.find((x) => x.id === unitId && x.kind === "company");
  if (!u) throw new UserError("פלוגה לא מוכרת — רעננו את הדף");
  return u.name;
}

function done<T>(data: T): ActionOutcome<T> {
  revalidateKesher();
  return { ok: true, data };
}

/* ── החתמה ─────────────────────────────────────────────────────────────── */

const signSchema = z
  .object({
    unitId: uuid,
    signerPersonId: z.uuid("בחרו את החייל החותם"),
    signerRole: optionalText(40),
    day: moveDay,
    notes: optionalText(300),
    serialIds: ids,
    lines: z.array(z.object({ itemId: uuid, qty: count(9999) })).max(200).default([]),
  })
  .refine((v) => v.serialIds.length || v.lines.some((l) => l.qty > 0), "לא נבחר ציוד");
export type SignInput = z.input<typeof signSchema>;

/** החתמה: warehouse → company, signed by a soldier of that company. */
export async function signToCompany(input: SignInput): Promise<ActionOutcome<{ serials: number; lines: number }>> {
  const ctx = await adminCtx();
  if ("error" in ctx) return ctx;
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  try {
    const company = companyOf(ctx, v.unitId);
    const { at, backdated } = moveAt(v.day);
    const result = await withUser(ctx.s.claims, async (tx) => {
      const [p] = await tx.select({ id: people.id, name: people.fullName, unitId: people.unitId, active: people.active }).from(people).where(eq(people.id, v.signerPersonId));
      if (!p || !p.active) throw new UserError("החייל החותם לא ברשימת דוח 1 (או הוסר ממנה)");
      if (placement(p.unitId, unitsById(ctx.s.units)).company?.id !== v.unitId) throw new UserError(`${p.name} לא בפלוגה ${company}`);

      const base = { unitId: v.unitId, company, personId: p.id, personName: p.name, personRole: v.signerRole, at, backdated, details: v.notes } as const;
      const log: Event[] = [];

      /* צ׳: only תקינים from the warehouse */
      const list = await loadSerials(tx, v.serialIds);
      const bad = list.filter((x) => x.location !== "warehouse" || x.condition !== "ok");
      if (bad.length) throw new UserError(bad.map((x) => `הצ׳ ${x.serial} (${x.item}) ${x.location !== "warehouse" ? "כבר לא במחסן" : "תקול"}`).join("\n"));
      if (list.length) {
        const moved = await tx
          .update(serials)
          .set({ location: "company", unitId: v.unitId })
          .where(and(inArray(serials.id, v.serialIds), eq(serials.location, "warehouse"), eq(serials.condition, "ok")))
          .returning({ id: serials.id });
        if (moved.length !== list.length) throw new UserError("אחד הצ׳ הוחתם בינתיים — רעננו את הדף");
        await tx.insert(holders).values(list.map((x) => ({ serialId: x.id, unitId: v.unitId, signerPersonId: p.id, signerRole: v.signerRole, signedAt: at })));
        for (const x of list) log.push({ ...base, kind: "sign", item: x.item, serial: x.serial, qty: 1 });
      }

      /* ציוד משלים: out of the warehouse's תקין */
      const lines = v.lines.filter((l) => l.qty > 0);
      const bulk = await lockBulk(tx, lines.map((l) => l.itemId));
      const short = lines.filter((l) => l.qty > bulk.get(l.itemId)!.available);
      if (short.length) throw new UserError(short.map((l) => `${bulk.get(l.itemId)!.name}: חורג מהמלאי — במחסן ${Math.max(0, bulk.get(l.itemId)!.available)} תקינים`).join("\n"));
      for (const l of lines) {
        const it = bulk.get(l.itemId)!;
        await addCompanyStock(tx, it.id, v.unitId, l.qty, it.name);
        log.push({ ...base, kind: "sign", item: it.name, qty: l.qty });
      }

      if (log.length) await tx.insert(events).values(log);
      return { serials: list.length, lines: lines.length };
    });
    return done(result);
  } catch (e) {
    return { error: actionError(e) };
  }
}

/* ── זיכוי ─────────────────────────────────────────────────────────────── */

const creditSchema = z
  .object({
    unitId: uuid,
    /** who brought it back (optional) */
    returnerPersonId: uuid.nullish(),
    day: moveDay,
    notes: optionalText(300),
    serials: z.array(z.object({ id: uuid, broken: z.boolean().default(false) })).max(300, "יותר מדי צ׳ בבת אחת"),
    lines: z.array(z.object({ itemId: uuid, ok: count(9999), broken: count(9999) })).max(200).default([]),
  })
  .refine((v) => v.serials.length || v.lines.some((l) => l.ok + l.broken > 0), "לא נבחר ציוד");
export type CreditInput = z.input<typeof creditSchema>;

/** זיכוי: company → warehouse. Each צ׳ and ציוד משלים line comes back תקין or תקול. */
export async function creditFromCompany(input: CreditInput): Promise<ActionOutcome<{ serials: number; broken: number }>> {
  const ctx = await adminCtx();
  if ("error" in ctx) return ctx;
  const parsed = creditSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  try {
    const company = companyOf(ctx, v.unitId);
    const { at, backdated } = moveAt(v.day);
    const result = await withUser(ctx.s.claims, async (tx) => {
      const returner = await personName(tx, v.returnerPersonId ?? null);
      const base = { unitId: v.unitId, company, personId: v.returnerPersonId ?? null, personName: returner, at, backdated } as const;
      const note = (broken: boolean) => [broken ? "הוחזר תקול" : null, v.notes].filter(Boolean).join(" · ") || null;
      const log: Event[] = [];

      /* צ׳: must be on that company; the holder row goes with the move (kesher_serials_moved) */
      const list = await loadSerials(tx, v.serials.map((x) => x.id));
      const elsewhere = list.filter((x) => x.location !== "company" || x.unitId !== v.unitId);
      if (elsewhere.length) throw new UserError(elsewhere.map((x) => `הצ׳ ${x.serial} (${x.item}) לא על ${company}`).join("\n"));
      const broken = new Set(v.serials.filter((x) => x.broken).map((x) => x.id));
      for (const cond of ["ok", "broken"] as const) {
        const group = list.filter((x) => broken.has(x.id) === (cond === "broken"));
        if (!group.length) continue;
        const moved = await tx
          .update(serials)
          .set({ location: "warehouse", unitId: null, condition: cond })
          .where(and(inArray(serials.id, group.map((x) => x.id)), eq(serials.unitId, v.unitId)))
          .returning({ id: serials.id });
        if (moved.length !== group.length) throw new UserError("אחד הצ׳ זז בינתיים — רעננו את הדף");
        for (const x of group) log.push({ ...base, kind: "credit", item: x.item, serial: x.serial, qty: 1, details: note(cond === "broken") });
      }

      /* ציוד משלים: off the company; the תקול part is counted apart in the warehouse */
      const lines = v.lines.filter((l) => l.ok + l.broken > 0);
      const bulk = await lockBulk(tx, lines.map((l) => l.itemId));
      const have = await companyQty(tx, v.unitId, lines.map((l) => l.itemId));
      const over = lines.filter((l) => l.ok + l.broken > (have.get(l.itemId) ?? 0));
      if (over.length) throw new UserError(over.map((l) => `${bulk.get(l.itemId)!.name}: ל${company} חתומים רק ${have.get(l.itemId) ?? 0}`).join("\n"));
      for (const l of lines) {
        const it = bulk.get(l.itemId)!;
        await addCompanyStock(tx, it.id, v.unitId, -(l.ok + l.broken), it.name);
        if (l.broken) await tx.update(items).set({ brokenQty: it.brokenQty + l.broken }).where(eq(items.id, it.id));
        if (l.ok) log.push({ ...base, kind: "credit", item: it.name, qty: l.ok, details: note(false) });
        if (l.broken) log.push({ ...base, kind: "credit", item: it.name, qty: l.broken, details: note(true) });
      }

      if (log.length) await tx.insert(events).values(log);
      return { serials: list.length, broken: broken.size + lines.reduce((n, l) => n + l.broken, 0) };
    });
    return done(result);
  } catch (e) {
    return { error: actionError(e) };
  }
}

/* ── קבלה מחטיבה ───────────────────────────────────────────────────────── */

const brigadeInSchema = z
  .object({
    day: moveDay,
    notes: optionalText(300),
    serials: z
      .array(z.object({ itemId: uuid, serial: z.string().transform(normalizeSerial).pipe(z.string().regex(/^[^\s]{1,40}$/, "צ׳ לא תקין (עד 40 תווים, בלי רווחים)")) }))
      .max(300, "יותר מדי צ׳ בבת אחת")
      .default([]),
    lines: z.array(z.object({ itemId: uuid, qty: count(9999) })).max(200).default([]),
  })
  .refine((v) => v.serials.length || v.lines.some((l) => l.qty > 0), "לא נבחר ציוד");
export type BrigadeInInput = z.input<typeof brigadeInSchema>;

/**
 * קבלה מחטיבה: צ׳ into the warehouse (new, or one returned to the brigade earlier coming back) and
 * ציוד משלים onto מלאי כללי.
 */
export async function receiveFromBrigade(input: BrigadeInInput): Promise<ActionOutcome<{ serials: number; lines: number }>> {
  const ctx = await adminCtx();
  if ("error" in ctx) return ctx;
  const parsed = brigadeInSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const dup = v.serials.map((x) => x.serial).filter((x, i, all) => all.indexOf(x) !== i);
  if (dup.length) return { error: `הצ׳ ${[...new Set(dup)].join(", ")} מופיע פעמיים` };

  try {
    const { at, backdated } = moveAt(v.day);
    const result = await withUser(ctx.s.claims, async (tx) => {
      const base = { at, backdated, details: v.notes } as const;
      const log: Event[] = [];

      if (v.serials.length) {
        const types = await tx.select({ id: items.id, name: items.name, kind: items.kind }).from(items).where(inArray(items.id, [...new Set(v.serials.map((x) => x.itemId))]));
        const type = new Map(types.map((t) => [t.id, t]));
        const existing = await tx
          .select({ id: serials.id, serial: serials.serial, location: serials.location, itemId: serials.itemId })
          .from(serials)
          .where(inArray(serials.serial, v.serials.map((x) => x.serial)));
        const bySerial = new Map(existing.map((x) => [x.serial, x]));
        const errors: string[] = [];
        for (const x of v.serials) {
          const t = type.get(x.itemId);
          const e = bySerial.get(x.serial);
          if (!t || t.kind !== "serial") errors.push(`סוג מכשיר לא תקין לצ׳ ${x.serial}`);
          else if (e && e.location !== "brigade") errors.push(`הצ׳ ${x.serial} כבר קיים במערכת`);
          else if (e && e.itemId !== x.itemId) errors.push(`הצ׳ ${x.serial} הוחזר לחטיבה כסוג מכשיר אחר`);
        }
        if (errors.length) throw new UserError(errors.join("\n"));
        const back = v.serials.filter((x) => bySerial.has(x.serial));
        const fresh = v.serials.filter((x) => !bySerial.has(x.serial));
        if (back.length)
          await tx
            .update(serials)
            .set({ location: "warehouse", unitId: null, condition: "ok", vehicle: null })
            .where(inArray(serials.id, back.map((x) => bySerial.get(x.serial)!.id)));
        if (fresh.length) await tx.insert(serials).values(fresh.map((x) => ({ itemId: x.itemId, serial: x.serial, location: "warehouse" as const })));
        for (const x of v.serials) log.push({ ...base, kind: "brigade_in", item: type.get(x.itemId)!.name, serial: x.serial, qty: 1 });
      }

      const lines = v.lines.filter((l) => l.qty > 0);
      const bulk = await lockBulk(tx, lines.map((l) => l.itemId));
      for (const l of lines) {
        const it = bulk.get(l.itemId)!;
        const next = (it.brigadeQty ?? 0) + l.qty;
        await tx.update(items).set({ brigadeQty: next }).where(eq(items.id, it.id));
        log.push({ ...base, kind: "brigade_in", item: it.name, qty: l.qty, details: [`מלאי כללי: ${it.brigadeQty ?? 0} ← ${next}`, v.notes].filter(Boolean).join(" · ") });
      }

      if (log.length) await tx.insert(events).values(log);
      return { serials: v.serials.length, lines: lines.length };
    });
    return done(result);
  } catch (e) {
    return { error: actionError(e) };
  }
}

/* ── זיכוי לחטיבה ──────────────────────────────────────────────────────── */

const brigadeOutSchema = z
  .object({
    day: moveDay,
    notes: optionalText(300),
    serialIds: ids,
    lines: z.array(z.object({ itemId: uuid, ok: count(9999), broken: count(9999) })).max(200).default([]),
  })
  .refine((v) => v.serialIds.length || v.lines.some((l) => l.ok + l.broken > 0), "לא נבחר ציוד");
export type BrigadeOutInput = z.input<typeof brigadeOutSchema>;

/** זיכוי לחטיבה: warehouse צ׳ (תקינים or תקולים) go back, and ציוד משלים comes off מלאי כללי. */
export async function returnToBrigade(input: BrigadeOutInput): Promise<ActionOutcome<{ serials: number; lines: number }>> {
  const ctx = await adminCtx();
  if ("error" in ctx) return ctx;
  const parsed = brigadeOutSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  try {
    const { at, backdated } = moveAt(v.day);
    const result = await withUser(ctx.s.claims, async (tx) => {
      const base = { at, backdated } as const;
      const note = (broken: boolean) => [broken ? "תקול" : null, v.notes].filter(Boolean).join(" · ") || null;
      const log: Event[] = [];

      const list = await loadSerials(tx, v.serialIds);
      const away = list.filter((x) => x.location !== "warehouse");
      if (away.length) throw new UserError(away.map((x) => `הצ׳ ${x.serial} (${x.item}) לא במחסן — מזכים לחטיבה רק מהמחסן`).join("\n"));
      if (list.length) {
        const moved = await tx
          .update(serials)
          .set({ location: "brigade", vehicle: null })
          .where(and(inArray(serials.id, v.serialIds), eq(serials.location, "warehouse")))
          .returning({ id: serials.id });
        if (moved.length !== list.length) throw new UserError("אחד הצ׳ זז בינתיים — רעננו את הדף");
        for (const x of list) log.push({ ...base, kind: "brigade_out", item: x.item, serial: x.serial, qty: 1, details: note(x.condition === "broken") });
      }

      const lines = v.lines.filter((l) => l.ok + l.broken > 0);
      const bulk = await lockBulk(tx, lines.map((l) => l.itemId));
      const errors: string[] = [];
      for (const l of lines) {
        const it = bulk.get(l.itemId)!;
        if (l.ok > it.available) errors.push(`${it.name}: במחסן ${Math.max(0, it.available)} תקינים`);
        if (l.broken > it.brokenQty) errors.push(`${it.name}: במחסן ${it.brokenQty} תקולים`);
      }
      if (errors.length) throw new UserError(errors.join("\n"));
      for (const l of lines) {
        const it = bulk.get(l.itemId)!;
        const next = (it.brigadeQty ?? 0) - l.ok - l.broken;
        await tx.update(items).set({ brigadeQty: next, brokenQty: it.brokenQty - l.broken }).where(eq(items.id, it.id));
        if (l.ok) log.push({ ...base, kind: "brigade_out", item: it.name, qty: l.ok, details: note(false) });
        if (l.broken) log.push({ ...base, kind: "brigade_out", item: it.name, qty: l.broken, details: note(true) });
      }

      if (log.length) await tx.insert(events).values(log);
      return { serials: list.length, lines: lines.length };
    });
    return done(result);
  } catch (e) {
    return { error: actionError(e) };
  }
}

/* ── תקין / תקול ───────────────────────────────────────────────────────── */

const conditionSchema = z
  .object({
    /** true = mark תקול; false = fixed (תקין) */
    broken: z.boolean(),
    serialIds: ids.default([]),
    /** ציוד משלים in the warehouse: how many move between תקין and תקול */
    lines: z.array(z.object({ itemId: uuid, qty: count(9999) })).max(200).default([]),
    notes: optionalText(300),
  })
  .refine((v) => v.serialIds.length || v.lines.some((l) => l.qty > 0), "לא נבחר ציוד");
export type ConditionInput = z.input<typeof conditionSchema>;

/**
 * תיקון (תקול → תקין) or marking warehouse equipment תקול. A צ׳ on a company is marked תקול only by
 * a זיכוי (it has to come back first); a fixed one may be anywhere.
 */
export async function setCondition(input: ConditionInput): Promise<ActionOutcome<{ changed: number }>> {
  const ctx = await adminCtx();
  if ("error" in ctx) return ctx;
  const parsed = conditionSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const to = v.broken ? "broken" : "ok";

  try {
    const changed = await withUser(ctx.s.claims, async (tx) => {
      const log: Event[] = [];
      const kind = v.broken ? ("serial_edit" as const) : ("repair" as const);
      const details = [v.broken ? "סומן תקול" : "תוקן", v.notes].filter(Boolean).join(" · ");

      const list = (await loadSerials(tx, v.serialIds)).filter((x) => x.condition !== to);
      if (v.broken) {
        const away = list.filter((x) => x.location !== "warehouse");
        if (away.length) throw new UserError(away.map((x) => `הצ׳ ${x.serial} לא במחסן — צ׳ תקול חוזר מהפלוגה בזיכוי`).join("\n"));
      }
      if (list.length) {
        await tx.update(serials).set({ condition: to }).where(inArray(serials.id, list.map((x) => x.id)));
        for (const x of list) log.push({ kind, unitId: x.unitId, item: x.item, serial: x.serial, qty: 1, details });
      }

      const lines = v.lines.filter((l) => l.qty > 0);
      const bulk = await lockBulk(tx, lines.map((l) => l.itemId));
      for (const l of lines) {
        const it = bulk.get(l.itemId)!;
        if (!v.broken && l.qty > it.brokenQty) throw new UserError(`${it.name}: במחסן רק ${it.brokenQty} תקולים`);
        if (v.broken && l.qty > it.available) throw new UserError(`${it.name}: במחסן רק ${Math.max(0, it.available)} תקינים`);
        await tx
          .update(items)
          .set({ brokenQty: it.brokenQty + (v.broken ? l.qty : -l.qty) })
          .where(eq(items.id, it.id));
        log.push({ kind, item: it.name, qty: l.qty, details: `${details} · ${qtyText(l.qty, it.name)}` });
      }

      if (log.length) await tx.insert(events).values(log);
      return log.length;
    });
    return done({ changed });
  } catch (e) {
    return { error: actionError(e) };
  }
}
