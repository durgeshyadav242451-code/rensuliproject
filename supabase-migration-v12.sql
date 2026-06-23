-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v12
-- PURPOSE: Support Aadhaar number for owners
--          + Create deleted owners archive table
--          + Drop and recreate status check constraint
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- ── Step 1: Add Aadhaar number to owners ──
ALTER TABLE owners ADD COLUMN IF NOT EXISTS aadhaar_number TEXT;

-- ── Step 2: Drop and recreate check constraint on status if it exists ──
ALTER TABLE owners DROP CONSTRAINT IF EXISTS owners_status_check;
ALTER TABLE owners ADD CONSTRAINT owners_status_check CHECK (status IN ('Active', 'Suspended', 'Locked', 'Expired'));

-- ── Step 3: Create deleted owners archive table ──
CREATE TABLE IF NOT EXISTS deleted_owners_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id UUID NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  aadhaar_number TEXT,
  buildings JSONB DEFAULT '[]'::jsonb,
  tenants JSONB DEFAULT '[]'::jsonb,
  deleted_by TEXT NOT NULL, -- 'Owner' or 'Super Admin'
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on deleted_owners_archive
ALTER TABLE deleted_owners_archive ENABLE ROW LEVEL SECURITY;

-- ── Step 4: Setup policies for deleted_owners_archive ──
DROP POLICY IF EXISTS "Allow authenticated insert" ON deleted_owners_archive;
CREATE POLICY "Allow authenticated insert" ON deleted_owners_archive
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Superadmin full access" ON deleted_owners_archive;
CREATE POLICY "Superadmin full access" ON deleted_owners_archive
  FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- ── Step 5: Prevent tenant deletion when building or room is deleted ──
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_building_id_fkey;
ALTER TABLE tenants ADD CONSTRAINT tenants_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_room_id_fkey;
ALTER TABLE tenants ADD CONSTRAINT tenants_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;

-- ── Step 6: Prevent tenant, payment, complaint, and vacate notice deletion when owner is deleted ──
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_owner_id_fkey;
ALTER TABLE tenants ADD CONSTRAINT tenants_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_owner_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL;

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_owner_id_fkey;
ALTER TABLE complaints ADD CONSTRAINT complaints_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL;

ALTER TABLE vacate_notices DROP CONSTRAINT IF EXISTS vacate_notices_owner_id_fkey;
ALTER TABLE vacate_notices ADD CONSTRAINT vacate_notices_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL;
