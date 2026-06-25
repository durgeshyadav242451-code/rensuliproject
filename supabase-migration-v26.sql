-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v26
-- PURPOSE: Add commission_rate to payments, update default rate to 20%, and migrate existing records
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Add commission_rate column to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS commission_rate NUMERIC DEFAULT NULL;

-- 2. Update default affiliate commission rate (20%) in platform_settings
INSERT INTO platform_settings (key, value)
VALUES ('affiliate', '{"commission_percentage": 20}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = '{"commission_percentage": 20}'::jsonb;

-- 3. Populate commission_rate for existing approved SaaS Renewal payments
-- If referring affiliate has custom rate, use it. Otherwise, use 20%
UPDATE payments p
SET commission_rate = COALESCE(a.commission_percentage, 20)
FROM owners o
JOIN affiliates a ON o.referred_by_code = a.referral_code
WHERE p.owner_id = o.id AND p.month_year = 'SaaS Renewal' AND p.status = 'approved';

-- 4. Force reload schema cache
NOTIFY pgrst, 'reload schema';
