import { getModule, type ModuleId } from "@gdud/core";
import type { Session } from "@/lib/session";

/**
 * The user's role in a module for the sidebar's user card: the module's highest role they hold,
 * with its unit ("משתמש פלוגה · פלסר", "מנהל · כל הגדוד"). Display only.
 */
export function moduleRoleLabel({ user, units }: Pick<Session, "user" | "units">, moduleId: ModuleId): { role: string; tone: "admin" | "signed" } | null {
  const def = getModule(moduleId);
  if (!def) return null;
  if (user.isSuperAdmin) return { role: "מנהל מערכת", tone: "admin" };
  const mine = user.memberships.filter((m) => m.module === moduleId);
  const rank = (role: string) => def.roles.findIndex((r) => r.id === role);
  const top = [...mine].sort((a, b) => rank(a.role) - rank(b.role) || (a.unitId ? 1 : 0) - (b.unitId ? 1 : 0))[0];
  if (!top) return null;
  const label = def.roles.find((r) => r.id === top.role)?.label ?? top.role;
  const unit = top.unitId ? (units.find((u) => u.id === top.unitId)?.name ?? null) : "כל הגדוד";
  return { role: unit ? `${label} · ${unit}` : label, tone: top.role === "admin" ? "admin" : "signed" };
}
