/**
 * ניהול פלוגה (spec: docs/superpowers/specs/2026-10-28-company-design.md).
 *
 *   join screen (/join)          → company_join_requests, company_join_attempts (rate limit)
 *   אני → הפרטים שלי             → company_profile_requests (name / תפקיד; the phone is written directly)
 *   פריטי פלוגה                  → company_items
 *   החתמות (החתמה פנימית)        → company_signings (kesher צ׳ on the company + company items)
 *
 * The module reads the departments' data (logistics, kesher, דוח 1) only through SECURITY DEFINER
 * functions that return the current user's own rows, and never writes it.
 * Policies, grants, functions and triggers: migrations/0027_company_security.sql (join, אני) and
 * 0029_company_register_security.sql (the register).
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { COMPANY_REQUEST_STATUSES, PROFILE_FIELDS } from "@gdud/core";
import { appUsers, people, units } from "./core";
import { kesherSerials } from "./kesher";

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

/** The company's own things (tents, generators, cooking gear …): one unit with a צ׳, or a quantity. */
export const companyItems = pgTable(
  "company_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** the company (guard trigger: a unit of kind company) */
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    category: text("category"),
    /** normalized (normalizeSerial in @gdud/core); null = a quantity item */
    serial: text("serial"),
    /** how many the company has (1 for an item with a צ׳); never below what is signed out (guard) */
    quantity: integer("quantity").notNull().default(1),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("company_items_unit_serial").on(t.unitId, t.serial).where(sql`${t.serial} is not null`),
    index("company_items_unit_idx").on(t.unitId),
    check("company_items_serial_format", sql`${t.serial} is null or ${t.serial} ~ '^[^[:space:]]{1,40}$'`),
    check("company_items_quantity", sql`case when ${t.serial} is null then ${t.quantity} between 1 and 9999 else ${t.quantity} = 1 end`),
    check(
      "company_items_text_len",
      sql`length(${t.name}) between 1 and 80 and coalesce(length(${t.category}), 0) <= 40 and coalesce(length(${t.notes}), 0) <= 500`,
    ),
  ],
).enableRLS();

/**
 * החתמה פנימית — the company's register of who has a piece of gear now: a kesher צ׳ on the company,
 * or a company item (or a quantity of it). Open while returned_at is null. Written only by
 * app.company_sign / app.company_return; it never changes kesher or logistics records.
 */
export const companySignings = pgTable(
  "company_signings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** the company */
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    companyItemId: uuid("company_item_id").references(() => companyItems.id, { onDelete: "restrict" }),
    kesherSerialId: uuid("kesher_serial_id").references(() => kesherSerials.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(1),
    /** one piece (a kesher צ׳ or a company item with a צ׳): at most one open entry */
    single: boolean("single").notNull().default(true),
    /** where it was: null = the company (or the kesher צ׳'s usual place had nobody) */
    fromPersonId: uuid("from_person_id").references(() => people.id, { onDelete: "restrict" }),
    toPersonId: uuid("to_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    signedBy: uuid("signed_by").references(() => appUsers.id, { onDelete: "set null" }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedBy: uuid("returned_by").references(() => appUsers.id, { onDelete: "set null" }),
    /** set by the notification job only: the receiver was told */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("company_signings_open_kesher").on(t.kesherSerialId).where(sql`${t.returnedAt} is null and ${t.kesherSerialId} is not null`),
    uniqueIndex("company_signings_open_single_item").on(t.companyItemId).where(sql`${t.returnedAt} is null and ${t.single} and ${t.companyItemId} is not null`),
    index("company_signings_unit_idx").on(t.unitId, t.returnedAt),
    index("company_signings_to_idx").on(t.toPersonId),
    index("company_signings_from_idx").on(t.fromPersonId),
    check("company_signings_one_thing", sql`(${t.companyItemId} is null) <> (${t.kesherSerialId} is null)`),
    check("company_signings_quantity", sql`${t.quantity} between 1 and 9999 and (not ${t.single} or ${t.quantity} = 1)`),
  ],
).enableRLS();
