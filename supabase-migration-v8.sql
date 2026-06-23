-- ═══════════════════════════════════════════════════════════
-- PG Builders — Migration v8: Subscription Plans & Locked status
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

-- ── 1. Safely update status column check constraint to allow 'Locked' ──
DO $$
DECLARE
    c_name text;
BEGIN
    SELECT conname INTO c_name
    FROM pg_constraint
    WHERE conrelid = 'owners'::regclass 
      AND contype = 'c' 
      AND (consrc LIKE '%status%' OR conname LIKE '%status%');
    
    IF c_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE owners DROP CONSTRAINT ' || c_name;
    END IF;
END $$;

ALTER TABLE owners ADD CONSTRAINT owners_status_check CHECK (status IN ('Active', 'Suspended', 'Locked'));

-- ── 2. Modify defaults for new registered owners ──
-- Prevents new users from having active trial by default; they must purchase a plan or request manual unlock
ALTER TABLE owners ALTER COLUMN subscription_status SET DEFAULT 'expired';
ALTER TABLE owners ALTER COLUMN subscription_expiry SET DEFAULT NULL;
