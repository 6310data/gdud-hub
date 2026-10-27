import { can } from "@gdud/auth";
import type { UnitNode } from "@gdud/core";
import { companiesOf } from "@/lib/logistics/data";
import type { Session } from "@/lib/session";

/**
 * What the signed-in user may do in מחלקת קשר — UI decisions only. The same rules are enforced
 * by RLS (packages/db/migrations/0018_kesher_security.sql).
 *
 * Kesher memberships are battalion-wide or on a company. A company-scoped admin gets no more than
 * a user there: signing moves equipment out of the battalion warehouse, so it needs a battalion admin.
 */
export interface KesherAccess {
  /** battalion-wide admin (or super admin): import, and in Phase 2 החתמה / זיכוי / קליטה / stock */
  isAdmin: boolean;
  /** sees every company's holders, reports and log */
  allCompanies: boolean;
  /** the companies the user covers, in display order */
  companies: UnitNode[];
  covers(unitId: string | null | undefined): boolean;
}

export function kesherAccess({ user, units, parents }: Pick<Session, "user" | "units" | "parents">): KesherAccess {
  const allCompanies = can(user, "kesher", "any", null);
  const covers = (unitId: string | null | undefined) => Boolean(unitId) && can(user, "kesher", "any", unitId, parents);
  return {
    isAdmin: can(user, "kesher", ["admin"], null),
    allCompanies,
    companies: companiesOf(units).filter((c) => allCompanies || covers(c.id)),
    covers,
  };
}
