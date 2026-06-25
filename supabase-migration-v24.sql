-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v24
-- PURPOSE: Create affiliate_payouts table and seed default settings
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Create affiliate_payouts table
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  payout_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  status TEXT DEFAULT 'paid' NOT NULL,
  transaction_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 2. Enable RLS and add policies
ALTER TABLE affiliate_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payouts_superadmin" ON affiliate_payouts;
CREATE POLICY "payouts_superadmin" ON affiliate_payouts FOR ALL USING (is_superadmin());

DROP POLICY IF EXISTS "payouts_affiliate_read" ON affiliate_payouts;
CREATE POLICY "payouts_affiliate_read" ON affiliate_payouts FOR SELECT USING (affiliate_id = auth.uid());

-- 3. Seed default affiliate commission rate (10%)
INSERT INTO platform_settings (key, value)
VALUES ('affiliate', '{"commission_percentage": 10}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Force reload schema cache
NOTIFY pgrst, 'reload schema';
