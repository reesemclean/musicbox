-- Remove agent version column (agent package removed)
-- SQLite doesn't support DROP COLUMN directly, but drizzle handles this
-- For SQLite, we need to recreate the table or use ALTER TABLE DROP COLUMN (SQLite 3.35+)

ALTER TABLE devices DROP COLUMN reported_agent_version;
