-- Migration 0001_add_conversation_soft_delete (drizzle/0001_soft_delete.sql)
-- First post-bootstrap migration (US-401, phase-4 spec §6).
-- All statements are idempotent so this applies cleanly to a fresh DB and to
-- an existing DB with phase-0..3 data (existing rows get deleted_at = NULL —
-- additive, no data loss, hard DELETE statements excluded by design).
--
-- Rollback path (fully additive; no data retained in the dropped columns):
--   DROP INDEX IF EXISTS conversations_deleted_batch_idx;
--   DROP INDEX IF EXISTS conversations_user_updated_live_idx;
--   CREATE INDEX conversations_user_updated_idx ON conversations (user_id, updated_at);
--   ALTER TABLE conversations DROP COLUMN IF EXISTS deleted_batch_id;
--   ALTER TABLE conversations DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_batch_id text;

DROP INDEX IF EXISTS conversations_user_updated_idx;
CREATE INDEX IF NOT EXISTS conversations_user_updated_live_idx
  ON conversations (user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS conversations_deleted_batch_idx
  ON conversations (deleted_batch_id);
