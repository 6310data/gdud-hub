/**
 * Applies packages/db/migrations to the database in MIGRATION_DATABASE_URL.
 * Same migration files and tracking table as `drizzle-kit migrate`, but prints
 * the real error (drizzle-kit hides it) plus a hint for the common Supabase mistakes.
 *
 *   pnpm db:migrate
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadRootEnv } from "./env";

loadRootEnv();

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL is not set. Put it in the .env file at the repo root (see .env.example).");
  process.exit(1);
}

const masked = url.replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:****@");
console.log(`Connecting to ${masked}`);

const client = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });

function hint(err: unknown): string | undefined {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.code ?? e?.cause?.code;
  const msg = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return "Host not found. Copy the connection string again from Supabase → Connect → Session pooler.";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT")
    return "Can't reach the database. Use the *Session pooler* string (port 5432), not 'Direct connection' (IPv6 only). A work network may also block port 5432/6543.";
  if (code === "28P01" || /password authentication failed/i.test(msg))
    return "Wrong password. Use the database password (Supabase → Project Settings → Database), not your Supabase login. If it contains @ : / ? # % characters, URL-encode them or reset it to letters+digits.";
  if (/Tenant or user not found/i.test(msg))
    return "The pooler user must be postgres.<project-ref> (copy the string from Supabase → Connect → Session pooler).";
  if (code === "SELF_SIGNED_CERT_IN_CHAIN" || /certificate/i.test(msg))
    return "TLS problem, often a corporate proxy inspecting traffic. Try from another network.";
  return undefined;
}

try {
  const [row] = await client<{ version: string }[]>`select version()`;
  console.log(`Connected: ${row?.version.split(",")[0]}`);

  await migrate(drizzle(client), {
    migrationsFolder: "./migrations",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "drizzle",
  });

  const applied = await client<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
  console.log(`✓ Migrations up to date (${applied[0]?.n ?? 0} applied).`);
} catch (err) {
  console.error("\n✗ Migration failed\n");
  console.error(err);
  const h = hint(err);
  if (h) console.error(`\nHint: ${h}`);
  console.error("\nNothing was half-applied: each run is a single transaction.");
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
