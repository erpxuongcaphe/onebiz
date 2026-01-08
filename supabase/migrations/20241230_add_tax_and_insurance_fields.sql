-- Migration: Add tax_id and social_insurance_id columns to employees table
-- This allows storing employee's personal tax code (MST cá nhân) and social insurance ID (mã số BHXH)

ALTER TABLE employees
ADD COLUMN IF NOT EXISTS tax_id TEXT,
ADD COLUMN IF NOT EXISTS social_insurance_id TEXT;

-- Add comments for documentation
COMMENT ON COLUMN employees.tax_id IS 'Personal Tax ID (Mã số thuế cá nhân)';
COMMENT ON COLUMN employees.social_insurance_id IS 'Social Insurance ID (Mã số BHXH)';
