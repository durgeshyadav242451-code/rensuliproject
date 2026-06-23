-- ═══════════════════════════════════════════════════════════
-- PG Builders — Migration v7: Staff & Expense Management
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

-- ── 1. Create Staff Table ──
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

-- ── 2. Create Expenses Table ──
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
