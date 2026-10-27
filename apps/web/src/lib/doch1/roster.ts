import "server-only";
/**
 * The battalion list screen's view of a RosterPlan (@gdud/db/doch1-roster-import): plain data the
 * browser can render, with unit names instead of ids. Shared by the run and corrections routes.
 */
import { placement, type RosterField, type RosterMatch, type UnitNode } from "@gdud/core";
import type { RosterPlan, RosterQuestion } from "@gdud/db/doch1-roster-import";

export const ROSTER_FIELD_LABEL: Record<RosterField, string> = { name: "שם", unit: "פלוגה / מחלקה", phone: "טלפון", role: "תפקיד בפועל" };

export interface RosterFieldVM {
  field: RosterField;
  label: string;
  battalion: string;
  ours: string;
}

export interface RosterMatchVM {
  personalNumber: string;
  personId: string;
  name: string;
  /** in the running round: a company move waits for the activation */
  inActiveRound: boolean;
  fields: RosterFieldVM[];
}

export interface RosterPreview {
  baseRound: { id: string; name: string } | null;
  comparedWith: "base" | "planning";
  waiting: number;
  warnings: string[];
  questions: RosterQuestion[];
  added: Array<{ personalNumber: string; name: string; unit: string }>;
  returning: RosterMatchVM[];
  changed: RosterMatchVM[];
  unchanged: number;
  missing: Array<{ personId: string; personalNumber: string | null; name: string; unit: string }>;
  problems: Array<{ line: number; message: string }>;
}

/** "פלס״ר · מחלקה 1", a platoon the apply will create, or the unit's own name. */
export function unitNamer(units: readonly UnitNode[], plan: RosterPlan): (id: string) => string {
  const byId = new Map(units.map((u) => [u.id, u]));
  return (id) => {
    if (id.startsWith("new:")) {
      const p = plan.newPlatoons.get(id.slice(4));
      return p ? `${byId.get(p.companyId)?.name ?? ""} · ${p.name} (מחלקה חדשה)` : "";
    }
    const { company, platoon } = placement(id, byId);
    if (company && platoon) return `${company.name} · ${platoon.name}`;
    return company?.name ?? byId.get(id)?.name ?? "";
  };
}

export function rosterPreview(plan: RosterPlan, units: readonly UnitNode[], baseName: string | null): RosterPreview {
  const unitName = unitNamer(units, plan);
  const match = (m: RosterMatch): RosterMatchVM => ({
    personalNumber: m.row.personalNumber,
    personId: m.member.personId,
    name: m.member.fullName,
    inActiveRound: plan.inActiveRound.has(m.member.personId),
    fields: m.fields.map((f) => ({
      field: f,
      label: ROSTER_FIELD_LABEL[f],
      battalion: f === "name" ? m.row.fullName : f === "unit" ? unitName(m.row.unitId) : ((f === "phone" ? m.row.phone : m.row.role) ?? ""),
      ours: f === "name" ? m.member.fullName : f === "unit" ? unitName(m.member.unitId) : ((f === "phone" ? m.member.phone : m.member.role) ?? ""),
    })),
  });
  return {
    baseRound: plan.baseRoundId && baseName ? { id: plan.baseRoundId, name: baseName } : null,
    comparedWith: plan.comparedWith,
    waiting: plan.waiting,
    warnings: plan.warnings,
    questions: plan.questions,
    added: plan.diff.added.map((r) => ({ personalNumber: r.personalNumber, name: r.fullName, unit: unitName(r.unitId) })),
    returning: plan.diff.returning.map(match),
    changed: plan.diff.changed.map(match),
    unchanged: plan.diff.unchanged.length,
    missing: plan.diff.missing.map((m) => ({ personId: m.personId, personalNumber: m.personalNumber, name: m.fullName, unit: unitName(m.unitId) })),
    problems: plan.diff.problems,
  };
}
