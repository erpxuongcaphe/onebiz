-- First, ensure all extended columns exist (idempotent)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS identity_card TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_street TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_ward TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_district TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_city TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type TEXT DEFAULT 'full_time';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary NUMERIC;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS uniform_cost NUMERIC;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS uniform_issue_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS uniform_expiry_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notes TEXT;

-- Verify/Cleanup any existing constraint to avoid error
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_identity_card_key;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_phone_key;

-- Add unique constraints
ALTER TABLE employees ADD CONSTRAINT employees_identity_card_key UNIQUE (identity_card);
ALTER TABLE employees ADD CONSTRAINT employees_phone_key UNIQUE (phone);
