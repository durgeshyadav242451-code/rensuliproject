-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v29
-- PURPOSE: Set/update default withdrawal window settings in platform_settings
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- Update or insert default values for affiliate settings in platform_settings
-- We merge the new withdrawal window settings into the existing affiliate settings
-- default: commission_percentage=20, withdrawal_start_day=1, withdrawal_end_day=5, withdrawal_window_status="auto"
INSERT INTO platform_settings (key, value)
VALUES (
  'affiliate',
  '{"commission_percentage": 20, "withdrawal_start_day": 1, "withdrawal_end_day": 5, "withdrawal_window_status": "auto"}'::jsonb
)
ON CONFLICT (key) DO UPDATE
SET value = COALESCE(platform_settings.value, '{}'::jsonb) 
            || '{"withdrawal_start_day": 1, "withdrawal_end_day": 5, "withdrawal_window_status": "auto"}'::jsonb;

-- Force schema cache reload
NOTIFY pgrst, 'reload schema';
