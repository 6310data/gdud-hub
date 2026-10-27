import { can } from "@gdud/auth";
import type { Session } from "@/lib/session";

/**
 * What the signed-in user may do in logistics — UI decisions only.
 * The same rules are enforced by RLS (packages/db/migrations/0003_logistics_security.sql).
 */
export interface LogisticsAccess {
  /** admin anywhere: sees the action buttons (sign-out, return…) */
  isAdmin: boolean;
  /** battalion-wide admin: catalogue, kit standards, serials */
  isStockAdmin: boolean;
  /** battalion-wide master admin: settings and the department's roles */
  isMaster: boolean;
  /** may sign out / return / store for soldiers of this unit */
  canAdminUnit: (unitId: string | null | undefined) => boolean;
  /** may add or edit soldiers in this unit from logistics (core editors use the admin screens) */
  canEditPeople: (unitId: string | null | undefined) => boolean;
}

export function logisticsAccess({ user, parents }: Pick<Session, "user" | "parents">): LogisticsAccess {
  const canAdminUnit = (unitId: string | null | undefined) =>
    Boolean(unitId) && can(user, "logistics", ["admin"], unitId, parents);
  return {
    isAdmin: can(user, "logistics", ["admin"]),
    isStockAdmin: can(user, "logistics", ["admin"], null),
    isMaster: can(user, "logistics", ["master_admin"], null),
    canAdminUnit,
    canEditPeople: canAdminUnit,
  };
}
