-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v25
-- PURPOSE: Add custom commission_percentage column to affiliates table
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Add commission_percentage column to affiliates table
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS commission_percentage NUMERIC DEFAULT NULL;

-- Force reload schema cache
NOTIFY pgrst, 'reload schema';
