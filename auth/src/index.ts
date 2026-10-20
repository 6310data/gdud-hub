/**
 * Permission model (mirrors the SQL in packages/db/migrations/*_security.sql — keep them in sync).
 *
 *   user ─┬─ membership(module, role, unit?)   unit = null → whole battalion
 *         └─ isSuperAdmin                       everything, everywhere
 *
 * A membership scoped to a unit covers that unit and every unit below it.
 *
 * This file is for UI decisions (what to show). The database enforces the same
 * rules with Row-Level Security, so a bug here can hide a button but can never leak data.
 */
import {
  MODULES,
  lineage,
  type ModuleId,
  type RoleOf,
  type UnitParents,
} from "@gdud/core";

export interface Membership {
  module: ModuleId;
  role: string;
  /** null = battalion-wide */
  unitId: string | null;
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string | null;
  isSuperAdmin: boolean;
  memberships: Membership[];
}

/**
 * - `undefined`: module-level question ("may this user use the module at all, anywhere?")
 * - `null`: a battalion-level resource — only battalion-wide memberships qualify
 * - a unit id: memberships on that unit or any ancestor qualify
 */
export type Target = string | null | undefined;

export function covers(scope: string | null, target: Target, parents: UnitParents): boolean {
  if (target === undefined) return true;
  if (scope === null) return true;
  if (target === null) return false;
  return lineage(target, parents).includes(scope);
}

export function can<M extends ModuleId>(
  user: AppUser | null | undefined,
  module: M,
  roles: readonly RoleOf<M>[] | "any",
  target?: Target,
  parents: UnitParents = new Map(),
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return user.memberships.some(
    (m) =>
      m.module === module &&
      (roles === "any" || (roles as readonly string[]).includes(m.role)) &&
      covers(m.unitId, target, parents),
  );
}

/** Modules the user can open, in registry order. */
export function accessibleModules(user: AppUser | null | undefined): Array<(typeof MODULES)[number]> {
  if (!user) return [];
  return MODULES.filter((m) => can(user, m.id, "any"));
}

/** Units (ids) on which the user holds any of `roles` in `module`; `null` in the result = battalion-wide. */
export function scopesFor<M extends ModuleId>(
  user: AppUser,
  module: M,
  roles: readonly RoleOf<M>[] | "any" = "any",
): Array<string | null> {
  if (user.isSuperAdmin) return [null];
  const out = new Set<string | null>();
  for (const m of user.memberships) {
    if (m.module !== module) continue;
    if (roles !== "any" && !(roles as readonly string[]).includes(m.role)) continue;
    out.add(m.unitId);
  }
  return [...out];
}

/** Only allow same-origin relative paths as post-login redirects (blocks open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
