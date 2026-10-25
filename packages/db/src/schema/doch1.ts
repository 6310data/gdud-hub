/**
 * דוח 1 — the daily personnel report, ported from the Google Sheet "דוח 1 - סבב <n>"
 * (layout: references/doch1/sheet-structure.md):
 *
 *   one sheet per round (סבב)                → doch1_rounds           (one active at a time)
 *   'Dropdowns' companies / company tabs     → doch1_round_companies  (+ the pilot switch app_from)
 *   status words + groups (Dropdowns G–K)    → doch1_statuses         (flags drive every count; versioned)
 *   a soldier's row in a company tab (A–L)   → doch1_members          (sheet_tab/sheet_row for copy-to-sheet)
 *   a day cell (M…BS)                        → doch1_days             (no row = missing report)
 *   import answers (tab/platoon/status)      → doch1_import_mappings
 *   push reminders                           → doch1_push_subscriptions, doch1_reminder_requests, doch1_reminder_log
 *   brigade WhatsApp text copies             → doch1_brigade_log
 *   שבצ״ק מיקום (E)                          → doch1_locations + doch1_members.location_id
 *   שבצ״ק כוננות (G) + שיבוץ כלים (צ כלי, F) → doch1_standby_types / _teams / _holders / _members,
 *                                              doch1_vehicles (battalion-wide, not per round)
 *
 * No status, location or group name lives in code: counts read the flags of doch1_statuses.
 * People and units are the shared core tables. Policies, grants, the lock guard and triggers:
 * migrations/0005_doch1_security.sql.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { appUsers, people, units } from "./core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
/** The acting app user, filled by the database (RLS also checks it). */
const actor = (name: string) => uuid(name).default(sql`app.current_user_id()`);
const day = (name: string) => date(name, { mode: "string" });

/** A round (סבב). Times are Israel wall-clock times. */
export const doch1Rounds = pgTable(
  "doch1_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    startsOn: day("starts_on").notNull(),
    endsOn: day("ends_on").notNull(),
    /** יום גיוס — the sheet counts presence from it */
    callUpOn: day("call_up_on"),
    reminderAt: time("reminder_at").notNull().default("09:00"),
    lockAt: time("lock_at").notNull().default("10:00"),
    sendAt: time("send_at").notNull().default("10:15"),
    active: boolean("active").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check("doch1_rounds_dates", sql`${t.endsOn} >= ${t.startsOn}`),
    check("doch1_rounds_name_len", sql`length(${t.name}) between 1 and 40`),
    uniqueIndex("doch1_rounds_one_active").on(t.active).where(sql`${t.active}`),
  ],
).enableRLS();

/** Companies taking part in a round. `app_from` = "reported in the app from" (the pilot switch). */
export const doch1RoundCompanies = pgTable(
  "doch1_round_companies",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    appFrom: day("app_from"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.roundId, t.unitId] })],
).enableRLS();

/**
 * Status words of a round. A status whose flags change after it was used gets a new row
 * (`replaces_id` → the old one, old row inactive), so past days keep the flags they had.
 */
export const doch1Statuses = pgTable(
  "doch1_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    displayGroup: text("display_group").notNull(),
    /** the value written to / read from the sheet's day cells, e.g. "0" */
    sheetValue: text("sheet_value").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    countsInSadak: boolean("counts_in_sadak").notNull().default(false),
    countsAsPresent: boolean("counts_as_present").notNull().default(false),
    homeDay: boolean("home_day").notNull().default(false),
    orgDay: boolean("org_day").notNull().default(false),
    generalDay: boolean("general_day").notNull().default(false),
    offDuty: boolean("off_duty").notNull().default(false),
    acrossBorder: boolean("across_border").notNull().default(false),
    needsOutpost: boolean("needs_outpost").notNull().default(false),
    /** a soldier in this status counts as available for standby (שבצ״ק readiness); not versioned — only today matters */
    standbyAvailable: boolean("standby_available").notNull().default(false),
    active: boolean("active").notNull().default(true),
    replacesId: uuid("replaces_id").references((): AnyPgColumn => doch1Statuses.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("doch1_statuses_round_name").on(t.roundId, t.name).where(sql`${t.active}`),
    uniqueIndex("doch1_statuses_round_sheet_value").on(t.roundId, t.sheetValue).where(sql`${t.active}`),
    check("doch1_statuses_color_format", sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
    check("doch1_statuses_sadak_or_off", sql`not (${t.countsInSadak} and ${t.offDuty})`),
    check("doch1_statuses_text_len", sql`length(${t.name}) between 1 and 30 and length(${t.displayGroup}) between 1 and 30 and length(${t.sheetValue}) between 1 and 30`),
  ],
).enableRLS();

/** A soldier in a round (the row of a company tab, columns A–L, minus the shared people fields). */
export const doch1Members = pgTable(
  "doch1_members",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    /** counted in the daily report (false = released / deferred, not expected) */
    inReport: boolean("in_report").notNull().default(true),
    dmhCategory: text("dmh_category"),
    arrivalForecast: text("arrival_forecast"),
    callUpOn: day("call_up_on"),
    enlistmentStatus: text("enlistment_status"),
    hasDisc: boolean("has_disc"),
    notes: text("notes"),
    /** the company tab and row this soldier sits on in the sheet (copy-to-sheet order) */
    sheetTab: text("sheet_tab"),
    sheetRow: integer("sheet_row"),
    /** מיקום בשבצ״ק (outpost / camp / outside); null = not in the שבצ״ק */
    locationId: uuid("location_id").references((): AnyPgColumn => doch1Locations.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.personId] }),
    check("doch1_members_sheet_row", sql`${t.sheetRow} > 0`),
    index("doch1_members_person_idx").on(t.personId),
  ],
).enableRLS();

/** A soldier's status on a day. No row = no report. A future day = the plan. */
export const doch1Days = pgTable(
  "doch1_days",
  {
    roundId: uuid("round_id").notNull(),
    personId: uuid("person_id").notNull(),
    day: day("day").notNull(),
    statusId: uuid("status_id")
      .notNull()
      .references(() => doch1Statuses.id, { onDelete: "restrict" }),
    updatedBy: actor("updated_by"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.day] }),
    foreignKey({ name: "doch1_days_member_fk", columns: [t.roundId, t.personId], foreignColumns: [doch1Members.roundId, doch1Members.personId] }).onDelete("cascade"),
    index("doch1_days_round_day_idx").on(t.roundId, t.day),
  ],
).enableRLS();

/** A browser/phone that accepts push reminders for a user. */
export const doch1PushSubscriptions = pgTable(
  "doch1_push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => appUsers.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("doch1_push_subscriptions_https", sql`${t.endpoint} like 'https://%'`),
    index("doch1_push_subscriptions_user_idx").on(t.userId),
  ],
).enableRLS();

/** "Send a reminder to this company now" from the overview; picked up by the cron job. */
export const doch1ReminderRequests = pgTable(
  "doch1_reminder_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    requestedBy: actor("requested_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("doch1_reminder_requests_open_idx").on(t.processedAt)],
).enableRLS();

/** Every reminder sent. The partial unique index makes the daily reminder once per user per day. */
export const doch1ReminderLog = pgTable(
  "doch1_reminder_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    day: day("day").notNull(),
    kind: text("kind").notNull(),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => appUsers.id, { onDelete: "cascade" }),
    missing: integer("missing").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("doch1_reminder_log_kind", sql`${t.kind} in ('daily', 'request')`),
    uniqueIndex("doch1_reminder_log_daily_once").on(t.roundId, t.day, t.userId).where(sql`${t.kind} = 'daily'`),
  ],
).enableRLS();

/** Every copy/share of the brigade report text. */
export const doch1BrigadeLog = pgTable(
  "doch1_brigade_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    day: day("day").notNull(),
    partial: boolean("partial").notNull(),
    content: text("content").notNull(),
    sentBy: actor("sent_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("doch1_brigade_log_content_len", sql`length(${t.content}) <= 20000`),
    index("doch1_brigade_log_round_day_idx").on(t.roundId, t.day),
  ],
).enableRLS();

/** Remembered import answers: sheet tab → company, platoon text → unit, sheet value → status, שבצ״ק מיקום → location. */
export const doch1ImportMappings = pgTable(
  "doch1_import_mappings",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** canonical key (see canonicalName in @gdud/core) */
    sourceKey: text("source_key").notNull(),
    /** null = ignore */
    targetId: uuid("target_id"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.kind, t.sourceKey] }),
    check("doch1_import_mappings_kind", sql`${t.kind} in ('company', 'platoon', 'status', 'location')`),
  ],
).enableRLS();

/** Places of the שבצ״ק (מוצב 131, מחנה מיוערת, בחוץ…). `kind` drives the data checks (an outpost needs an outpost status). */
export const doch1Locations = pgTable(
  "doch1_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("doch1_locations_round_name").on(t.roundId, t.name),
    check("doch1_locations_kind", sql`${t.kind} in ('outpost', 'camp', 'outside')`),
    check("doch1_locations_name_len", sql`length(${t.name}) between 1 and 30`),
  ],
).enableRLS();

/** The vehicle registry (צ׳ רכב). Battalion-wide: a vehicle outlives a round. */
export const doch1Vehicles = pgTable(
  "doch1_vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(),
    kind: text("kind"),
    state: text("state").notNull().default("ok"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check("doch1_vehicles_state", sql`${t.state} in ('ok', 'service', 'broken')`),
    check("doch1_vehicles_number", sql`${t.number} ~ '^[0-9A-Za-z-]{1,20}$'`),
    check("doch1_vehicles_text_len", sql`length(coalesce(${t.kind}, '')) <= 30 and length(coalesce(${t.notes}, '')) <= 200`),
  ],
).enableRLS();

/** A kind of standby (חפ״ק מג״ד, עתודת גדוד, כרמל…): its size and the roles it must have. */
export const doch1StandbyTypes = pgTable(
  "doch1_standby_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    level: text("level").notNull().default("company"),
    /** soldiers needed; null = the team's own member count */
    size: integer("size"),
    /** each entry is one role; "מ״פ / סמ״פ" = either one */
    requiredRoles: text("required_roles").array().notNull().default(sql`'{}'::text[]`),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("doch1_standby_types_round_name").on(t.roundId, t.name),
    check("doch1_standby_types_level", sql`${t.level} in ('battalion', 'company')`),
    check("doch1_standby_types_size", sql`${t.size} between 1 and 50`),
    check("doch1_standby_types_text_len", sql`length(${t.name}) between 1 and 30 and cardinality(${t.requiredRoles}) <= 10`),
  ],
).enableRLS();

/** A standby team of a round. Who edits it: the battalion admin and the company users of its holding companies. */
export const doch1StandbyTeams = pgTable(
  "doch1_standby_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => doch1Rounds.id, { onDelete: "cascade" }),
    typeId: uuid("type_id").references(() => doch1StandbyTypes.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    locationId: uuid("location_id").references(() => doch1Locations.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => doch1Vehicles.id, { onDelete: "set null" }),
    /** an inactive team is not counted in the standby */
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("doch1_standby_teams_id_round").on(t.id, t.roundId),
    index("doch1_standby_teams_round_idx").on(t.roundId),
    check("doch1_standby_teams_name_len", sql`length(${t.name}) between 1 and 40`),
  ],
).enableRLS();

/** The companies holding a team (פינוי א: אגם + מסייעת). */
export const doch1StandbyHolders = pgTable(
  "doch1_standby_holders",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => doch1StandbyTeams.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.unitId] }), index("doch1_standby_holders_unit_idx").on(t.unitId)],
).enableRLS();

/** A soldier on a standby team, with their role in it. One team per soldier per round (the sheet's כוננות column). */
export const doch1StandbyMembers = pgTable(
  "doch1_standby_members",
  {
    roundId: uuid("round_id").notNull(),
    teamId: uuid("team_id").notNull(),
    personId: uuid("person_id").notNull(),
    role: text("role"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.personId] }),
    uniqueIndex("doch1_standby_members_one_team").on(t.roundId, t.personId),
    foreignKey({ name: "doch1_standby_members_team_fk", columns: [t.teamId, t.roundId], foreignColumns: [doch1StandbyTeams.id, doch1StandbyTeams.roundId] }).onDelete("cascade"),
    foreignKey({ name: "doch1_standby_members_member_fk", columns: [t.roundId, t.personId], foreignColumns: [doch1Members.roundId, doch1Members.personId] }).onDelete("cascade"),
    check("doch1_standby_members_role_len", sql`length(coalesce(${t.role}, '')) <= 30`),
  ],
).enableRLS();
