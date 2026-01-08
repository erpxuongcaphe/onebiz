-- Add tax_code and insurance_number columns to employees table
-- These columns are needed for payslip export functionality

ALTER TABLE employees ADD COLUMN IF NOT EXISTS tax_code VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_number VARCHAR(20);

-- Add comments for clarity
COMMENT ON COLUMN employees.tax_code IS 'Mã số thuế cá nhân';
COMMENT ON COLUMN employees.insurance_number IS 'Mã số bảo hiểm xã hội';
