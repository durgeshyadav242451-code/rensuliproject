-- ═══════════════════════════════════════════════════
-- PG Builders — Migration v34
-- PURPOSE: Meta WhatsApp Cloud API Settings & Logs
-- ═══════════════════════════════════════════════════

-- 1. Create table for WhatsApp configurations
CREATE TABLE IF NOT EXISTS owner_whatsapp_settings (
  owner_id UUID PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
  reminder_enabled BOOLEAN DEFAULT TRUE,
  reminder_days INTEGER DEFAULT 2,
  api_mode TEXT DEFAULT 'platform' CHECK (api_mode IN ('platform', 'personal')),
  meta_access_token TEXT DEFAULT NULL,
  meta_phone_number_id TEXT DEFAULT NULL,
  meta_template_name TEXT DEFAULT 'rent_reminder',
  meta_template_language TEXT DEFAULT 'en',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for settings
ALTER TABLE owner_whatsapp_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_settings_select_own" ON owner_whatsapp_settings 
  FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "whatsapp_settings_insert_own" ON owner_whatsapp_settings 
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "whatsapp_settings_update_own" ON owner_whatsapp_settings 
  FOR UPDATE USING (owner_id = auth.uid());

-- 2. Create table to log sent reminders
CREATE TABLE IF NOT EXISTS whatsapp_reminder_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES owners(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  tenant_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  message_preview TEXT,
  status TEXT CHECK (status IN ('sent', 'failed')),
  error_message TEXT DEFAULT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for logs
ALTER TABLE whatsapp_reminder_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_logs_select_own" ON whatsapp_reminder_logs 
  FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "whatsapp_logs_insert_own" ON whatsapp_reminder_logs 
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "whatsapp_logs_update_own" ON whatsapp_reminder_logs 
  FOR UPDATE USING (owner_id = auth.uid());
