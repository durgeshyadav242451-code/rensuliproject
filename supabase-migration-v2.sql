-- ═══════════════════════════════════════════════════════════
-- PG Builders — Migration v2: Tenant Revamp Features
-- Run this in Supabase SQL Editor → New Query
-- (Safe to run multiple times — uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════

-- ── 1. Rooms: Rent Split columns ──
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS rent_split_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS per_bed_rent NUMERIC DEFAULT NULL;

-- ── 2. Buildings: Rent split global default ──
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS rent_split_enabled BOOLEAN DEFAULT FALSE;

-- ── 3. Members: Active flag (members stay with tenant permanently) ──
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- ── 4. Owners: Notice board (already done, ensure exists) ──
ALTER TABLE owners ADD COLUMN IF NOT EXISTS notice_board TEXT DEFAULT NULL;

-- ═══════════════ ROOM SHIFT REQUESTS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS room_shift_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  from_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  to_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  from_room_number TEXT,
  to_room_number TEXT,
  from_building_name TEXT,
  to_building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  to_building_name TEXT,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_tenant ON room_shift_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shift_owner ON room_shift_requests(owner_id);
CREATE INDEX IF NOT EXISTS idx_shift_status ON room_shift_requests(status);

ALTER TABLE room_shift_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_owner" ON room_shift_requests FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "shift_tenant_all" ON room_shift_requests FOR ALL
  USING (tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid()));

-- ═══════════════ TENANT HISTORY TABLE ═══════════════
CREATE TABLE IF NOT EXISTS tenant_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  building_name TEXT,
  room_number TEXT,
  moved_in DATE,
  moved_out DATE,
  reason TEXT DEFAULT 'Initial registration',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_tenant ON tenant_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_history_owner ON tenant_history(owner_id);

ALTER TABLE tenant_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "history_owner_all" ON tenant_history FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "history_tenant_read" ON tenant_history FOR SELECT
  USING (tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid()));
CREATE POLICY "history_insert_all" ON tenant_history FOR INSERT WITH CHECK (true);

-- ═══════════════ MEMBERS: Self-read policy ═══════════════
-- Allow tenants to read/update/delete their own members
-- (Using DO block because CREATE POLICY does not support IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'members' AND policyname = 'members_self_read'
  ) THEN
    EXECUTE 'CREATE POLICY "members_self_read" ON members FOR SELECT
      USING (tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'members' AND policyname = 'members_self_update'
  ) THEN
    EXECUTE 'CREATE POLICY "members_self_update" ON members FOR UPDATE
      USING (tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'members' AND policyname = 'members_self_delete'
  ) THEN
    EXECUTE 'CREATE POLICY "members_self_delete" ON members FOR DELETE
      USING (tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid()))';
  END IF;
END $$;

-- ═══════════════ DONE ═══════════════
-- Migration v2 complete!
-- Next: Run your frontend code updates.
