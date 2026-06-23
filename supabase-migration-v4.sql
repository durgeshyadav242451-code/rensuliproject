-- ═══════════════════════════════════════════════════════════
-- PG Builders — Migration v4: Broadcast Announcements Table
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS broadcast_announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES owners(id) ON DELETE CASCADE,
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE, -- NULL means all buildings
  building_name TEXT DEFAULT 'All Buildings',
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_owner ON broadcast_announcements(owner_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_building ON broadcast_announcements(building_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_created ON broadcast_announcements(created_at);

ALTER TABLE broadcast_announcements ENABLE ROW LEVEL SECURITY;

-- Owner can manage announcements
CREATE POLICY "broadcast_owner_all" ON broadcast_announcements FOR ALL 
  USING (owner_id = auth.uid());

-- Tenant can view announcements of their active building
CREATE POLICY "broadcast_tenant_read" ON broadcast_announcements FOR SELECT
  USING (
    building_id IS NULL OR 
    building_id IN (
      SELECT building_id FROM tenants WHERE auth_user_id = auth.uid() AND status = 'active'
    )
  );
