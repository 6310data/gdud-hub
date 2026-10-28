/**
 * Previous names of soldiers: approved ניהול פלוגה name changes (company_profile_requests, field
 * full_name, status approved — old_value is the name before). The kesher and logistics imports
 * also match a sheet name by them, so a renamed soldier's rows still link, marked "לפי שם קודם".
 * Read through the caller's transaction: RLS shows the name history of the soldiers they see.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { Tx } from "../index";
import * as schema from "../schema/index";

const { companyProfileRequests: changes } = schema;

export interface PreviousName {
  personId: string;
  name: string;
}

export async function loadPreviousNames(tx: Tx): Promise<PreviousName[]> {
  const rows = await tx
    .select({ personId: changes.personId, name: changes.oldValue })
    .from(changes)
    .where(and(eq(changes.field, "full_name"), eq(changes.status, "approved"), isNotNull(changes.oldValue)));
  return rows.filter((r): r is PreviousName => Boolean(r.name));
}

export const previousNameMessage = (sheetName: string, nowName: string) => `לפי שם קודם: "${sheetName}" נקרא היום ${nowName}`;
