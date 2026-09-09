ALTER TABLE "session_invites" ADD COLUMN "access_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "access_generation" integer DEFAULT 1 NOT NULL;