/**
 * One-time setup: creates the battalion root unit (if missing) and invites the
 * first super admin. Run locally with the migration connection string:
 *
 *   pnpm db:bootstrap-admin you@gmail.com "Your Name" "שם הגדוד"
 *
 * After this, sign in with that Google account and manage everyone else from /admin.
 */
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/schema/index";
import { loadRootEnv } from "./env";

loadRootEnv();

async function main() {
  const [emailArg, nameArg, battalionArg] = process.argv.slice(2);
  if (!emailArg) {
    console.error('Usage: pnpm db:bootstrap-admin <google-email> ["Display name"] ["Battalion name"]');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set MIGRATION_DATABASE_URL (or DATABASE_URL)");

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  try {
    const [root] = await db.select().from(schema.units).where(isNull(schema.units.parentId)).limit(1);
    if (!root) {
      const [created] = await db
        .insert(schema.units)
        .values({ kind: "battalion", name: battalionArg ?? "גדוד", code: "battalion" })
        .returning();
      console.log(`Created battalion unit "${created!.name}"`);
    }

    const [existing] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.email, email));
    if (existing) {
      await db
        .update(schema.appUsers)
        .set({ isSuperAdmin: true, active: true })
        .where(eq(schema.appUsers.id, existing.id));
      console.log(`${email} is now a super admin`);
    } else {
      await db
        .insert(schema.appUsers)
        .values({ email, displayName: nameArg ?? null, isSuperAdmin: true });
      console.log(`Invited ${email} as super admin — sign in with Google to activate`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
