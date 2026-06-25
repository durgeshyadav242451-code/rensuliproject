-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v30
-- PURPOSE: Fix RLS permissions for affiliates to SELECT referred owner payments
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Create select policy for affiliates to view payments from landlords they referred
DROP POLICY IF EXISTS "affiliates_payments_select" ON payments;
CREATE POLICY "affiliates_payments_select" ON payments
  FOR SELECT
  USING (
    owner_id IN (
      SELECT id FROM owners
      WHERE referred_by_code = (
        SELECT referral_code FROM affiliates WHERE id = auth.uid()
      )
    )
  );

-- Force reload schema cache
NOTIFY pgrst, 'reload schema';
