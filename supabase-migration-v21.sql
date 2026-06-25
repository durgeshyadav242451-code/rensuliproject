-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v21
-- PURPOSE: Add bond_months column to tenants table
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bond_months INTEGER DEFAULT 0;

-- Force reload schema cache
NOTIFY pgrst, 'reload schema';
