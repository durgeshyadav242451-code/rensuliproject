-- ═══════════════════════════════════════════════════════════
-- PG Builders — Migration v3: FCM Push Notifications
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

-- ── FCM Token Storage ──
CREATE TABLE IF NOT EXISTS fcm_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  token TEXT NOT NULL,
  role TEXT CHECK (role IN ('owner', 'tenant')),
  owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fcm_user ON fcm_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_fcm_owner ON fcm_tokens(owner_id);

ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own token
CREATE POLICY "fcm_own_all" ON fcm_tokens FOR ALL USING (user_id = auth.uid());

-- Owner can read tokens of their tenants (to send notifications)
CREATE POLICY "fcm_owner_read_tenants" ON fcm_tokens FOR SELECT
  USING (owner_id = auth.uid());

-- Allow insert from any authenticated user
CREATE POLICY "fcm_insert_own" ON fcm_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ── Done ──
-- Migration v3 complete!
