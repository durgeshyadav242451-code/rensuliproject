-- ═══════════════════════════════════════════════════
-- PG Builders — Supabase Database Schema
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- ── Drop existing tables for a clean install ──
DROP VIEW IF EXISTS owner_monthly_income CASCADE;
DROP TABLE IF EXISTS vacate_notices CASCADE;
DROP TABLE IF EXISTS complaints CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS floors CASCADE;
DROP TABLE IF EXISTS buildings CASCADE;
DROP TABLE IF EXISTS owners CASCADE;

-- ── Enable UUID extension ──
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════ OWNERS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS owners (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  owner_key TEXT NOT NULL UNIQUE,
  upi_id TEXT DEFAULT NULL,
  subscription_status TEXT DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'expired')),
  subscription_expiry TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days'),
  allowed_buildings INTEGER DEFAULT 1,
  billing_cycle TEXT DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  default_electricity_rate NUMERIC DEFAULT 10,
  default_advance NUMERIC DEFAULT 5000,
  default_maintenance NUMERIC DEFAULT 500,
  notice_board TEXT DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ═══════════════ BUILDINGS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS buildings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pg', 'hostel', 'apartment', 'room')),
  electricity_rate NUMERIC DEFAULT 10,
  advance_amount NUMERIC DEFAULT 5000,
  maintenance_charge NUMERIC DEFAULT 500,
  electricity_included BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_buildings_owner ON buildings(owner_id);

-- ═══════════════ FLOORS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS floors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor_number TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_floors_building ON floors(building_id);

-- ═══════════════ ROOMS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  rent NUMERIC NOT NULL DEFAULT 8000,
  advance_amount NUMERIC DEFAULT 5000,
  electricity_included BOOLEAN DEFAULT FALSE,
  electricity_rate NUMERIC DEFAULT 10,
  electricity_subsidy_mode BOOLEAN DEFAULT FALSE,
  electricity_subsidy_units NUMERIC DEFAULT 1,
  electricity_subsidy_rate NUMERIC DEFAULT 0,
  beds_count INTEGER DEFAULT 1,
  beds_occupied INTEGER DEFAULT 0,
  status TEXT DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied', 'partial', 'maintenance')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rooms_floor ON rooms(floor_id);
CREATE INDEX idx_rooms_building ON rooms(building_id);

-- ═══════════════ TENANTS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  alt_phone TEXT,
  email TEXT NOT NULL,
  aadhaar_number TEXT,
  living_type TEXT DEFAULT 'alone' CHECK (living_type IN ('alone', 'family')),
  advance_paid NUMERIC DEFAULT 0,
  initial_meter_reading NUMERIC DEFAULT 0,
  current_meter_reading NUMERIC DEFAULT 0,
  join_date DATE DEFAULT CURRENT_DATE,
  vacate_date DATE DEFAULT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'vacating', 'vacated', 'rejected')),
  aadhar_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tenants_owner ON tenants(owner_id);
CREATE INDEX idx_tenants_building ON tenants(building_id);
CREATE INDEX idx_tenants_room ON tenants(room_id);
CREATE INDEX idx_tenants_status ON tenants(status);

-- ═══════════════ FAMILY MEMBERS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  aadhaar_number TEXT,
  relation TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_members_tenant ON members(tenant_id);

-- ═══════════════ PAYMENTS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
  tenant_name TEXT,
  room_number TEXT,
  building_name TEXT,
  month_year TEXT NOT NULL,              -- '2026-06'
  rent_amount NUMERIC DEFAULT 0,
  electricity_amount NUMERIC DEFAULT 0,
  maintenance_amount NUMERIC DEFAULT 0,
  advance_amount NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  prev_reading NUMERIC DEFAULT 0,
  curr_reading NUMERIC DEFAULT 0,
  units_consumed NUMERIC DEFAULT 0,
  payment_method TEXT DEFAULT 'UPI',
  transaction_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  payment_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payments_tenant ON payments(tenant_id);
CREATE INDEX idx_payments_building ON payments(building_id);
CREATE INDEX idx_payments_owner ON payments(owner_id);
CREATE INDEX idx_payments_month ON payments(month_year);
CREATE INDEX idx_payments_status ON payments(status);

-- ═══════════════ COMPLAINTS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS complaints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  response TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_complaints_tenant ON complaints(tenant_id);
CREATE INDEX idx_complaints_owner ON complaints(owner_id);

-- ═══════════════ VACATE NOTICES TABLE ═══════════════
CREATE TABLE IF NOT EXISTS vacate_notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
  reason TEXT,
  preferred_date DATE,
  deposit_refunded BOOLEAN DEFAULT FALSE,
  deposit_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted', 'acknowledged', 'processed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ═══════════════ ROW LEVEL SECURITY (RLS) ═══════════════

-- Enable RLS on all tables
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacate_notices ENABLE ROW LEVEL SECURITY;

-- ── Owners: can read/write their own data ──
CREATE POLICY "owners_select_own" ON owners FOR SELECT USING (id = auth.uid());
CREATE POLICY "owners_insert_own" ON owners FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "owners_update_own" ON owners FOR UPDATE USING (id = auth.uid());

-- Allow anyone to look up owner by key (for tenant registration)
CREATE POLICY "owners_select_by_key" ON owners FOR SELECT USING (true);

-- ── Buildings: owner can CRUD, tenants can read ──
CREATE POLICY "buildings_owner_all" ON buildings FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "buildings_tenant_read" ON buildings FOR SELECT USING (true);

-- ── Floors: same as buildings ──
CREATE POLICY "floors_owner_all" ON floors FOR ALL 
  USING (building_id IN (SELECT id FROM buildings WHERE owner_id = auth.uid()));
CREATE POLICY "floors_read" ON floors FOR SELECT USING (true);

-- ── Rooms: owner can CRUD, tenants can read ──
CREATE POLICY "rooms_owner_all" ON rooms FOR ALL 
  USING (building_id IN (SELECT id FROM buildings WHERE owner_id = auth.uid()));
CREATE POLICY "rooms_read" ON rooms FOR SELECT USING (true);

-- ── Tenants: owner can manage, tenant can see/update own ──
CREATE POLICY "tenants_owner_manage" ON tenants FOR ALL 
  USING (owner_id = auth.uid());
CREATE POLICY "tenants_self_read" ON tenants FOR SELECT 
  USING (auth_user_id = auth.uid() OR LOWER(email) = LOWER(auth.jwt()->>'email'));
CREATE POLICY "tenants_self_update" ON tenants FOR UPDATE 
  USING (auth_user_id = auth.uid() OR LOWER(email) = LOWER(auth.jwt()->>'email'))
  WITH CHECK (auth_user_id = auth.uid() OR LOWER(email) = LOWER(auth.jwt()->>'email'));
CREATE POLICY "tenants_self_insert" ON tenants FOR INSERT 
  WITH CHECK (true);  -- Anyone can submit a registration

-- ── Members: tied to tenant ──
CREATE POLICY "members_owner" ON members FOR ALL 
  USING (tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid()));
CREATE POLICY "members_insert" ON members FOR INSERT WITH CHECK (true);

-- ── Payments: owner and tenant can see their own ──
CREATE POLICY "payments_owner" ON payments FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "payments_tenant_read" ON payments FOR SELECT 
  USING (tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid()));
CREATE POLICY "payments_tenant_insert" ON payments FOR INSERT WITH CHECK (true);

-- ── Complaints: owner and tenant ──
CREATE POLICY "complaints_owner" ON complaints FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "complaints_tenant" ON complaints FOR ALL 
  USING (tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid()));

-- ── Vacate Notices ──
CREATE POLICY "vacate_owner" ON vacate_notices FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "vacate_tenant" ON vacate_notices FOR ALL 
  USING (tenant_id IN (SELECT id FROM tenants WHERE auth_user_id = auth.uid()));

-- ═══════════════ HELPER VIEWS ═══════════════

-- Monthly income view for owner
CREATE OR REPLACE VIEW owner_monthly_income AS
SELECT 
  owner_id,
  month_year,
  building_name,
  COUNT(*) as payment_count,
  SUM(rent_amount) as total_rent,
  SUM(electricity_amount) as total_electricity,
  SUM(maintenance_amount) as total_maintenance,
  SUM(total_amount) as gross_income
FROM payments
WHERE status = 'approved'
GROUP BY owner_id, month_year, building_name
ORDER BY month_year DESC;

-- ═══════════════ OWNER ACTIVITY LOGS TABLE ═══════════════
CREATE TABLE IF NOT EXISTS owner_activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  activity_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for activity logs
ALTER TABLE owner_activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_logs_all" ON owner_activity_logs FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "superadmin_logs" ON owner_activity_logs FOR ALL USING (is_superadmin());

-- ═══════════════ STAFF MANAGEMENT TABLE ═══════════════
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  salary NUMERIC NOT NULL DEFAULT 0,
  pay_day INTEGER NOT NULL DEFAULT 5 CHECK (pay_day >= 1 AND pay_day <= 31),
  payment_status TEXT DEFAULT 'Unpaid' CHECK (payment_status IN ('Paid', 'Unpaid')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for Staff
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_owner_all" ON staff FOR ALL USING (owner_id = auth.uid());

-- ═══════════════ EXPENSES TABLE ═══════════════
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL CHECK (category IN ('Maintenance', 'Electricity', 'Water', 'Repairs', 'Staff Salary', 'Others')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for Expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_owner_all" ON expenses FOR ALL USING (owner_id = auth.uid());

-- ═══════════════ DONE ═══════════════
-- Run this SQL in your Supabase project's SQL Editor.
-- Then update SUPABASE_URL and SUPABASE_ANON_KEY in:
-- src/js/supabase-config.js

