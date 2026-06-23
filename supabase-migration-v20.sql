-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v20
-- PURPOSE: Create refund_requests table and setup RLS policies
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  payment_date DATE NOT NULL,
  refund_amount NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  additional_comments TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_refund_requests_owner ON refund_requests(owner_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status);

-- Enable RLS
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;

-- Drop policies if they already exist
DROP POLICY IF EXISTS "refund_requests_owner_insert" ON refund_requests;
DROP POLICY IF EXISTS "refund_requests_owner_select" ON refund_requests;
DROP POLICY IF EXISTS "refund_requests_owner_update" ON refund_requests;
DROP POLICY IF EXISTS "refund_requests_superadmin" ON refund_requests;

-- Landlord/Owner Policies:
CREATE POLICY "refund_requests_owner_insert" ON refund_requests 
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "refund_requests_owner_select" ON refund_requests 
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "refund_requests_owner_update" ON refund_requests 
  FOR UPDATE USING (owner_id = auth.uid());

-- Superadmin Policies:
CREATE POLICY "refund_requests_superadmin" ON refund_requests 
  FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Force reload schema cache
NOTIFY pgrst, 'reload schema';
