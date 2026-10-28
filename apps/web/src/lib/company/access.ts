import "server-only";
import { notFound } from "next/navigation";
import { can } from "@gdud/auth";
import { lineage, type UnitNode } from "@gdud/core";
import { companiesOf } from "@/lib/logistics/data";
import { requireSession, type Session } from "@/lib/session";

/**
 * What the signed-in user may do in ניהול פלוגה — UI decisions only. The same rules are enforced
 * by the functions and policies of packages/db/migrations/0027_company_security.sql.
 *
 *   linked soldier     session.personId: אני only (their own gear, days and details)
 *   company admin      a company (or the battalion): everything in it
 *   platoon commander  a platoon: its roster, its internal signings, its change requests
 */
export interface CompanyScope {
  company: UnitNode;
  isAdmin: boolean;
  /** the platoons the user commands in this company (empty for an admin of the whole company) */
  platoons: UnitNode[];
}

export interface CompanyAccess {
  /** the linked soldier, if any */
  personId: string | null;
  /** companies the user is a member of, in display order */
  companies: CompanyScope[];
  /** where the module's sections point by default: the first company */
  home: CompanyScope | null;
  scope(unitId: string | null | undefined): CompanyScope | undefined;
}

export function companyAccess({ user, units, parents, personId }: Pick<Session, "user" | "units" | "parents" | "personId">): CompanyAccess {
  const companies: CompanyScope[] = [];
  for (const company of companiesOf(units)) {
    const isAdmin = can(user, "company", ["admin"], company.id, parents);
    const platoons = isAdmin
      ? []
      : units.filter((u) => u.parentId === company.id && u.active && can(user, "company", ["platoon_commander"], u.id, parents));
    if (isAdmin || platoons.length || can(user, "company", "any", company.id, parents)) companies.push({ company, isAdmin, platoons });
  }
  return {
    personId,
    companies,
    home: companies[0] ?? null,
    scope: (unitId) => (unitId ? companies.find((c) => c.company.id === unitId) : undefined),
  };
}

/** The module's door: a company member or a linked soldier, else 404 (don't reveal what exists). */
export async function requireCompany(): Promise<{ s: Session; access: CompanyAccess }> {
  const s = await requireSession();
  const member = can(s.user, "company", "any");
  if (!member && !s.personId) notFound();
  return { s, access: companyAccess(s) };
}

/** A company page: the user must be a member of that company. */
export async function requireCompanyScope(unitId: string): Promise<{ s: Session; access: CompanyAccess; scope: CompanyScope }> {
  const { s, access } = await requireCompany();
  const scope = access.scope(unitId);
  if (!scope) notFound();
  return { s, access, scope };
}

/** Does this soldier's unit fall inside what the user covers in this company? */
export function coversPerson(scope: CompanyScope, personUnitId: string, parents: Session["parents"]): boolean {
  const up = lineage(personUnitId, parents);
  if (!up.includes(scope.company.id)) return false;
  return scope.isAdmin || scope.platoons.some((p) => up.includes(p.id));
}
