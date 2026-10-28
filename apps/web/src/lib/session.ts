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
  /** the linked, active soldier of this account (app.my_person_id()), or null */
  personId: string | null;
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
    // One batch, one round trip (pipelined with the role setup): the user, their memberships,
    // the unit tree and their linked soldier. Memberships are found through the auth id so they don't wait for `me`.
    const loadMe = () =>
      tx.select().from(schema.appUsers).where(eq(schema.appUsers.authUserId, claims.sub)).limit(1);
    const loadMemberships = () =>
      tx
        .select({ module: schema.memberships.module, role: schema.memberships.role, unitId: schema.memberships.unitId })
        .from(schema.memberships)
        .innerJoin(schema.appUsers, eq(schema.appUsers.id, schema.memberships.userId))
        .where(eq(schema.appUsers.authUserId, claims.sub));

    const loadPerson = () => tx.execute<{ id: string | null }>(sql`select app.my_person_id() as id`);
    const [meRows, memberRows, unitRows, firstPerson] = await Promise.all([
      loadMe(),
      loadMemberships(),
      tx.select().from(schema.units).orderBy(asc(schema.units.sortOrder), asc(schema.units.name)),
      loadPerson(),
    ]);
    let me = meRows[0];
    let rows = memberRows;
    let personRows = firstPerson;
    if (!me) {
      // First sign-in, or invited after an earlier attempt: claim the invite by email.
      await tx.execute(sql`select app.link_auth_user()`);
      [[me], rows, personRows] = await Promise.all([loadMe(), loadMemberships(), loadPerson()]);
    }
    if (!me || !me.active) return null;

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
      personId: firstRow<{ id: string | null }>(personRows)?.id ?? null,
    };
  });
});

/** The first row of tx.execute() (an array on postgres-js, `{ rows }` on PGlite). */
function firstRow<T>(res: unknown): T | undefined {
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows)[0] as T | undefined;
}

/** Signed in AND invited (or linked to a soldier), or redirect — an unknown account goes to /join. */
export async function requireSession(): Promise<Session> {
  const claims = await getClaims();
  if (!claims) redirect("/login");
  const session = await getSession();
  if (!session) redirect("/join");
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
