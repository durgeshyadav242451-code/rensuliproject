-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v27
-- PURPOSE: Fix RLS permissions for superadmins to manage affiliates and commission settings
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Create or replace policy to allow superadmins to do ALL operations on affiliates table
DROP POLICY IF EXISTS "superadmin_affiliates" ON affiliates;
CREATE POLICY "superadmin_affiliates" ON affiliates FOR ALL USING (is_superadmin());

-- 2. Force reload schema cache
NOTIFY pgrst, 'reload schema';
