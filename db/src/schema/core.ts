/**
 * Core (shared) tables. Every department module references these instead of keeping
 * its own copy of people/units. Module-specific tables live in ./<module>.ts.
 *
 * RLS is enabled on every table here; the policies themselves are in
 * migrations/0001_security.sql (hand-written, reviewed SQL).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { MODULE_IDS, UNIT_KINDS } from "@gdud/core";

export const moduleId = pgEnum("module_id", MODULE_IDS);
export const unitKind = pgEnum("unit_kind", UNIT_KINDS);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** גדוד → פלוגה → מחלקה → צוות */
export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => units.id, { onDelete: "restrict" }),
    kind: unitKind("kind").notNull(),
    name: text("name").notNull(),
    /** short latin slug used in URLs, e.g. "plsr" */
    code: text("code").unique(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("units_parent_idx").on(t.parentId),
    check("units_code_format", sql`${t.code} ~ '^[a-z0-9-]{1,32}$'`),
    check("units_color_format", sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
    check("units_no_self_parent", sql`${t.parentId} <> ${t.id}`),
  ],
).enableRLS();

/** Every soldier in the battalion — one row per person, shared by all modules. */
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** lowest known unit (מחלקה if known, else פלוגה) */
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    fullName: text("full_name").notNull(),
    /** מס׳ אישי — optional on purpose: store it only where a module really needs it */
    personalNumber: text("personal_number").unique(),
    phone: text("phone"),
    roleTitle: text("role_title"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("people_unit_idx").on(t.unitId), index("people_name_idx").on(t.fullName)],
).enableRLS();

/**
 * Who may sign in. Invite-only: an admin adds the email first; the Google account
 * with that (verified) email is linked on first sign-in.
 */
export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    /** auth.users.id — set on first successful sign-in */
    authUserId: uuid("auth_user_id").unique(),
    displayName: text("display_name"),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [check("app_users_email_lower", sql`${t.email} = lower(${t.email})`)],
).enableRLS();

/** A role in one module, optionally limited to a unit subtree (null = whole battalion). */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    module: moduleId("module").notNull(),
    role: text("role").notNull(),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    unique("memberships_user_module_unit").on(t.userId, t.module, t.unitId).nullsNotDistinct(),
    index("memberships_user_idx").on(t.userId),
  ],
).enableRLS();

/** Append-only change history, written by database triggers (not by app code). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    tableName: text("table_name").notNull(),
    rowId: text("row_id"),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_row_idx").on(t.tableName, t.rowId)],
).enableRLS();
