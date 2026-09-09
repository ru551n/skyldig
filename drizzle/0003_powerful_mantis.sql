CREATE TABLE "session_invites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"session_id" bigint NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_by_browser_session_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_browser_session_id" bigint,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "session_invites_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "session_invites_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "session_invites_role_check" CHECK ("session_invites"."role" in ('member', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "session_invites" ADD CONSTRAINT "session_invites_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_invites" ADD CONSTRAINT "session_invites_created_by_browser_session_id_browser_sessions_id_fk" FOREIGN KEY ("created_by_browser_session_id") REFERENCES "public"."browser_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_invites" ADD CONSTRAINT "session_invites_used_by_browser_session_id_browser_sessions_id_fk" FOREIGN KEY ("used_by_browser_session_id") REFERENCES "public"."browser_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_invites_session_id_idx" ON "session_invites" USING btree ("session_id");