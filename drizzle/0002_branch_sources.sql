ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source_message_id text;
--> statement-breakpoint
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source_start integer;
--> statement-breakpoint
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source_end integer;
