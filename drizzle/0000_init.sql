CREATE TABLE "browser_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "browser_sessions_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"decimals" smallint NOT NULL,
	"name_sv" text NOT NULL,
	CONSTRAINT "currencies_decimals_check" CHECK ("currencies"."decimals" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "expense_participants" (
	"expense_id" bigint NOT NULL,
	"session_id" bigint NOT NULL,
	"participant_id" bigint NOT NULL,
	"weight_scaled" bigint DEFAULT 1000000 NOT NULL,
	"share_base_minor" bigint NOT NULL,
	CONSTRAINT "expense_participants_pk" PRIMARY KEY("expense_id","participant_id"),
	CONSTRAINT "expense_participants_weight_scaled_check" CHECK ("expense_participants"."weight_scaled" > 0),
	CONSTRAINT "expense_participants_share_base_minor_check" CHECK ("expense_participants"."share_base_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"session_id" bigint NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"base_currency_code" text NOT NULL,
	"rate_text" varchar(32),
	"rate_direction" text,
	"rate_num" bigint,
	"rate_den" bigint,
	"base_amount_minor" bigint NOT NULL,
	"split_mode" text DEFAULT 'equal' NOT NULL,
	"payer_id" bigint NOT NULL,
	"expense_date" date NOT NULL,
	"note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "expenses_id_session_id_key" UNIQUE("id","session_id"),
	CONSTRAINT "expenses_amount_minor_check" CHECK ("expenses"."amount_minor" > 0 and "expenses"."amount_minor" <= 1000000000000000),
	CONSTRAINT "expenses_base_amount_minor_check" CHECK ("expenses"."base_amount_minor" > 0),
	CONSTRAINT "expenses_rate_direction_check" CHECK ("expenses"."rate_direction" is null or "expenses"."rate_direction" in ('base_per_unit', 'units_per_base')),
	CONSTRAINT "expenses_split_mode_check" CHECK ("expenses"."split_mode" in ('equal')),
	CONSTRAINT "expenses_rate_consistency_check" CHECK (("expenses"."currency_code" = "expenses"."base_currency_code" and "expenses"."rate_num" is null and "expenses"."rate_den" is null and "expenses"."base_amount_minor" = "expenses"."amount_minor") or ("expenses"."currency_code" <> "expenses"."base_currency_code" and "expenses"."rate_num" is not null and "expenses"."rate_den" is not null and "expenses"."rate_num" > 0 and "expenses"."rate_den" > 0))
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"session_id" bigint NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"position" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "participants_session_id_normalized_name_key" UNIQUE("session_id","normalized_name"),
	CONSTRAINT "participants_session_id_position_key" UNIQUE("session_id","position"),
	CONSTRAINT "participants_id_session_id_key" UNIQUE("id","session_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"session_id" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"base_currency_code" text NOT NULL,
	"rate_text" varchar(32),
	"rate_direction" text,
	"rate_num" bigint,
	"rate_den" bigint,
	"base_amount_minor" bigint NOT NULL,
	"payer_id" bigint NOT NULL,
	"recipient_id" bigint NOT NULL,
	"payment_date" date NOT NULL,
	"note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "payments_id_session_id_key" UNIQUE("id","session_id"),
	CONSTRAINT "payments_amount_minor_check" CHECK ("payments"."amount_minor" > 0 and "payments"."amount_minor" <= 1000000000000000),
	CONSTRAINT "payments_base_amount_minor_check" CHECK ("payments"."base_amount_minor" > 0),
	CONSTRAINT "payments_rate_direction_check" CHECK ("payments"."rate_direction" is null or "payments"."rate_direction" in ('base_per_unit', 'units_per_base')),
	CONSTRAINT "payments_payer_recipient_check" CHECK ("payments"."payer_id" <> "payments"."recipient_id"),
	CONSTRAINT "payments_rate_consistency_check" CHECK (("payments"."currency_code" = "payments"."base_currency_code" and "payments"."rate_num" is null and "payments"."rate_den" is null and "payments"."base_amount_minor" = "payments"."amount_minor") or ("payments"."currency_code" <> "payments"."base_currency_code" and "payments"."rate_num" is not null and "payments"."rate_den" is not null and "payments"."rate_num" > 0 and "payments"."rate_den" > 0))
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"revision_no" integer NOT NULL,
	"action" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revisions_entity_revision_key" UNIQUE("entity_type","entity_id","revision_no"),
	CONSTRAINT "revisions_entity_type_check" CHECK ("revisions"."entity_type" in ('expense', 'payment', 'participant')),
	CONSTRAINT "revisions_action_check" CHECK ("revisions"."action" in ('created', 'updated', 'deleted')),
	CONSTRAINT "revisions_revision_no_check" CHECK ("revisions"."revision_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "session_grants" (
	"browser_session_id" bigint NOT NULL,
	"session_id" bigint NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_grants_pk" PRIMARY KEY("browser_session_id","session_id"),
	CONSTRAINT "session_grants_role_check" CHECK ("session_grants"."role" in ('member', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"base_currency" text NOT NULL,
	"access_key_index" "bytea" NOT NULL,
	"access_key_verifier" text NOT NULL,
	"admin_key_hash" "bytea" NOT NULL,
	"pepper_version" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "sessions_access_key_index_key" UNIQUE("access_key_index"),
	CONSTRAINT "sessions_id_base_currency_key" UNIQUE("id","base_currency"),
	CONSTRAINT "sessions_name_length_check" CHECK (char_length("sessions"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "expense_participants" ADD CONSTRAINT "expense_participants_expense_fk" FOREIGN KEY ("expense_id","session_id") REFERENCES "public"."expenses"("id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_participants" ADD CONSTRAINT "expense_participants_participant_fk" FOREIGN KEY ("participant_id","session_id") REFERENCES "public"."participants"("id","session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_session_base_currency_fk" FOREIGN KEY ("session_id","base_currency_code") REFERENCES "public"."sessions"("id","base_currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payer_fk" FOREIGN KEY ("payer_id","session_id") REFERENCES "public"."participants"("id","session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_base_currency_fk" FOREIGN KEY ("session_id","base_currency_code") REFERENCES "public"."sessions"("id","base_currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_fk" FOREIGN KEY ("payer_id","session_id") REFERENCES "public"."participants"("id","session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recipient_fk" FOREIGN KEY ("recipient_id","session_id") REFERENCES "public"."participants"("id","session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_grants" ADD CONSTRAINT "session_grants_browser_session_id_browser_sessions_id_fk" FOREIGN KEY ("browser_session_id") REFERENCES "public"."browser_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_grants" ADD CONSTRAINT "session_grants_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_base_currency_currencies_code_fk" FOREIGN KEY ("base_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_participants_session_id_idx" ON "expense_participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "expenses_session_id_idx" ON "expenses" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "participants_session_id_idx" ON "participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "payments_session_id_idx" ON "payments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "revisions_session_created_idx" ON "revisions" USING btree ("session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "revisions_entity_idx" ON "revisions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "session_grants_session_id_idx" ON "session_grants" USING btree ("session_id");