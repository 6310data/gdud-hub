/**
 * מחלקת קשר — ported from the Google Sheet "פיזור ושליטה מחלקת קשר" and its Apps Script site:
 *
 *   'פיזור צ כללי'            → kesher_items (serial) + kesher_serials + signer columns of kesher_holders
 *   each company tab (E:I)    → holder columns of kesher_holders
 *   'כללי'                    → kesher_items (bulk) + kesher_stock
 *   'תקן ציוד משלים'           → kesher_kit_items
 *   'יומן חתימות'             → kesher_events
 *   'דוחות צ׳' / 'בדיקות צ׳'  → kesher_checks / kesher_check_lines
 *
 * Soldiers are `people` rows and companies are `units` rows (kind company) — never copied.
 * Policies, grants and triggers: migrations/0018_kesher_security.sql.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { KESHER_EVENT_KINDS, KESHER_ITEM_KINDS, KESHER_LOCATIONS } from "@gdud/core";
import { people, units } from "./core";

export const kesherItemKind = pgEnum("kesher_item_kind", KESHER_ITEM_KINDS);
export const kesherLocation = pgEnum("kesher_location", KESHER_LOCATIONS);
export const kesherEventKind = pgEnum("kesher_event_kind", KESHER_EVENT_KINDS);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
/** The acting app user, filled by the database (RLS also checks it). */
const actor = (name: string) => uuid(name).default(sql`app.current_user_id()`);

/** The catalogue: device types (710, אולר …) are `serial`; ציוד משלים is `bulk`. */
export const kesherItems = pgTable(
  "kesher_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    kind: kesherItemKind("kind").notNull(),
    category: text("category"),
    /** מלאי קבלות חטיבה — bulk items only */
    brigadeQty: integer("brigade_qty"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check("kesher_items_name_len", sql`length(${t.name}) between 1 and 80`),
    check("kesher_items_brigade_qty", sql`${t.brigadeQty} is null or (${t.kind} = 'bulk' and ${t.brigadeQty} >= 0)`),
  ],
).enableRLS();

/** תקן: the ציוד משלים that goes with each unit of a parent item. Children are bulk; no cycles (trigger). */
export const kesherKitItems = pgTable(
  "kesher_kit_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentItemId: uuid("parent_item_id")
      .notNull()
      .references(() => kesherItems.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => kesherItems.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("kesher_kit_items_parent_item").on(t.parentItemId, t.itemId),
    check("kesher_kit_items_qty", sql`${t.qty} between 1 and 99`),
    check("kesher_kit_items_not_self", sql`${t.parentItemId} <> ${t.itemId}`),
  ],
).enableRLS();

/** One row per צ׳. Its location: the warehouse, a company (unit_id), or none. */
export const kesherSerials = pgTable(
  "kesher_serials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => kesherItems.id, { onDelete: "restrict" }),
    /** normalized (normalizeSerial in @gdud/core) */
    serial: text("serial").notNull().unique(),
    location: kesherLocation("location").notNull().default("warehouse"),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "restrict" }),
    /** the sheet's האמר column */
    vehicle: text("vehicle"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("kesher_serials_item_idx").on(t.itemId),
    index("kesher_serials_unit_idx").on(t.unitId),
    check("kesher_serials_format", sql`${t.serial} ~ '^[^[:space:]]{1,40}$'`),
    check("kesher_serials_company", sql`(${t.unitId} is not null) = (${t.location} = 'company')`),
    check("kesher_serials_text_len", sql`coalesce(length(${t.vehicle}), 0) <= 40 and coalesce(length(${t.notes}), 0) <= 500`),
  ],
).enableRLS();

/**
 * Who signed for a צ׳ that is on a company (חותם על הפלוגה) and who holds it inside the company
 * (מחזיק בתוך הפלוגה). One row per צ׳ on a company; unit_id is copied from the serial by trigger.
 */
export const kesherHolders = pgTable(
  "kesher_holders",
  {
    serialId: uuid("serial_id")
      .primaryKey()
      .references(() => kesherSerials.id, { onDelete: "cascade" }),
    /** always the serial's company: the kesher_holders_guard trigger overwrites what the caller sends */
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    /** null only for rows imported before דוח 1 had the soldier */
    signerPersonId: uuid("signer_person_id").references(() => people.id, { onDelete: "restrict" }),
    signerRole: text("signer_role"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    signedBy: actor("signed_by"),
    holderPersonId: uuid("holder_person_id").references(() => people.id, { onDelete: "restrict" }),
    holderRole: text("holder_role"),
    frame: text("frame"),
    ...timestamps,
  },
  (t) => [
    index("kesher_holders_unit_idx").on(t.unitId),
    index("kesher_holders_signer_idx").on(t.signerPersonId),
    index("kesher_holders_holder_idx").on(t.holderPersonId),
    check(
      "kesher_holders_text_len",
      sql`coalesce(length(${t.signerRole}), 0) <= 40 and coalesce(length(${t.holderRole}), 0) <= 40 and coalesce(length(${t.frame}), 0) <= 40`,
    ),
  ],
).enableRLS();

/** ציוד משלים quantities per place; unit_id null = the warehouse. No row = 0. */
export const kesherStock = pgTable(
  "kesher_stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => kesherItems.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("kesher_stock_item_unit").on(t.itemId, t.unitId).nullsNotDistinct(),
    check("kesher_stock_company_qty", sql`${t.unitId} is null or ${t.qty} >= 0`),
  ],
).enableRLS();

/** A דוח צ׳ (a company's visual check). Append-only. */
export const kesherChecks = pgTable(
  "kesher_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** null for rows imported from the sheet */
    byUser: actor("by_user"),
    /** from app_users by trigger; imported rows keep the sheet's reporter text */
    reporterName: text("reporter_name"),
    total: integer("total").notNull(),
    found: integer("found").notNull(),
    note: text("note"),
    /** set by the notification job only (imported rows: by trigger) */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    sheetKey: text("sheet_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kesher_checks_unit_at_idx").on(t.unitId, t.at),
    uniqueIndex("kesher_checks_sheet_key").on(t.sheetKey).where(sql`${t.sheetKey} is not null`),
    check("kesher_checks_counts", sql`${t.total} >= 0 and ${t.found} between 0 and ${t.total}`),
    check("kesher_checks_text_len", sql`coalesce(length(${t.note}), 0) <= 1000 and coalesce(length(${t.reporterName}), 0) <= 120`),
  ],
).enableRLS();

/** One line per צ׳ of a דוח צ׳. Text copies keep the report readable after a צ׳ is removed. */
export const kesherCheckLines = pgTable(
  "kesher_check_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => kesherChecks.id, { onDelete: "cascade" }),
    serialId: uuid("serial_id").references(() => kesherSerials.id, { onDelete: "set null" }),
    serial: text("serial").notNull(),
    item: text("item"),
    found: boolean("found").notNull(),
  },
  (t) => [
    index("kesher_check_lines_serial_idx").on(t.serialId, t.checkId),
    unique("kesher_check_lines_check_serial").on(t.checkId, t.serial),
  ],
).enableRLS();

/**
 * The יומן. Append-only; one row per צ׳ and per ציוד משלים line, like the sheet's log.
 * Names are copied in as text so the log stays readable after soldiers or serials change.
 */
export const kesherEvents = pgTable(
  "kesher_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: kesherEventKind("kind").notNull(),
    actorUserId: actor("actor_user_id"),
    actorName: text("actor_name"),
    /** the company the row is about; null = warehouse / catalogue */
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "set null" }),
    company: text("company"),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    personName: text("person_name"),
    personRole: text("person_role"),
    item: text("item"),
    serial: text("serial"),
    qty: integer("qty"),
    details: text("details"),
    backdated: boolean("backdated").notNull().default(false),
    /** imported rows: the old log's typed "מחתים" (actor_name is the importer) */
    sheetActor: text("sheet_actor"),
    /** identifies an imported row so a re-import never duplicates it */
    sheetKey: text("sheet_key"),
  },
  (t) => [
    index("kesher_events_at_idx").on(t.at),
    index("kesher_events_unit_idx").on(t.unitId, t.at),
    index("kesher_events_serial_idx").on(t.serial),
    uniqueIndex("kesher_events_sheet_key").on(t.sheetKey).where(sql`${t.sheetKey} is not null`),
  ],
).enableRLS();

/** The module's settings: one row (id = 1). */
export const kesherSettings = pgTable(
  "kesher_settings",
  {
    id: integer("id").primaryKey().default(1),
    /** off = the old "מלאי חלקי": החתמה / זיכוי don't check or move the warehouse's ציוד משלים */
    warehouseTracked: boolean("warehouse_tracked").notNull().default(true),
    /** a דוח צ׳ older than this is "ישן" */
    checkStaleDays: integer("check_stale_days").notNull().default(7),
    ...timestamps,
  },
  (t) => [
    check("kesher_settings_single", sql`${t.id} = 1`),
    check("kesher_settings_stale_days", sql`${t.checkStaleDays} between 1 and 90`),
  ],
).enableRLS();
