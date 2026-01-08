-- Migration: Add gender column to employees table
-- This allows storing employee gender information

ALTER TABLE employees
ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'male'
CHECK (gender IN ('male', 'female', 'other'));

-- Add comment for documentation
COMMENT ON COLUMN employees.gender IS 'Employee gender: male, female, or other';
