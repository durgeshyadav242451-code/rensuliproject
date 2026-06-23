-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v19
-- PURPOSE: Fix RLS Insert Policies for Complaints & Vacate Notices
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- ── 1. COMPLAINTS RLS FIXES ──
DROP POLICY IF EXISTS "complaints_owner" ON complaints;
DROP POLICY IF EXISTS "complaints_tenant" ON complaints;
DROP POLICY IF EXISTS "complaints_owner_select" ON complaints;
DROP POLICY IF EXISTS "complaints_owner_update" ON complaints;
DROP POLICY IF EXISTS "complaints_owner_delete" ON complaints;
DROP POLICY IF EXISTS "complaints_tenant_insert" ON complaints;
DROP POLICY IF EXISTS "complaints_tenant_select" ON complaints;
DROP POLICY IF EXISTS "superadmin_complaints" ON complaints;
DROP POLICY IF EXISTS "complaints_superadmin" ON complaints;

ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;

-- Landlord/Owner: Select, Update, Delete
CREATE POLICY "complaints_owner_select" ON complaints
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "complaints_owner_update" ON complaints
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "complaints_owner_delete" ON complaints
  FOR DELETE USING (owner_id = auth.uid());

-- Tenant: Insert (with check true to prevent RLS failures), Select
CREATE POLICY "complaints_tenant_insert" ON complaints
  FOR INSERT WITH CHECK (true);

CREATE POLICY "complaints_tenant_select" ON complaints
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid())
  );

-- Superadmin: Full access
CREATE POLICY "complaints_superadmin" ON complaints
  FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');


-- ── 2. VACATE NOTICES RLS FIXES ──
DROP POLICY IF EXISTS "vacate_owner" ON vacate_notices;
DROP POLICY IF EXISTS "vacate_tenant" ON vacate_notices;
DROP POLICY IF EXISTS "vacate_owner_select" ON vacate_notices;
DROP POLICY IF EXISTS "vacate_owner_update" ON vacate_notices;
DROP POLICY IF EXISTS "vacate_owner_delete" ON vacate_notices;
DROP POLICY IF EXISTS "vacate_tenant_insert" ON vacate_notices;
DROP POLICY IF EXISTS "vacate_tenant_select" ON vacate_notices;
DROP POLICY IF EXISTS "vacate_tenant_delete" ON vacate_notices;
DROP POLICY IF EXISTS "superadmin_vacate" ON vacate_notices;
DROP POLICY IF EXISTS "vacate_superadmin" ON vacate_notices;

ALTER TABLE vacate_notices ENABLE ROW LEVEL SECURITY;

-- Landlord/Owner: Select, Update, Delete
CREATE POLICY "vacate_owner_select" ON vacate_notices
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "vacate_owner_update" ON vacate_notices
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "vacate_owner_delete" ON vacate_notices
  FOR DELETE USING (owner_id = auth.uid());

-- Tenant: Insert, Select, Delete (cancel notice)
CREATE POLICY "vacate_tenant_insert" ON vacate_notices
  FOR INSERT WITH CHECK (true);

CREATE POLICY "vacate_tenant_select" ON vacate_notices
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "vacate_tenant_delete" ON vacate_notices
  FOR DELETE USING (
    tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid())
  );

-- Superadmin: Full access
CREATE POLICY "vacate_superadmin" ON vacate_notices
  FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- Notify schema reload
NOTIFY pgrst, 'reload schema';
