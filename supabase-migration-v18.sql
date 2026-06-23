-- PURPOSE: Add aadhar_verified column to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS aadhar_verified BOOLEAN DEFAULT FALSE;
