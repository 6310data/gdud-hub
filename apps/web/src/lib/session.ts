import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { can, type AppUser, type Membership } from "@gdud/auth";
import { isModuleId, toParentMap, type ModuleId, type UnitNode, type UnitParents } from "@gdud/core";
import { asc, eq, schema, sql, withUser, type JwtClaims } from "@gdud/db";
import { createSupabaseServer } from "./supabase/server";

export interface Session {
  claims: JwtClaims;
  user: AppUser;
  units: UnitNode[];
  parents: UnitParents;
}

/** Verified JWT claims of the signed-in Google account, or null. Cached per request. */
export const getClaims = cache(async (): Promise<JwtClaims | null> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as JwtClaims | undefined;
  return claims?.sub ? claims : null;
});

/**
 * The app user behind the session, with memberships and the unit tree — all read
 * through RLS. Returns null when the Google account isn't invited (or is disabled).
 * Cached per request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const claims = await getClaims();
  if (!claims) return null;

  return withUser(claims, async (tx) => {
    const loadMe = () =>
      tx.select().from(schema.appUsers).where(eq(schema.appUsers.authUserId, claims.sub)).limit(1);

    let [me] = await loadMe();
    if (!me) {
      // First sign-in, or invited after an earlier attempt: claim the invite by email.
      await tx.execute(sql`select app.link_auth_user()`);
      [me] = await loadMe();
    }
    if (!me || !me.active) return null;

    const [rows, unitRows] = await Promise.all([
      tx.select().from(schema.memberships).where(eq(schema.memberships.userId, me.id)),
      tx.select().from(schema.units).orderBy(asc(schema.units.sortOrder), asc(schema.units.name)),
    ]);

    const memberships: Membership[] = rows
      .filter((m) => isModuleId(m.module))
      .map((m) => ({ module: m.module as ModuleId, role: m.role, unitId: m.unitId }));

    const units: UnitNode[] = unitRows.map((u) => ({
      id: u.id,
      parentId: u.parentId,
      kind: u.kind,
      name: u.name,
      code: u.code,
      color: u.color,
      sortOrder: u.sortOrder,
      active: u.active,
    }));

    return {
      claims,
      user: {
        id: me.id,
        email: me.email,
        displayName: me.displayName,
        isSuperAdmin: me.isSuperAdmin,
        memberships,
      },
      units,
      parents: toParentMap(units),
    };
  });
});

/** Signed in AND invited, or redirect. */
export async function requireSession(): Promise<Session> {
  const claims = await getClaims();
  if (!claims) redirect("/login");
  const session = await getSession();
  if (!session) redirect("/no-access");
  return session;
}

/** Any role in the module, or 404 (don't reveal what exists). */
export async function requireModule(module: ModuleId): Promise<Session> {
  const session = await requireSession();
  if (!can(session.user, module, "any")) notFound();
  return session;
}

export function displayName(user: AppUser, claims?: JwtClaims): string {
  const meta = claims?.user_metadata as { full_name?: string; name?: string } | undefined;
  return user.displayName ?? meta?.full_name ?? meta?.name ?? user.email;
}
