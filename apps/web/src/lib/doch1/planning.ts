import "server-only";
/**
 * Read models of the round being planned (תכנון סבב). Like data.ts, everything runs in the
 * caller's withUser transaction: a company user gets their own soldiers only.
 */
import { byHe, placement, type Day, type UnitNode } from "@gdud/core";
import { eq, schema, type Tx } from "@gdud/db";

const { people, doch1Members: members } = schema;

export interface PlanningMemberVM {
  personId: string;
  name: string;
  personalNumber: string | null;
  roleTitle: string | null;
  /** the soldier's unit now (RLS scope) */
  unitId: string;
  /** company / platoon in the planned round: the pending move's unit, else the current one */
  companyId: string | null;
  platoonId: string | null;
  platoonName: string | null;
  /** company name the soldier leaves, when a move waits for the activation */
  movedFrom: string | null;
  arrivalOptionId: string | null;
  callUpOn: Day | null;
}

export async function loadPlanningMembers(tx: Tx, roundId: string, units: readonly UnitNode[]): Promise<PlanningMemberVM[]> {
  const byId = new Map(units.map((u) => [u.id, u]));
  const rows = await tx
    .select({
      personId: members.personId,
      name: people.fullName,
      personalNumber: people.personalNumber,
      roleTitle: people.roleTitle,
      unitId: people.unitId,
      plannedUnitId: members.plannedUnitId,
      arrivalOptionId: members.arrivalOptionId,
      callUpOn: members.callUpOn,
    })
    .from(members)
    .innerJoin(people, eq(people.id, members.personId))
    .where(eq(members.roundId, roundId));
  return rows
    .map((r) => {
      const { company, platoon } = placement(r.plannedUnitId ?? r.unitId, byId);
      const from = r.plannedUnitId ? placement(r.unitId, byId).company : null;
      return {
        personId: r.personId,
        name: r.name,
        personalNumber: r.personalNumber,
        roleTitle: r.roleTitle,
        unitId: r.unitId,
        companyId: company?.id ?? null,
        platoonId: platoon?.id ?? null,
        platoonName: platoon?.name ?? null,
        movedFrom: from && from.id !== company?.id ? from.name : null,
        arrivalOptionId: r.arrivalOptionId,
        callUpOn: r.callUpOn,
      };
    })
    .sort((a, b) => byHe(a.name, b.name));
}
