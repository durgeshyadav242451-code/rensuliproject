-- PURPOSE: Add billing_cycle column to owners table
ALTER TABLE owners ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly'));
