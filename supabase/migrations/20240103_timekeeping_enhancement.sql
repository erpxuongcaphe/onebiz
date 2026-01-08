-- ============================================
-- TIMEKEEPING ENHANCEMENT SCHEMA (Fixed)
-- Run this script in Supabase SQL Editor
-- ============================================

-- Drop existing tables if they have wrong schema (optional - comment out if you want to keep data)
DROP TABLE IF EXISTS attendance_records CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;
DROP TABLE IF EXISTS branches CASCADE;

-- Create branches table (Chi nhánh)
CREATE TABLE branches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    is_office BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create shifts table (Ca làm việc)
CREATE TABLE shifts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    hourly_rate DECIMAL(12, 0) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create attendance_records table (Bản ghi chấm công)
CREATE TABLE attendance_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id VARCHAR(20) NOT NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    check_in TIMESTAMP WITH TIME ZONE,
    check_out TIMESTAMP WITH TIME ZONE,
    hours_worked DECIMAL(5, 2),
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add pay_type and branch_id to employees table (safe - won't error if already exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'pay_type') THEN
        ALTER TABLE employees ADD COLUMN pay_type VARCHAR(20) DEFAULT 'monthly';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'branch_id') THEN
        ALTER TABLE employees ADD COLUMN branch_id UUID;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'hourly_rate') THEN
        ALTER TABLE employees ADD COLUMN hourly_rate DECIMAL(12, 0) DEFAULT 0;
    END IF;
END $$;

-- Insert default branches
INSERT INTO branches (name, address, is_office) VALUES 
    ('Văn phòng chính', 'Quận 1, TP.HCM', true),
    ('Cửa hàng Quận 3', 'Quận 3, TP.HCM', false),
    ('Cửa hàng Quận 7', 'Quận 7, TP.HCM', false);

-- Insert default shifts for stores (cửa hàng)
INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate)
SELECT b.id, 'Ca sáng', '06:00'::TIME, '14:00'::TIME, 30000
FROM branches b WHERE b.is_office = false;

INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate)
SELECT b.id, 'Ca chiều', '14:00'::TIME, '22:00'::TIME, 35000
FROM branches b WHERE b.is_office = false;

INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate)
SELECT b.id, 'Ca tối', '18:00'::TIME, '23:00'::TIME, 40000
FROM branches b WHERE b.is_office = false;

-- Enable RLS
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Enable all access for branches" ON branches;
DROP POLICY IF EXISTS "Enable all access for shifts" ON shifts;
DROP POLICY IF EXISTS "Enable all access for attendance_records" ON attendance_records;

CREATE POLICY "Enable all access for branches" ON branches FOR ALL USING (true);
CREATE POLICY "Enable all access for shifts" ON shifts FOR ALL USING (true);
CREATE POLICY "Enable all access for attendance_records" ON attendance_records FOR ALL USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_shifts_branch_id ON shifts(branch_id);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_attendance_branch_id ON attendance_records(branch_id);
