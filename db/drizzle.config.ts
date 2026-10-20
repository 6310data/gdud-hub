import { defineConfig } from "drizzle-kit";
import { loadRootEnv } from "./scripts/env";

loadRootEnv();

/**
 * Migrations are generated from src/schema and applied with `pnpm db:migrate`.
 * Use the Supabase *session* pooler (port 5432) or direct connection for migrations:
 * MIGRATION_DATABASE_URL in your local .env (never committed).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  strict: true,
  verbose: true,
});
