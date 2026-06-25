-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v23
-- PURPOSE: Add onboarding columns to affiliates table
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- Add new onboarding columns to affiliates
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS location TEXT DEFAULT NULL;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS profession TEXT DEFAULT NULL;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS is_onboarded BOOLEAN DEFAULT FALSE NOT NULL;

-- Update existing rows to mark as onboarded (they already signed up)
UPDATE affiliates SET is_onboarded = TRUE WHERE is_onboarded = FALSE;

-- Force reload schema cache
NOTIFY pgrst, 'reload schema';
