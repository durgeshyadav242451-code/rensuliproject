-- ═══════════════════════════════════════════════════
-- PG Builders — Super Admin Schema Extension
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Extend owners table for plans & status
ALTER TABLE owners ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'Basic' CHECK (plan_type IN ('Basic', 'Pro', 'Enterprise'));
ALTER TABLE owners ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended'));
ALTER TABLE owners ADD COLUMN IF NOT EXISTS company_name TEXT DEFAULT '';
ALTER TABLE owners ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. Platform Settings Table
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Seed default settings
INSERT INTO platform_settings (key, value) VALUES
('plans', '{
  "Basic": {"price": 999, "features": ["1 Building", "Up to 20 Rooms", "Standard Support"]},
  "Pro": {"price": 1999, "features": ["Up to 5 Buildings", "Up to 100 Rooms", "WhatsApp Alerts", "Priority Support"]},
  "Enterprise": {"price": 4999, "features": ["Unlimited Buildings", "Unlimited Rooms", "Custom Domain", "24/7 Dedicated Support"]}
}'::jsonb),
('general', '{
  "platform_name": "PG Builders",
  "logo_url": "",
  "favicon_url": "",
  "contact_email": "support@pgbuilders.in",
  "contact_phone": "+91 9876543210",
  "gst_rate": 18,
  "free_trial_days": 30
}'::jsonb),
('gateways', '{
  "razorpay": {"enabled": true, "key_id": "rzp_test_example", "key_secret": "******"},
  "cashfree": {"enabled": false, "app_id": "", "secret_key": ""},
  "stripe": {"enabled": false, "publishable_key": "", "secret_key": ""},
  "paypal": {"enabled": false, "client_id": "", "secret_key": ""}
}'::jsonb),
('email_sms', '{
  "smtp_host": "smtp.mailtrap.io",
  "smtp_port": 2525,
  "smtp_user": "",
  "smtp_pass": "",
  "sms_gateway": "Twilio",
  "sms_sid": "",
  "sms_token": ""
}'::jsonb),
('legal', '{
  "privacy_policy": "Default Privacy Policy for PG Builders. We protect your data.",
  "terms_conditions": "Default Terms and Conditions. Please use the platform responsibly.",
  "refund_policy": "Refunds are processed within 7 business days under standard conditions."
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. Support Tickets Table
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'low' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  category TEXT NOT NULL CHECK (category IN ('Billing Issue', 'Subscription Issue', 'Technical Problem', 'Tenant Issue', 'Building Issue', 'Feature Request', 'Bug Report')),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'escalated')),
  assigned_staff TEXT DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

-- 4. Ticket Replies Table
CREATE TABLE IF NOT EXISTS ticket_replies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('admin', 'user')),
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket ON ticket_replies(ticket_id);

-- 5. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_name TEXT NOT NULL,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- 6. System Notifications (Broadcast logs) Table
CREATE TABLE IF NOT EXISTS system_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('all', 'selected', 'basic', 'pro', 'enterprise', 'expiring', 'suspended')),
  delivery_type TEXT NOT NULL, -- 'Push, In-App, Email, SMS'
  notice_type TEXT NOT NULL, -- 'Maintenance', 'Feature', 'Reminder' etc
  delivered_count INTEGER DEFAULT 0,
  open_rate NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Super Admin Check Function (Helpers)
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (auth.jwt()->>'email') = 'admin@pgbuilderss.online';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Enable RLS on New Tables
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_notifications ENABLE ROW LEVEL SECURITY;

-- 9. Setup Policies for New Tables
-- Settings: Anyone can read, only superadmin can modify
CREATE POLICY "platform_settings_read" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "platform_settings_admin" ON platform_settings FOR ALL USING (is_superadmin());

-- Support Tickets: Users can read/write their own, superadmin can do everything
CREATE POLICY "support_tickets_user_read" ON support_tickets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "support_tickets_user_insert" ON support_tickets FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "support_tickets_admin" ON support_tickets FOR ALL USING (is_superadmin());

-- Ticket Replies: Users can read/write replies to their own tickets, superadmin can do everything
CREATE POLICY "ticket_replies_user" ON ticket_replies FOR ALL 
  USING (ticket_id IN (SELECT id FROM support_tickets WHERE user_id = auth.uid()));
CREATE POLICY "ticket_replies_admin" ON ticket_replies FOR ALL USING (is_superadmin());

-- Audit Logs: Only superadmin can access
CREATE POLICY "audit_logs_admin" ON audit_logs FOR ALL USING (is_superadmin());

-- System Notifications: Anyone can read, only superadmin can modify
CREATE POLICY "system_notifications_read" ON system_notifications FOR SELECT USING (true);
CREATE POLICY "system_notifications_admin" ON system_notifications FOR ALL USING (is_superadmin());

-- 10. Inject Super Admin policies into all EXISTING tables
-- Owners RLS Update
DROP POLICY IF EXISTS "superadmin_owners" ON owners;
CREATE POLICY "superadmin_owners" ON owners FOR ALL USING (is_superadmin());

-- Buildings RLS Update
DROP POLICY IF EXISTS "superadmin_buildings" ON buildings;
CREATE POLICY "superadmin_buildings" ON buildings FOR ALL USING (is_superadmin());

-- Floors RLS Update
DROP POLICY IF EXISTS "superadmin_floors" ON floors;
CREATE POLICY "superadmin_floors" ON floors FOR ALL USING (is_superadmin());

-- Rooms RLS Update
DROP POLICY IF EXISTS "superadmin_rooms" ON rooms;
CREATE POLICY "superadmin_rooms" ON rooms FOR ALL USING (is_superadmin());

-- Tenants RLS Update
DROP POLICY IF EXISTS "superadmin_tenants" ON tenants;
CREATE POLICY "superadmin_tenants" ON tenants FOR ALL USING (is_superadmin());

-- Members RLS Update
DROP POLICY IF EXISTS "superadmin_members" ON members;
CREATE POLICY "superadmin_members" ON members FOR ALL USING (is_superadmin());

-- Payments RLS Update
DROP POLICY IF EXISTS "superadmin_payments" ON payments;
CREATE POLICY "superadmin_payments" ON payments FOR ALL USING (is_superadmin());

-- Complaints RLS Update
DROP POLICY IF EXISTS "superadmin_complaints" ON complaints;
CREATE POLICY "superadmin_complaints" ON complaints FOR ALL USING (is_superadmin());

-- Vacate Notices RLS Update
DROP POLICY IF EXISTS "superadmin_vacate" ON vacate_notices;
CREATE POLICY "superadmin_vacate" ON vacate_notices FOR ALL USING (is_superadmin());
