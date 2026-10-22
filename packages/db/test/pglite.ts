/**
 * In-memory Postgres (PGlite) with the real migrations and a small unit tree, shared by the
 * logistics import tests.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/schema/index";
import { SUPABASE_SHIM_SQL } from "./supabase-shim";

const here = path.dirname(fileURLToPath(import.meta.url));
const { units } = schema;

export type PgliteDb = ReturnType<typeof drizzle<typeof schema>>;
export interface TestIds {
  bat: string;
  plsr: string;
  plsr1: string;
  plnt: string;
}

/** A battalion with two companies (פלס״ר, פלנ״ט) and one platoon (פלס״ר / מחלקה 1). */
export async function createTestDb(): Promise<{ db: PgliteDb; ids: TestIds }> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_SHIM_SQL);
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(here, "../migrations") });

  const [bat] = await db.insert(units).values({ kind: "battalion", name: "גדוד" }).returning();
  const [plsr, plnt] = await db
    .insert(units)
    .values([
      { parentId: bat!.id, kind: "company", name: "פלס״ר", code: "plsr" },
      { parentId: bat!.id, kind: "company", name: "פלנ״ט", code: "plnt" },
    ])
    .returning();
  const [plsr1] = await db.insert(units).values({ parentId: plsr!.id, kind: "platoon", name: "מחלקה 1" }).returning();
  return { db, ids: { bat: bat!.id, plsr: plsr!.id, plsr1: plsr1!.id, plnt: plnt!.id } };
}
