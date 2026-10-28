import { can, scopesFor } from "@gdud/auth";
import type { Session } from "@/lib/session";

/**
 * What the signed-in user may do in דוח 1 — UI decisions only.
 * The same rules are enforced by RLS and the day guard
 * (packages/db/migrations/0005_doch1_security.sql, 0008_doch1_standby_security.sql).
 */
export interface Doch1Access {
  /** battalion-wide doch1 admin or master admin (or super admin): every company, past days, import */
  isAdmin: boolean;
  /** battalion-wide doch1 master admin (or super admin): settings and the department's roles */
  isMaster: boolean;
  /** any doch1 role */
  canView: boolean;
  /** battalion overview: admin or viewer */
  canOverview: boolean;
  /** copy-to-sheet: admin or company user */
  canCopy: boolean;
  /** attendance board (לוח נוכחות): admin or company user */
  canBoard: boolean;
  /** reports (דוחות): admin and viewer battalion-wide; a company user (or company viewer) their own company, through RLS */
  canReports: boolean;
  /** units the user reports for: companies (company_user) and platoons (platoon_commander); admin → all active round companies */
  reportScopes: string[];
  /** admin / company_user / platoon_commander covering unitId */
  canReport: (unitId: string) => boolean;
  /** may create a standby team: admin or a company user (for their own company) */
  canCreateTeam: boolean;
  /**
   * may edit a standby team held by these companies: admin, or a company user of one of them; a
   * company's own team (`teamUnitId`) also by that company's admin in ניהול פלוגה (0035)
   */
  canEditTeam: (holderIds: readonly string[], teamUnitId?: string | null) => boolean;
  /** may edit a company's own standby (teams, vehicles): admin, its company user, or its ניהול פלוגה admin */
  canEditCompanyStandby: (unitId: string) => boolean;
  /** may set a soldier's שבצ״ק location: admin / company_user covering the soldier's unit */
  canLocate: (unitId: string) => boolean;
  /** may put this soldier on a team: canLocate, or for a company's own team that company's ניהול פלוגה admin */
  canPlace: (unitId: string, teamUnitId?: string | null) => boolean;
}

const REPORT_ROLES = ["admin", "company_user", "platoon_commander"] as const;

/** @param roundCompanyIds active companies of the active round (an admin reports for all of them) */
export function doch1Access({ user, parents }: Pick<Session, "user" | "parents">, roundCompanyIds: readonly string[] = []): Doch1Access {
  const isAdmin = can(user, "doch1", ["admin"], null);
  const scopes = scopesFor(user, "doch1", REPORT_ROLES);
  const battalionWide = isAdmin || scopes.includes(null);
  return {
    isAdmin,
    isMaster: can(user, "doch1", ["master_admin"], null),
    canView: can(user, "doch1", "any"),
    canOverview: isAdmin || can(user, "doch1", ["viewer"]),
    canCopy: isAdmin || can(user, "doch1", ["company_user"]),
    canBoard: isAdmin || can(user, "doch1", ["company_user"]),
    canReports: isAdmin || can(user, "doch1", ["viewer", "company_user"]),
    reportScopes: battalionWide ? [...roundCompanyIds] : scopes.filter((u): u is string => u !== null),
    canReport: (unitId) => can(user, "doch1", REPORT_ROLES, unitId, parents),
    canCreateTeam: isAdmin || can(user, "doch1", ["company_user"]),
    canEditTeam: (holderIds, teamUnitId) =>
      isAdmin || holderIds.some((u) => can(user, "doch1", ["company_user"], u, parents)) || (!!teamUnitId && can(user, "company", ["admin"], teamUnitId, parents)),
    canEditCompanyStandby: (unitId) => can(user, "doch1", ["admin", "company_user"], unitId, parents) || can(user, "company", ["admin"], unitId, parents),
    canLocate: (unitId) => can(user, "doch1", ["admin", "company_user"], unitId, parents),
    canPlace: (unitId, teamUnitId) =>
      can(user, "doch1", ["admin", "company_user"], unitId, parents) || (!!teamUnitId && can(user, "company", ["admin"], teamUnitId, parents)),
  };
}
