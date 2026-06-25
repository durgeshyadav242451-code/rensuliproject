-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v22
-- PURPOSE: Create affiliates table and owner tracking
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Create affiliates table
CREATE TABLE IF NOT EXISTS affiliates (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT DEFAULT NULL,
  referral_code TEXT NOT NULL UNIQUE,
  upi_id TEXT DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies if any to avoid errors
DROP POLICY IF EXISTS "affiliates_select_own" ON affiliates;
DROP POLICY IF EXISTS "affiliates_insert_own" ON affiliates;
DROP POLICY IF EXISTS "affiliates_update_own" ON affiliates;
DROP POLICY IF EXISTS "affiliates_select_public" ON affiliates;

-- 4. Create Policies
CREATE POLICY "affiliates_select_own" ON affiliates FOR SELECT USING (id = auth.uid());
CREATE POLICY "affiliates_insert_own" ON affiliates FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "affiliates_update_own" ON affiliates FOR UPDATE USING (id = auth.uid());
CREATE POLICY "affiliates_select_public" ON affiliates FOR SELECT USING (true);

-- 5. Add referred_by_code column to owners table
ALTER TABLE owners ADD COLUMN IF NOT EXISTS referred_by_code TEXT DEFAULT NULL;

-- Force reload schema cache
NOTIFY pgrst, 'reload schema';
