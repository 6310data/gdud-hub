/**
 * Logistics (לוגיסטיקה גדודית) — ported from the Apps Script sheets:
 *
 *   'Dropdowns' (catalogue)   → logistics_items
 *   'תקן ציוד משלים'           → logistics_kit_items
 *   'טבלת צ'                  → logistics_serials        (condition only: ok / broken / brigade)
 *   'גדודי'                   → logistics_assignments    (returned_at null = currently signed)
 *   'אפסון'                   → logistics_storage        (released_at null = currently in storage)
 *   sign-out / holdings PDFs  → logistics_forms          (snapshot of the form, rendered as a printable page)
 *   'לוג'                     → logistics_events
 *
 * "חתום" is no longer a stored status: a serial is signed when it has an open assignment,
 * so the old "sync statuses" job is not needed. People and units are the shared core tables.
 *
 * Policies, grants and triggers: migrations/0003_logistics_security.sql.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { LOGISTICS_CONDITIONS, LOGISTICS_EVENT_KINDS, LOGISTICS_FORM_KINDS, type KitLine, type LogisticsFormData } from "@gdud/core";
import { people } from "./core";

export const logisticsCondition = pgEnum("logistics_condition", LOGISTICS_CONDITIONS);
export const logisticsFormKind = pgEnum("logistics_form_kind", LOGISTICS_FORM_KINDS);
export const logisticsEventKind = pgEnum("logistics_event_kind", LOGISTICS_EVENT_KINDS);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
/** The acting app user, filled by the database (RLS also checks it). */
const actor = (name: string) => uuid(name).default(sql`app.current_user_id()`);

/** Item types (catalogue), e.g. "M4 קצר". */
export const logisticsItems = pgTable(
  "logistics_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    category: text("category"),
    subcategory: text("subcategory"),
    sku: text("sku"),
    ...timestamps,
  },
  (t) => [check("logistics_items_name_len", sql`length(${t.name}) between 1 and 80`)],
).enableRLS();

/** Standard accessory kit of an item type — copied into every sign-out of that item. */
export const logisticsKitItems = pgTable(
  "logistics_kit_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => logisticsItems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    qty: integer("qty").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("logistics_kit_items_item_name").on(t.itemId, t.name),
    check("logistics_kit_items_qty", sql`${t.qty} between 1 and 99`),
  ],
).enableRLS();

/** One row per צ׳ (serial number). */
export const logisticsSerials = pgTable(
  "logistics_serials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => logisticsItems.id, { onDelete: "restrict" }),
    /** normalized: no spaces / hyphens (see normalizeSerial in @gdud/core) */
    serial: text("serial").notNull().unique(),
    /** the 'קטגוריה' column of the old serial table */
    category: text("category"),
    /** state while in the armory; irrelevant (kept) while signed out */
    condition: logisticsCondition("condition").notNull().default("ok"),
    ...timestamps,
  },
  (t) => [
    index("logistics_serials_item_idx").on(t.itemId),
    check("logistics_serials_format", sql`${t.serial} ~ '^[^[:space:]]{1,40}$'`),
  ],
).enableRLS();

/** A printed form: sign-out (טופס החתמה) or holdings (טופס ציוד חתום). Immutable snapshot. */
export const logisticsForms = pgTable(
  "logistics_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: logisticsFormKind("kind").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    data: jsonb("data").$type<LogisticsFormData>().notNull(),
    createdBy: actor("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("logistics_forms_person_idx").on(t.personId, t.createdAt)],
).enableRLS();

/** Who holds which serial. Returning closes the row (history is kept). */
export const logisticsAssignments = pgTable(
  "logistics_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serialId: uuid("serial_id")
      .notNull()
      .references(() => logisticsSerials.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    notes: text("notes"),
    kit: jsonb("kit").$type<KitLine[]>().notNull().default([]),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    signedBy: actor("signed_by"),
    /** the name typed in "מחתים" */
    signerName: text("signer_name"),
    formId: uuid("form_id").references(() => logisticsForms.id, { onDelete: "set null" }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedTo: logisticsCondition("returned_to"),
    returnNotes: text("return_notes"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("logistics_assignments_open_serial").on(t.serialId).where(sql`${t.returnedAt} is null`),
    index("logistics_assignments_person_idx").on(t.personId),
  ],
).enableRLS();

/** אפסון: an item kept for a soldier. It stays signed on them. */
export const logisticsStorage = pgTable(
  "logistics_storage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    /** null = an item without a serial (e.g. accessories) */
    serialId: uuid("serial_id").references(() => logisticsSerials.id, { onDelete: "cascade" }),
    itemName: text("item_name").notNull(),
    notes: text("notes"),
    storedAt: timestamp("stored_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("logistics_storage_open_serial")
      .on(t.serialId)
      .where(sql`${t.releasedAt} is null and ${t.serialId} is not null`),
    index("logistics_storage_person_idx").on(t.personId),
  ],
).enableRLS();

/**
 * Human-readable activity log (פעילות אחרונה / לוג פעולות). Names are copied in as text
 * so the log stays readable after serials or soldiers change.
 */
export const logisticsEvents = pgTable(
  "logistics_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: logisticsEventKind("kind").notNull(),
    actorUserId: actor("actor_user_id"),
    actorName: text("actor_name"),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    personName: text("person_name"),
    item: text("item"),
    serial: text("serial"),
    details: text("details"),
    formId: uuid("form_id").references(() => logisticsForms.id, { onDelete: "set null" }),
    /**
     * Rows imported from the old sheet's 'לוג' tab. actor_name is always the importer (trigger),
     * so the sheet's 'תפקיד' cell is kept here; `sheet_link` is its 'קישור' (a Drive PDF);
     * `sheet_key` identifies the row so a re-import never duplicates it.
     */
    sheetActor: text("sheet_actor"),
    sheetLink: text("sheet_link"),
    sheetKey: text("sheet_key"),
  },
  (t) => [
    index("logistics_events_at_idx").on(t.at),
    index("logistics_events_person_idx").on(t.personId),
    uniqueIndex("logistics_events_sheet_key").on(t.sheetKey).where(sql`${t.sheetKey} is not null`),
    check("logistics_events_sheet_link", sql`${t.sheetLink} is null or ${t.sheetLink} ~ '^https://'`),
  ],
).enableRLS();
