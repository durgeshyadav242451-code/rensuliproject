-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v15
-- PURPOSE: Add shift_type and starting_meter_reading to room_shift_requests
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════

ALTER TABLE room_shift_requests 
  ADD COLUMN IF NOT EXISTS shift_type TEXT CHECK (shift_type IN ('alone', 'with_members')) DEFAULT 'with_members',
  ADD COLUMN IF NOT EXISTS starting_meter_reading NUMERIC DEFAULT 0;

-- Reload Supabase PostgREST schema cache so new columns are recognized
NOTIFY pgrst, 'reload schema';
