-- ═══════════════════════════════════════════════════════════
-- PG Builders — Migration v9: Room-level Maintenance Columns
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS maintenance_included BOOLEAN DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS maintenance_charge NUMERIC DEFAULT 500;

-- Force reload the schema cache
NOTIFY pgrst, 'reload schema';
