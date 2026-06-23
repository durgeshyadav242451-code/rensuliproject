-- ═══════════════════════════════════════════════════
-- PG Builders — Database Migration v11
-- PURPOSE: Fix complaints connectivity owner↔tenant
--          + Auto-delete on resolved status
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- ── Step 1: Drop ALL existing complaint policies and recreate clean ──
DROP POLICY IF EXISTS "complaints_owner"    ON complaints;
DROP POLICY IF EXISTS "complaints_tenant"   ON complaints;
DROP POLICY IF EXISTS "superadmin_complaints" ON complaints;

-- Owner can see, update, and delete their own complaints
CREATE POLICY "complaints_owner_select" ON complaints
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "complaints_owner_update" ON complaints
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "complaints_owner_delete" ON complaints
  FOR DELETE USING (owner_id = auth.uid());

-- Tenant can insert, select and see their own complaints
CREATE POLICY "complaints_tenant_insert" ON complaints
  FOR INSERT WITH CHECK (true);

CREATE POLICY "complaints_tenant_select" ON complaints
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid())
  );

-- Superadmin full access
CREATE POLICY "complaints_superadmin" ON complaints
  FOR ALL USING ((auth.jwt()->>'email') = 'admin@pgbuilderss.online');

-- ── Step 2: Function + Trigger to auto-delete resolved/closed complaints ──
CREATE OR REPLACE FUNCTION delete_resolved_complaint()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('resolved', 'closed') THEN
    DELETE FROM complaints WHERE id = NEW.id;
    RETURN NULL;  -- row is gone, don't complete update
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_delete_resolved ON complaints;
CREATE TRIGGER trg_auto_delete_resolved
  AFTER UPDATE ON complaints
  FOR EACH ROW
  EXECUTE FUNCTION delete_resolved_complaint();

-- ── Step 3: Ensure owner_id is correctly indexed ──
CREATE INDEX IF NOT EXISTS idx_complaints_owner ON complaints(owner_id);
CREATE INDEX IF NOT EXISTS idx_complaints_tenant ON complaints(tenant_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
