-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v28
-- PURPOSE: Create withdrawal_requests table for affiliate payout requests
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Create withdrawal_requests table
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  affiliate_id  uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  affiliate_name text,
  phone         text,
  upi_id        text NOT NULL,
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  buildings_info text,            -- e.g. "3 buildings" or description
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  note          text,             -- Admin note / rejection reason
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- 3. Affiliate can INSERT their own requests
DROP POLICY IF EXISTS "affiliate_wr_insert" ON withdrawal_requests;
CREATE POLICY "affiliate_wr_insert" ON withdrawal_requests
  FOR INSERT WITH CHECK (auth.uid() = affiliate_id);

-- 4. Affiliate can SELECT their own requests
DROP POLICY IF EXISTS "affiliate_wr_select" ON withdrawal_requests;
CREATE POLICY "affiliate_wr_select" ON withdrawal_requests
  FOR SELECT USING (auth.uid() = affiliate_id OR is_superadmin());

-- 5. Superadmin can do ALL operations
DROP POLICY IF EXISTS "superadmin_wr_all" ON withdrawal_requests;
CREATE POLICY "superadmin_wr_all" ON withdrawal_requests
  FOR ALL USING (is_superadmin());

-- 6. Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wr_updated_at ON withdrawal_requests;
CREATE TRIGGER trg_wr_updated_at
  BEFORE UPDATE ON withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Force schema cache reload
NOTIFY pgrst, 'reload schema';
