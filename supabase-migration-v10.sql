-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v10
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. Cascade delete tenants when owner is deleted
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_owner_id_fkey;
ALTER TABLE tenants ADD CONSTRAINT tenants_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE;

-- 2. Cascade delete payments when owner is deleted
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_owner_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE;

-- 3. Cascade delete complaints when owner is deleted
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_owner_id_fkey;
ALTER TABLE complaints ADD CONSTRAINT complaints_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE;

-- 4. Cascade delete vacate notices when owner is deleted
ALTER TABLE vacate_notices DROP CONSTRAINT IF EXISTS vacate_notices_owner_id_fkey;
ALTER TABLE vacate_notices ADD CONSTRAINT vacate_notices_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE;

-- 5. Link support_tickets directly to owners(id) and cascade delete on owner deletion
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_user_id_fkey;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES owners(id) ON DELETE CASCADE;

-- 6. Add DELETE policy for owners table so owners can delete their own account
DROP POLICY IF EXISTS "owners_delete_own" ON owners;
CREATE POLICY "owners_delete_own" ON owners FOR DELETE USING (id = auth.uid());

-- 7. Fix RLS policies for Super Admin access using direct email check
-- Support Tickets:
DROP POLICY IF EXISTS "support_tickets_admin" ON support_tickets;
CREATE POLICY "support_tickets_admin" ON support_tickets FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Ticket Replies:
DROP POLICY IF EXISTS "ticket_replies_admin" ON ticket_replies;
CREATE POLICY "ticket_replies_admin" ON ticket_replies FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Platform Settings:
DROP POLICY IF EXISTS "platform_settings_admin" ON platform_settings;
CREATE POLICY "platform_settings_admin" ON platform_settings FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Audit Logs:
DROP POLICY IF EXISTS "audit_logs_admin" ON audit_logs;
CREATE POLICY "audit_logs_admin" ON audit_logs FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- System Notifications:
DROP POLICY IF EXISTS "system_notifications_admin" ON system_notifications;
CREATE POLICY "system_notifications_admin" ON system_notifications FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Owners RLS update:
DROP POLICY IF EXISTS "superadmin_owners" ON owners;
CREATE POLICY "superadmin_owners" ON owners FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Buildings RLS update:
DROP POLICY IF EXISTS "superadmin_buildings" ON buildings;
CREATE POLICY "superadmin_buildings" ON buildings FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Floors RLS update:
DROP POLICY IF EXISTS "superadmin_floors" ON floors;
CREATE POLICY "superadmin_floors" ON floors FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Rooms RLS update:
DROP POLICY IF EXISTS "superadmin_rooms" ON rooms;
CREATE POLICY "superadmin_rooms" ON rooms FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Tenants RLS update:
DROP POLICY IF EXISTS "superadmin_tenants" ON tenants;
CREATE POLICY "superadmin_tenants" ON tenants FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Members RLS update:
DROP POLICY IF EXISTS "superadmin_members" ON members;
CREATE POLICY "superadmin_members" ON members FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Payments RLS update:
DROP POLICY IF EXISTS "superadmin_payments" ON payments;
CREATE POLICY "superadmin_payments" ON payments FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Complaints RLS update:
DROP POLICY IF EXISTS "superadmin_complaints" ON complaints;
CREATE POLICY "superadmin_complaints" ON complaints FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Vacate Notices RLS update:
DROP POLICY IF EXISTS "superadmin_vacate" ON vacate_notices;
CREATE POLICY "superadmin_vacate" ON vacate_notices FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');
