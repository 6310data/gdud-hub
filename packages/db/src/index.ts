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
 *
 * Round trips matter: the database is in another region, so a page's cost is mostly the
 * number of sequential round trips, not the queries themselves. Inside a transaction,
 * postgres-js pipelines queries that are issued without awaiting each other (one round trip
 * for the whole batch), so load with Promise.all and the role setup rides along with the
 * first batch (see runAsUser).
 */
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export * as schema from "./schema/index";
export { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The subset of Supabase JWT claims RLS reads (auth.uid(), auth.jwt()). */
export interface JwtClaims {
  sub: string;
  role?: string;
  email?: string;
  [key: string]: unknown;
}

// One pool per process. The dev server bundles this module into more than one server chunk,
// so a module-level variable would mean one pool per chunk; globalThis is shared by all of them.
const g = globalThis as typeof globalThis & { __gdudDb?: Db };

function db(): Db {
  if (g.__gdudDb) return g.__gdudDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, {
    // Supabase transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    max: 5,
    // Keep connections open while the process lives: opening one costs several round trips
    // (and seconds on a slow link). Serverless instances are frozen with their connections.
    idle_timeout: 0,
    // Encrypt the link. The pooler's certificate chain ends in Supabase's own CA, which Node
    // doesn't know, so the chain isn't verified ("require" = TLS without CA verification).
    ssl: "require",
    connect_timeout: 30,
  });
  g.__gdudDb = drizzle(client, { schema });
  return g.__gdudDb;
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
    // set_config(…, true) is `set local`: it lasts for this transaction only.
    // Issued before fn's queries but not awaited: the driver sends it in the same batch as
    // fn's first queries and the server runs them in order, so the role is set by the time
    // they execute — one round trip instead of two. (`.then` starts the query now.)
    const setup = tx
      .execute(sql`select set_config('request.jwt.claims', ${json}, true), set_config('role', 'authenticated', true)`)
      .then(() => undefined);
    const [, result] = await Promise.all([setup, fn(tx as Tx)]);
    return result;
  });
}

/** RLS-bypassing access for trusted server-side jobs only. */
export function systemDb(): Db {
  return db();
}
