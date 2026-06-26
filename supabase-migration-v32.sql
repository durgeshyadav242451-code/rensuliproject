-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v32
-- PURPOSE: Fix Check Constraint for Vacate Notices Status to allow 'refund_declined'
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Drop existing constraint
ALTER TABLE vacate_notices DROP CONSTRAINT IF EXISTS vacate_notices_status_check;

-- 2. Add updated constraint with 'refund_declined' included
ALTER TABLE vacate_notices ADD CONSTRAINT vacate_notices_status_check 
  CHECK (status IN ('submitted', 'acknowledged', 'processed', 'refund_declined'));

-- 3. Force reload schema cache
NOTIFY pgrst, 'reload schema';
