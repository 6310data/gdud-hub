/**
 * Database access.
 *
 *   withUser(claims, tx => …)   ← use this for everything a user does.
 *       Runs the callback in a transaction as Postgres role `authenticated` with the
 *       user's JWT claims, so Row-Level Security applies exactly as for Supabase's API.
 *
 *   systemDb()                  ← bypasses RLS. Only for trusted server jobs
 *       (imports, cron, bootstrap). Never call it with user-controlled input
 *       without your own permission check first.
 */
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export * as schema from "./schema/index";
export { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The subset of Supabase JWT claims RLS reads (auth.uid(), auth.jwt()). */
export interface JwtClaims {
  sub: string;
  role?: string;
  email?: string;
  [key: string]: unknown;
}

let _db: Db | undefined;

function db(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Supabase transaction pooler (port 6543) does not support prepared statements.
  const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20 });
  _db = drizzle(client, { schema });
  return _db;
}

/** Run `fn` as the signed-in user, with RLS enforced. */
export async function withUser<T>(claims: JwtClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!claims?.sub) throw new Error("withUser: missing claims.sub");
  return runAsUser(db(), claims, fn);
}

/** Exposed for tests (PGlite) — same logic against any drizzle Postgres database. */
export async function runAsUser<T, D extends { transaction: Db["transaction"] }>(
  database: D,
  claims: JwtClaims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    const json = JSON.stringify({ ...claims, role: "authenticated" });
    // One round trip: set_config('role', …, true) is `set local role`.
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${json}, true), set_config('role', 'authenticated', true)`,
    );
    return fn(tx as Tx);
  });
}

/** RLS-bypassing access for trusted server-side jobs only. */
export function systemDb(): Db {
  return db();
}
