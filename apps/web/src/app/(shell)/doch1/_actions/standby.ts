"use server";
/**
 * שבצ״ק and standby: teams, their members and vehicle, soldiers' locations.
 * can() gives the clear message; RLS (0008_doch1_standby_security.sql, 0035_company_standby_security.sql)
 * enforces the same rules: a team is edited by the battalion admin and the company users of its holding
 * companies; a company's own team (unit_id) — held by that company only, with its soldiers and its
 * vehicles — also by that company's admin in ניהול פלוגה, who uses these same actions.
 * A status change from the team editor goes through setDayStatus (days.ts), so the day lock applies.
 */
import { z } from "zod";
import { VEHICLE_STATES } from "@gdud/core";
import { and, eq, inArray, schema, sql, withUser, type Tx } from "@gdud/db";
import { actionError, pgCode, UserError, type ActionOutcome, type ActionResult } from "@/lib/action-result";
import { doch1Ctx, firstIssue, NO_PERMISSION, NO_ROUND, revalidateDoch1, uuid, type Doch1Ctx } from "./common";

const { people, doch1Members: members, doch1Locations: locations, doch1Vehicles: vehicles, doch1StandbyTypes: types } = schema;
const { doch1StandbyTeams: teams, doch1StandbyHolders: holders, doch1StandbyMembers: teamMembers } = schema;

const MAX_LOCATE = 300;
const optionalId = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(uuid.nullable());

/** Throws unless the user edits this team of the active round; returns its company (null = battalion). */
async function assertTeamEditable(tx: Tx, ctx: Doch1Ctx, teamId: string): Promise<{ unitId: string | null }> {
  const [team] = await tx.select({ roundId: teams.roundId, unitId: teams.unitId }).from(teams).where(eq(teams.id, teamId));
  if (!team || team.roundId !== ctx.round.id) throw new UserError("הצוות לא נמצא");
  const hs = await tx.select({ unitId: holders.unitId }).from(holders).where(eq(holders.teamId, teamId));
  if (!ctx.access.canEditTeam(hs.map((h) => h.unitId), team.unitId)) throw new UserError(NO_PERMISSION.error);
  return { unitId: team.unitId };
}

async function assertRoundRef(tx: Tx, ctx: Doch1Ctx, ref: { typeId?: string | null; locationId?: string | null }): Promise<void> {
  if (ref.typeId) {
    const [t] = await tx.select({ roundId: types.roundId }).from(types).where(eq(types.id, ref.typeId));
    if (t?.roundId !== ctx.round.id) throw new UserError("סוג הכוננות לא נמצא");
  }
  if (ref.locationId) {
    const [l] = await tx.select({ roundId: locations.roundId }).from(locations).where(eq(locations.id, ref.locationId));
    if (l?.roundId !== ctx.round.id) throw new UserError("המיקום לא נמצא");
  }
}

async function run(fn: (ctx: Doch1Ctx, tx: Tx) => Promise<void>): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  try {
    await withUser(ctx.s.claims, (tx) => fn(ctx, tx));
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

/* ── teams ── */

const createInput = z.object({
  name: z.string().trim().min(1, "שם הצוות חסר").max(40, "עד 40 תווים"),
  holderId: uuid,
  typeId: optionalId,
  locationId: optionalId,
  /** "battalion" = a shared team held by the company (the battalion admin only); default: the company's own */
  scope: z.enum(["company", "battalion"]).optional(),
});

/**
 * "צוות חדש": the company's own team (its holder is the company, kept by trigger); the battalion admin
 * may instead open a shared team held by that company (more holders: in the team editor).
 */
export async function createTeam(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = createInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { name, holderId, typeId, locationId, scope } = parsed.data;
  return run(async (ctx, tx) => {
    if (!ctx.access.canEditCompanyStandby(holderId) || !ctx.s.units.some((u) => u.id === holderId && u.kind === "company")) {
      throw new UserError(NO_PERMISSION.error);
    }
    const shared = scope === "battalion" && ctx.access.isAdmin;
    await assertRoundRef(tx, ctx, { typeId, locationId });
    const [team] = await tx
      .insert(teams)
      .values({ roundId: ctx.round.id, name, typeId, locationId, unitId: shared ? null : holderId })
      .returning({ id: teams.id });
    if (shared) await tx.insert(holders).values({ teamId: team!.id, unitId: holderId });
  });
}

/** The battalion admin moves a team to a company (its own team) or back to the battalion (shared). */
export async function setTeamCompany(raw: { teamId: string; unitId: string | null }): Promise<ActionResult> {
  const parsed = z.object({ teamId: uuid, unitId: uuid.nullable() }).safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { teamId, unitId } = parsed.data;
  return run(async (ctx, tx) => {
    if (!ctx.access.isAdmin) throw new UserError(NO_PERMISSION.error);
    if (unitId && !ctx.s.units.some((u) => u.id === unitId && u.kind === "company")) throw new UserError("הפלוגה לא נמצאה");
    await assertTeamEditable(tx, ctx, teamId);
    await tx.update(teams).set({ unitId }).where(eq(teams.id, teamId));
  });
}

/** The battalion admin gives a vehicle to a company, or back to the battalion. */
export async function setVehicleCompany(raw: { vehicleId: string; unitId: string | null }): Promise<ActionResult> {
  const parsed = z.object({ vehicleId: uuid, unitId: uuid.nullable() }).safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { vehicleId, unitId } = parsed.data;
  return run(async (ctx, tx) => {
    if (!ctx.access.isAdmin) throw new UserError(NO_PERMISSION.error);
    if (unitId && !ctx.s.units.some((u) => u.id === unitId && u.kind === "company")) throw new UserError("הפלוגה לא נמצאה");
    const r = await tx.update(vehicles).set({ unitId }).where(eq(vehicles.id, vehicleId)).returning({ id: vehicles.id });
    if (!r.length) throw new UserError(NO_PERMISSION.error);
  });
}

const updateInput = z.object({
  teamId: uuid,
  name: z.string().trim().min(1, "שם הצוות חסר").max(40, "עד 40 תווים").optional(),
  typeId: uuid.nullable().optional(),
  locationId: uuid.nullable().optional(),
  active: z.boolean().optional(),
});

/** Name, type, location (מוצב) or active of a team; only the fields given change. */
export async function updateTeam(raw: z.input<typeof updateInput>): Promise<ActionResult> {
  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { teamId, ...set } = parsed.data;
  return run(async (ctx, tx) => {
    await assertTeamEditable(tx, ctx, teamId);
    await assertRoundRef(tx, ctx, set);
    await tx.update(teams).set(set).where(eq(teams.id, teamId));
  });
}

export async function deleteTeam(raw: { teamId: string }): Promise<ActionResult> {
  const parsed = z.object({ teamId: uuid }).safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return run(async (ctx, tx) => {
    await assertTeamEditable(tx, ctx, parsed.data.teamId);
    await tx.delete(teams).where(eq(teams.id, parsed.data.teamId));
  });
}

const holderInput = z.object({ teamId: uuid, unitId: uuid, add: z.boolean() });

/** Add or remove a holding company (battalion admin; RLS refuses anyone else adding one). */
export async function setTeamHolder(raw: { teamId: string; unitId: string; add: boolean }): Promise<ActionResult> {
  const parsed = holderInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { teamId, unitId, add } = parsed.data;
  return run(async (ctx, tx) => {
    if (!ctx.access.isAdmin) throw new UserError(NO_PERMISSION.error);
    if (!ctx.s.units.some((u) => u.id === unitId && u.kind === "company")) throw new UserError("הפלוגה לא נמצאה");
    const team = await assertTeamEditable(tx, ctx, teamId);
    if (team.unitId) throw new UserError("צוות של פלוגה מוחזק רק על ידה. כדי לשתף אותו, העבירו אותו לגדודי.");
    if (add) await tx.insert(holders).values({ teamId, unitId }).onConflictDoNothing();
    else await tx.delete(holders).where(and(eq(holders.teamId, teamId), eq(holders.unitId, unitId)));
  });
}

/* ── team members ── */

/** A member to put back on undo. */
export interface TeamSlot {
  personId: string;
  role: string | null;
  sortOrder: number;
}

async function slotOf(tx: Tx, teamId: string, personId: string): Promise<TeamSlot> {
  const [m] = await tx
    .select({ personId: teamMembers.personId, role: teamMembers.role, sortOrder: teamMembers.sortOrder })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.personId, personId)));
  if (!m) throw new UserError("החייל כבר לא בצוות");
  return m;
}

/** The person's תפקיד בפועל, after checking they are in the round and the user may place them on this team. */
async function newcomer(tx: Tx, ctx: Doch1Ctx, personId: string, teamUnitId: string | null): Promise<string | null> {
  const [p] = await tx
    .select({ unitId: people.unitId, roleTitle: people.roleTitle })
    .from(people)
    .innerJoin(members, and(eq(members.personId, people.id), eq(members.roundId, ctx.round.id)))
    .where(eq(people.id, personId));
  if (!p) throw new UserError("החייל לא נמצא בסבב");
  if (!ctx.access.canPlace(p.unitId, teamUnitId)) throw new UserError(NO_PERMISSION.error);
  return p.roleTitle;
}

async function onAnotherTeam(tx: Tx, ctx: Doch1Ctx, personId: string): Promise<boolean> {
  const r = await tx
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.roundId, ctx.round.id), eq(teamMembers.personId, personId)));
  return r.length > 0;
}

const ON_TEAM = "החייל כבר בצוות כוננות אחר.";

const addInput = z.object({ teamId: uuid, personId: uuid, role: z.string().trim().max(30).nullable().optional(), sortOrder: z.number().int().min(0).max(999).optional() });

/** Add a soldier (role = their תפקיד בפועל unless given — the undo of a removal gives it). */
export async function addTeamMember(raw: z.input<typeof addInput>): Promise<ActionResult> {
  const parsed = addInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { teamId, personId } = parsed.data;
  return run(async (ctx, tx) => {
    const team = await assertTeamEditable(tx, ctx, teamId);
    const roleTitle = await newcomer(tx, ctx, personId, team.unitId);
    if (await onAnotherTeam(tx, ctx, personId)) throw new UserError(ON_TEAM);
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${teamMembers.sortOrder}) + 1, 0)::int` })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId))) as [{ next: number }];
    await tx.insert(teamMembers).values({
      roundId: ctx.round.id,
      teamId,
      personId,
      role: parsed.data.role === undefined ? roleTitle : parsed.data.role || null,
      sortOrder: parsed.data.sortOrder ?? next,
    });
  });
}

/** Remove a soldier from the team. Returns the slot for undo. */
export async function removeTeamMember(raw: { teamId: string; personId: string }): Promise<ActionOutcome<{ undo: TeamSlot }>> {
  const parsed = z.object({ teamId: uuid, personId: uuid }).safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const { teamId, personId } = parsed.data;
  try {
    const undo = await withUser(ctx.s.claims, async (tx) => {
      await assertTeamEditable(tx, ctx, teamId);
      const slot = await slotOf(tx, teamId, personId);
      await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.personId, personId)));
      return slot;
    });
    revalidateDoch1();
    return { ok: true, data: { undo } };
  } catch (err) {
    return { error: actionError(err) };
  }
}

const swapInput = z.object({ teamId: uuid, outId: uuid, inId: uuid, role: z.string().trim().max(30).nullable().optional() }).refine((v) => v.outId !== v.inId, { message: "זה אותו חייל" });

/**
 * "החלפה" (mockup 12): the newcomer takes the member's place in the list, with their own תפקיד בפועל
 * (or `role`, for the undo). Returns the swap that undoes it.
 */
export async function swapTeamMember(raw: z.input<typeof swapInput>): Promise<ActionOutcome<{ undo: { outId: string; inId: string; role: string | null } }>> {
  const parsed = swapInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const { teamId, outId, inId } = parsed.data;
  try {
    const undo = await withUser(ctx.s.claims, async (tx) => {
      const team = await assertTeamEditable(tx, ctx, teamId);
      const slot = await slotOf(tx, teamId, outId);
      const roleTitle = await newcomer(tx, ctx, inId, team.unitId);
      if (await onAnotherTeam(tx, ctx, inId)) throw new UserError(ON_TEAM);
      await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.personId, outId)));
      await tx.insert(teamMembers).values({
        roundId: ctx.round.id,
        teamId,
        personId: inId,
        role: parsed.data.role === undefined ? roleTitle : parsed.data.role || null,
        sortOrder: slot.sortOrder,
      });
      return { outId: inId, inId: outId, role: slot.role };
    });
    revalidateDoch1();
    return { ok: true, data: { undo } };
  } catch (err) {
    return { error: actionError(err) };
  }
}

/* ── vehicles ── */

const vehicleNumber = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^[0-9A-Za-z-]{0,20}$/, "צ׳ רכב: ספרות בלבד, עד 20 תווים"));

/** The team's vehicle by צ׳: an existing vehicle, a new one, or none (empty). */
export async function setTeamVehicle(raw: { teamId: string; number: string }): Promise<ActionResult> {
  const parsed = z.object({ teamId: uuid, number: vehicleNumber }).safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { teamId, number } = parsed.data;
  return run(async (ctx, tx) => {
    const team = await assertTeamEditable(tx, ctx, teamId);
    let vehicleId: string | null = null;
    if (number) {
      // a company team sees and takes only its company's vehicles; a new one becomes the company's
      const [found] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.number, number));
      if (found) vehicleId = found.id;
      else {
        // not visible but existing = another company's (or the battalion's) vehicle
        const added = await tx
          .insert(vehicles)
          .values({ number, unitId: team.unitId })
          .returning({ id: vehicles.id })
          .catch((err: unknown) => {
            if (pgCode(err) === "23505") throw new UserError("הרכב הזה שייך לפלוגה אחרת או לגדוד. מנהל גדודי בדוח 1 מעביר רכבים בין פלוגות.");
            throw err;
          });
        vehicleId = added[0]!.id;
      }
    }
    await tx.update(teams).set({ vehicleId }).where(eq(teams.id, teamId));
  });
}

/** מצב הרכב — the admin, or an editor of a team that uses it (RLS: doch1_vehicle_editable). */
export async function setVehicleState(raw: { vehicleId: string; state: string }): Promise<ActionResult> {
  const parsed = z.object({ vehicleId: uuid, state: z.enum(VEHICLE_STATES) }).safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { vehicleId, state } = parsed.data;
  return run(async (ctx, tx) => {
    if (!ctx.access.isAdmin) {
      const [v] = await tx.select({ unitId: vehicles.unitId }).from(vehicles).where(eq(vehicles.id, vehicleId));
      const used = await tx.select({ id: teams.id, unitId: teams.unitId }).from(teams).where(and(eq(teams.vehicleId, vehicleId), eq(teams.roundId, ctx.round.id)));
      const hs = used.length ? await tx.select({ unitId: holders.unitId }).from(holders).where(inArray(holders.teamId, used.map((u) => u.id))) : [];
      const ok =
        (v?.unitId && ctx.access.canEditCompanyStandby(v.unitId)) ||
        ctx.access.canEditTeam(hs.map((h) => h.unitId)) ||
        used.some((t) => ctx.access.canEditTeam([], t.unitId));
      if (!ok) throw new UserError(NO_PERMISSION.error);
    }
    const r = await tx.update(vehicles).set({ state }).where(eq(vehicles.id, vehicleId)).returning({ id: vehicles.id });
    if (!r.length) throw new UserError(NO_PERMISSION.error);
  });
}

/* ── soldiers' locations ── */

const locateInput = z.object({
  personIds: z.array(uuid).min(1, "לא נבחרו חיילים").max(MAX_LOCATE, `עד ${MAX_LOCATE} חיילים בפעם אחת`),
  locationId: uuid.nullable(),
});

/** מיקום בשבצ״ק for one or more soldiers (null = not in the שבצ״ק). */
export async function setMembersLocation(raw: { personIds: string[]; locationId: string | null }): Promise<ActionResult> {
  const parsed = locateInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const personIds = [...new Set(parsed.data.personIds)];
  const { locationId } = parsed.data;
  return run(async (ctx, tx) => {
    const rows = await tx.select({ id: people.id, unitId: people.unitId }).from(people).where(inArray(people.id, personIds));
    if (rows.length !== personIds.length || rows.some((r) => !ctx.access.canLocate(r.unitId))) throw new UserError(NO_PERMISSION.error);
    await assertRoundRef(tx, ctx, { locationId });
    await tx
      .update(members)
      .set({ locationId })
      .where(and(eq(members.roundId, ctx.round.id), inArray(members.personId, personIds)));
  });
}
