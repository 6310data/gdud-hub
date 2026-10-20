import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Load the repo-root .env / .env.local (if present) for CLI scripts.
 * Scripts run with cwd = packages/db (pnpm --filter), so the root is two levels up.
 * Next.js loads its own env files; this is only for drizzle-kit and tsx scripts.
 */
export function loadRootEnv() {
  for (const file of [".env", ".env.local"]) {
    const p = path.resolve(process.cwd(), "../..", file);
    if (existsSync(p)) process.loadEnvFile(p);
  }
}
