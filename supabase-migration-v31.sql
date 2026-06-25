-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v31
-- PURPOSE: Create WhatsApp settings and logging structure
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Extend owners table with WhatsApp custom settings
ALTER TABLE owners ADD COLUMN IF NOT EXISTS whatsapp_status TEXT DEFAULT 'disconnected' CHECK (whatsapp_status IN ('disconnected', 'connecting', 'connected'));
ALTER TABLE owners ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS whatsapp_reminder_offset INTEGER DEFAULT 3;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS whatsapp_message_template TEXT DEFAULT 'Dear {name}, rent of ₹{amount} for room {room_number} is pending. Please pay by {due_date} to UPI: {upi_id}.';
ALTER TABLE owners ADD COLUMN IF NOT EXISTS whatsapp_server_url TEXT DEFAULT 'http://localhost:3001';

-- 2. Create WhatsApp notification log table
CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE SET NULL,
  tenant_name   TEXT NOT NULL,
  phone         TEXT NOT NULL,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error_message TEXT DEFAULT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE whatsapp_logs ENABLE ROW LEVEL SECURITY;

-- 4. Create policy for owners to view/manage their logs
DROP POLICY IF EXISTS "owners_whatsapp_logs" ON whatsapp_logs;
CREATE POLICY "owners_whatsapp_logs" ON whatsapp_logs
  FOR ALL USING (owner_id = auth.uid());

-- 5. Force reload schema cache
NOTIFY pgrst, 'reload schema';
