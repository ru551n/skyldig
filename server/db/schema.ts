import {
  bigint,
  bigserial,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { bytea } from "./custom-types.ts";

export const currencies = pgTable(
  "currencies",
  {
    code: text("code").primaryKey(),
    decimals: smallint("decimals").notNull(),
    nameSv: text("name_sv").notNull(),
  },
  (t) => [check("currencies_decimals_check", sql`${t.decimals} between 0 and 3`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    publicId: text("public_id").notNull(),
    name: text("name").notNull(),
    baseCurrency: text("base_currency")
      .notNull()
      .references(() => currencies.code),
    accessKeyIndex: bytea("access_key_index").notNull(),
    accessKeyVerifier: text("access_key_verifier").notNull(),
    adminKeyHash: bytea("admin_key_hash").notNull(),
    pepperVersion: smallint("pepper_version").notNull(),
    /**
     * Bumped on every access-phrase rotation. Invites are stamped with the generation they
     * were created under and are only redeemable while it still matches, so rotating the
     * phrase revokes every outstanding invite in the same transaction (docs/architecture.md
     * §4.3) — without it, an invite link issued before a rotation stayed a valid back door.
     */
    accessGeneration: integer("access_generation").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("sessions_public_id_key").on(t.publicId),
    unique("sessions_access_key_index_key").on(t.accessKeyIndex),
    unique("sessions_id_base_currency_key").on(t.id, t.baseCurrency),
    check("sessions_name_length_check", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    publicId: text("public_id").notNull(),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    position: integer("position").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("participants_public_id_key").on(t.publicId),
    unique("participants_session_id_normalized_name_key").on(t.sessionId, t.normalizedName),
    unique("participants_session_id_position_key").on(t.sessionId, t.position),
    unique("participants_id_session_id_key").on(t.id, t.sessionId),
    index("participants_session_id_idx").on(t.sessionId),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    publicId: text("public_id").notNull(),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currencies.code),
    baseCurrencyCode: text("base_currency_code").notNull(),
    rateText: varchar("rate_text", { length: 32 }),
    rateDirection: text("rate_direction"),
    rateNum: bigint("rate_num", { mode: "bigint" }),
    rateDen: bigint("rate_den", { mode: "bigint" }),
    baseAmountMinor: bigint("base_amount_minor", { mode: "bigint" }).notNull(),
    splitMode: text("split_mode").notNull().default("equal"),
    payerId: bigint("payer_id", { mode: "bigint" }).notNull(),
    expenseDate: date("expense_date").notNull(),
    note: text("note"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("expenses_public_id_key").on(t.publicId),
    unique("expenses_id_session_id_key").on(t.id, t.sessionId),
    index("expenses_session_id_idx").on(t.sessionId),
    foreignKey({
      columns: [t.sessionId, t.baseCurrencyCode],
      foreignColumns: [sessions.id, sessions.baseCurrency],
      name: "expenses_session_base_currency_fk",
    }),
    foreignKey({
      columns: [t.payerId, t.sessionId],
      foreignColumns: [participants.id, participants.sessionId],
      name: "expenses_payer_fk",
    }).onDelete("restrict"),
    check("expenses_amount_minor_check", sql`${t.amountMinor} > 0 and ${t.amountMinor} <= 1000000000000000`),
    check("expenses_base_amount_minor_check", sql`${t.baseAmountMinor} > 0 and ${t.baseAmountMinor} <= 1000000000000000`),
    check("expenses_rate_direction_check", sql`${t.rateDirection} is null or ${t.rateDirection} in ('base_per_unit', 'units_per_base')`),
    check("expenses_split_mode_check", sql`${t.splitMode} in ('equal')`),
    check(
      "expenses_rate_consistency_check",
      sql`(${t.currencyCode} = ${t.baseCurrencyCode} and ${t.rateNum} is null and ${t.rateDen} is null and ${t.baseAmountMinor} = ${t.amountMinor}) or (${t.currencyCode} <> ${t.baseCurrencyCode} and ${t.rateNum} is not null and ${t.rateDen} is not null and ${t.rateNum} > 0 and ${t.rateDen} > 0 and ${t.rateNum} <= 1000000000000000 and ${t.rateDen} <= 1000000000000000)`,
    ),
  ],
);

export const expenseParticipants = pgTable(
  "expense_participants",
  {
    expenseId: bigint("expense_id", { mode: "bigint" }).notNull(),
    sessionId: bigint("session_id", { mode: "bigint" }).notNull(),
    participantId: bigint("participant_id", { mode: "bigint" }).notNull(),
    weightScaled: bigint("weight_scaled", { mode: "bigint" })
      .notNull()
      .default(sql`1000000`),
    shareBaseMinor: bigint("share_base_minor", { mode: "bigint" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.participantId], name: "expense_participants_pk" }),
    index("expense_participants_session_id_idx").on(t.sessionId),
    foreignKey({
      columns: [t.expenseId, t.sessionId],
      foreignColumns: [expenses.id, expenses.sessionId],
      name: "expense_participants_expense_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.participantId, t.sessionId],
      foreignColumns: [participants.id, participants.sessionId],
      name: "expense_participants_participant_fk",
    }).onDelete("restrict"),
    check("expense_participants_weight_scaled_check", sql`${t.weightScaled} > 0`),
    check("expense_participants_share_base_minor_check", sql`${t.shareBaseMinor} >= 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    publicId: text("public_id").notNull(),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currencies.code),
    baseCurrencyCode: text("base_currency_code").notNull(),
    rateText: varchar("rate_text", { length: 32 }),
    rateDirection: text("rate_direction"),
    rateNum: bigint("rate_num", { mode: "bigint" }),
    rateDen: bigint("rate_den", { mode: "bigint" }),
    baseAmountMinor: bigint("base_amount_minor", { mode: "bigint" }).notNull(),
    payerId: bigint("payer_id", { mode: "bigint" }).notNull(),
    recipientId: bigint("recipient_id", { mode: "bigint" }).notNull(),
    paymentDate: date("payment_date").notNull(),
    note: text("note"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payments_public_id_key").on(t.publicId),
    unique("payments_id_session_id_key").on(t.id, t.sessionId),
    index("payments_session_id_idx").on(t.sessionId),
    foreignKey({
      columns: [t.sessionId, t.baseCurrencyCode],
      foreignColumns: [sessions.id, sessions.baseCurrency],
      name: "payments_session_base_currency_fk",
    }),
    foreignKey({
      columns: [t.payerId, t.sessionId],
      foreignColumns: [participants.id, participants.sessionId],
      name: "payments_payer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.recipientId, t.sessionId],
      foreignColumns: [participants.id, participants.sessionId],
      name: "payments_recipient_fk",
    }).onDelete("restrict"),
    check("payments_amount_minor_check", sql`${t.amountMinor} > 0 and ${t.amountMinor} <= 1000000000000000`),
    check("payments_base_amount_minor_check", sql`${t.baseAmountMinor} > 0 and ${t.baseAmountMinor} <= 1000000000000000`),
    check("payments_rate_direction_check", sql`${t.rateDirection} is null or ${t.rateDirection} in ('base_per_unit', 'units_per_base')`),
    check("payments_payer_recipient_check", sql`${t.payerId} <> ${t.recipientId}`),
    check(
      "payments_rate_consistency_check",
      sql`(${t.currencyCode} = ${t.baseCurrencyCode} and ${t.rateNum} is null and ${t.rateDen} is null and ${t.baseAmountMinor} = ${t.amountMinor}) or (${t.currencyCode} <> ${t.baseCurrencyCode} and ${t.rateNum} is not null and ${t.rateDen} is not null and ${t.rateNum} > 0 and ${t.rateDen} > 0 and ${t.rateNum} <= 1000000000000000 and ${t.rateDen} <= 1000000000000000)`,
    ),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: bigint("entity_id", { mode: "bigint" }).notNull(),
    revisionNo: integer("revision_no").notNull(),
    action: text("action").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("revisions_entity_revision_key").on(t.entityType, t.entityId, t.revisionNo),
    index("revisions_session_created_idx").on(t.sessionId, t.createdAt.desc()),
    index("revisions_entity_idx").on(t.entityType, t.entityId),
    check("revisions_entity_type_check", sql`${t.entityType} in ('expense', 'payment', 'participant')`),
    check("revisions_action_check", sql`${t.action} in ('created', 'updated', 'deleted')`),
    check("revisions_revision_no_check", sql`${t.revisionNo} >= 1`),
  ],
);

export const browserSessions = pgTable("browser_sessions", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  tokenHash: bytea("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [unique("browser_sessions_token_hash_key").on(t.tokenHash)]);

export const sessionGrants = pgTable(
  "session_grants",
  {
    browserSessionId: bigint("browser_session_id", { mode: "bigint" })
      .notNull()
      .references(() => browserSessions.id, { onDelete: "cascade" }),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    /**
     * When the 'admin' role stops being effective. Set on every elevation (now + TTL); a grant
     * with role 'admin' whose admin_until is NULL or not in the future is treated as a plain
     * member by `isActiveAdmin` — the row (membership) is kept. NULL only occurs on rows
     * elevated before this column existed.
     */
    adminUntil: timestamp("admin_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.browserSessionId, t.sessionId], name: "session_grants_pk" }),
    index("session_grants_session_id_idx").on(t.sessionId),
    check("session_grants_role_check", sql`${t.role} in ('member', 'admin')`),
  ],
);

/**
 * A single-use link/QR invite for a session. The bearer phrase itself never travels in a
 * URL (docs/architecture.md §4, docs/todo.md "Share a group by QR code or link"); an invite
 * is a separate, short-lived, revocable credential that grants the same role a phrase join
 * would. Only the hash of the token is stored, the same pattern as the access phrase.
 */
export const sessionInvites = pgTable(
  "session_invites",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    publicId: text("public_id").notNull(),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tokenHash: bytea("token_hash").notNull(),
    role: text("role").notNull().default("member"),
    /** `sessions.access_generation` at creation; redemption requires it to still match. */
    accessGeneration: integer("access_generation").notNull().default(1),
    createdByBrowserSessionId: bigint("created_by_browser_session_id", { mode: "bigint" })
      .notNull()
      .references(() => browserSessions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedByBrowserSessionId: bigint("used_by_browser_session_id", { mode: "bigint" }).references(
      () => browserSessions.id,
      { onDelete: "set null" },
    ),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    unique("session_invites_public_id_key").on(t.publicId),
    unique("session_invites_token_hash_key").on(t.tokenHash),
    index("session_invites_session_id_idx").on(t.sessionId),
    check("session_invites_role_check", sql`${t.role} in ('member', 'admin')`),
  ],
);
