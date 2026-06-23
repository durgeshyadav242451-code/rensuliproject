-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v14
-- PURPOSE: Add electricity subsidy settings to rooms
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════

ALTER TABLE rooms 
  ADD COLUMN IF NOT EXISTS electricity_subsidy_mode BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS electricity_subsidy_units NUMERIC DEFAULT 1,
  ADD COLUMN IF NOT EXISTS electricity_subsidy_rate NUMERIC DEFAULT 0;

-- Reload Supabase PostgREST schema cache so new columns are recognized
NOTIFY pgrst, 'reload schema';
