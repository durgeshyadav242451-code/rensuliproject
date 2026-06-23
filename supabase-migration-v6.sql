-- ═══════════════════════════════════════════════════════════
-- PG Builders — Migration v6: Allowed Buildings Limit
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

ALTER TABLE owners ADD COLUMN IF NOT EXISTS allowed_buildings INTEGER DEFAULT 1;
