-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v13
-- PURPOSE: Seed default subscription plan settings
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

INSERT INTO platform_settings (key, value)
VALUES (
  'subscription', 
  '{"price_per_building": 5, "gst_rate": 18, "yearly_discount_months": 1}'::jsonb
)
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value;
