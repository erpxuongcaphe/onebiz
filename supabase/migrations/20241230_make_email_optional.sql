-- Migration: Make email column optional (nullable) in employees table

ALTER TABLE employees
ALTER COLUMN email DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN employees.email IS 'Employee email address (optional)';
