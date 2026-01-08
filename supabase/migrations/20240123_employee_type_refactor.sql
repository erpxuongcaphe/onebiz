-- Refactor Employee Type System
-- Gộp employment_type và pay_type thành employee_type
-- Values: full_time_monthly, full_time_hourly, part_time, probation, intern

-- Step 1: Add new employee_type column
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'employee_type') THEN
        ALTER TABLE employees ADD COLUMN employee_type VARCHAR(30) DEFAULT 'full_time_monthly';
    END IF;
END $$;

-- Step 2: Add CHECK constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE constraint_name = 'employees_employee_type_check') THEN
        ALTER TABLE employees ADD CONSTRAINT employees_employee_type_check 
        CHECK (employee_type IN ('full_time_monthly', 'full_time_hourly', 'part_time', 'probation', 'intern'));
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        NULL; -- Constraint already exists
END $$;

-- Step 3: Migrate existing data
UPDATE employees SET employee_type = 
    CASE 
        -- Hourly workers (check pay_type first)
        WHEN pay_type = 'hourly' THEN 'full_time_hourly'
        -- Probation status
        WHEN status = 'probation' THEN 'probation'
        -- Interns
        WHEN employment_type = 'intern' THEN 'intern'
        -- Part-time
        WHEN employment_type = 'part_time' THEN 'part_time'
        -- Contract workers - treat as full_time_monthly
        WHEN employment_type = 'contract' THEN 'full_time_monthly'
        -- Default: full_time_monthly
        ELSE 'full_time_monthly'
    END
WHERE employee_type IS NULL OR employee_type = 'full_time_monthly';

-- Step 4: Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_employees_employee_type ON employees(employee_type);

-- Note: We keep the old columns (employment_type, pay_type) for now
-- They can be dropped in a future migration after confirming everything works
