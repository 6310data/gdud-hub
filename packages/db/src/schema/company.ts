/**
 * ניהול פלוגה (spec: docs/superpowers/specs/2026-10-28-company-design.md).
 *
 *   join screen (/join)          → company_join_requests, company_join_attempts (rate limit)
 *   אני → הפרטים שלי             → company_profile_requests (name / תפקיד; the phone is written directly)
 *
 * The module reads the departments' data (logistics, kesher, דוח 1) only through SECURITY DEFINER
 * functions that return the current user's own rows, and never writes it.
 * Policies, grants, functions and triggers: migrations/0027_company_security.sql.
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { COMPANY_REQUEST_STATUSES, PROFILE_FIELDS } from "@gdud/core";
import { appUsers, people, units } from "./core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
const status = () => text("status", { enum: COMPANY_REQUEST_STATUSES }).notNull().default("pending");
const statusCheck = (table: string, col: unknown) => check(`${table}_status`, sql`${col} in ('pending', 'approved', 'rejected', 'cancelled')`);

/**
 * A signed-in Google account asking to be linked to a soldier. Written only by app.request_join
 * (a match) and app.approve_join; a request that matched nothing leaves no row.
 */
export const companyJoinRequests = pgTable(
  "company_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** auth.users.id of the Google account */
    authUserId: uuid("auth_user_id").notNull(),
    email: text("email").notNull(),
    /** the Google profile name, so the commander knows who asked */
    displayName: text("display_name"),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** the soldier's unit, copied by trigger (for RLS) */
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    status: status(),
    decidedBy: uuid("decided_by").references(() => appUsers.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** set by the notification job only: the company admins were told about the request… */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** …and the soldier about the approval */
    decisionNotifiedAt: timestamp("decision_notified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("company_join_requests_one_open").on(t.authUserId).where(sql`${t.status} = 'pending'`),
    index("company_join_requests_unit_idx").on(t.unitId, t.status),
    statusCheck("company_join_requests", t.status),
    check("company_join_requests_text_len", sql`length(${t.email}) <= 320 and coalesce(length(${t.displayName}), 0) <= 120`),
  ],
).enableRLS();

/** Every join attempt (match or not), for the daily limit. No grants: app.request_join only. */
export const companyJoinAttempts = pgTable(
  "company_join_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: uuid("auth_user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("company_join_attempts_user_idx").on(t.authUserId, t.at)],
).enableRLS();

/**
 * A soldier's proposed new name or תפקיד, decided by a company admin (or the platoon commander).
 * Approved full_name rows keep the previous name in old_value: the kesher / logistics imports also
 * match by it.
 */
export const companyProfileRequests = pgTable(
  "company_profile_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** the soldier's unit, copied by trigger (for RLS) */
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    field: text("field", { enum: PROFILE_FIELDS }).notNull(),
    /** the value before the change (refreshed when the request is decided) */
    oldValue: text("old_value"),
    /** null = clear the field (תפקיד only) */
    newValue: text("new_value"),
    status: status(),
    requestedBy: uuid("requested_by").references(() => appUsers.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => appUsers.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** set by the notification job only: the approvers were told… */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** …and, for an approved name, the company's דוח 1 and kesher users */
    decisionNotifiedAt: timestamp("decision_notified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("company_profile_requests_one_open").on(t.personId, t.field).where(sql`${t.status} = 'pending'`),
    index("company_profile_requests_unit_idx").on(t.unitId, t.status),
    index("company_profile_requests_person_idx").on(t.personId, t.field, t.status),
    statusCheck("company_profile_requests", t.status),
    check("company_profile_requests_field", sql`${t.field} in ('full_name', 'role_title')`),
    check("company_profile_requests_text_len", sql`coalesce(length(${t.oldValue}), 0) <= 120 and coalesce(length(${t.newValue}), 0) <= 120`),
  ],
).enableRLS();
