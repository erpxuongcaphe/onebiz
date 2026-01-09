-- ======================================
-- HRM Database Setup Script for Supabase
-- ======================================
-- Run this script in Supabase SQL Editor:
-- Dashboard → SQL Editor → New Query → Paste & Run

-- =====================================
-- 1. Create employees table
-- =====================================
CREATE TABLE IF NOT EXISTS employees (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    position VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'probation', 'inactive')),
    join_date DATE NOT NULL,
    address TEXT,
    avatar VARCHAR(10),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================
-- 2. Create users table
-- =====================================
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(20) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'accountant', 'branch_manager', 'member')),
    employee_id VARCHAR(20) REFERENCES employees(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================
-- 3. Create indexes for performance
-- =====================================
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);

-- =====================================
-- 4. Enable Row Level Security (RLS)
-- =====================================
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write (adjust for your needs)
CREATE POLICY "Allow all for authenticated users" ON employees
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON users
    FOR ALL USING (true) WITH CHECK (true);

-- =====================================
-- 5. Seed data - Employees
-- =====================================
INSERT INTO employees (id, name, email, department, position, phone, status, join_date, address, avatar) VALUES
('NV001', 'Nguyễn Văn An', 'an.nguyen@company.vn', 'Kỹ thuật', 'Senior Developer', '0901 234 567', 'active', '2022-03-15', '123 Nguyễn Huệ, Quận 1, TP.HCM', 'NVA'),
('NV002', 'Trần Thị Bình', 'binh.tran@company.vn', 'Nhân sự', 'HR Manager', '0912 345 678', 'active', '2021-06-01', '456 Lê Lợi, Quận 3, TP.HCM', 'TTB'),
('NV003', 'Lê Hoàng Cường', 'cuong.le@company.vn', 'Kinh doanh', 'Sales Executive', '0923 456 789', 'active', '2023-01-10', '789 Hai Bà Trưng, Quận 1, TP.HCM', 'LHC'),
('NV004', 'Phạm Minh Dũng', 'dung.pham@company.vn', 'Kỹ thuật', 'Junior Developer', '0934 567 890', 'probation', '2024-09-01', '321 Võ Văn Tần, Quận 3, TP.HCM', 'PMD'),
('NV005', 'Hoàng Thị Hoa', 'hoa.hoang@company.vn', 'Kế toán', 'Accountant', '0945 678 901', 'active', '2020-11-20', '654 Điện Biên Phủ, Quận Bình Thạnh, TP.HCM', 'HTH'),
('NV006', 'Vũ Đức Minh', 'minh.vu@company.vn', 'Marketing', 'Marketing Specialist', '0956 789 012', 'inactive', '2019-08-05', '987 Nam Kỳ Khởi Nghĩa, Quận 3, TP.HCM', 'VDM')
ON CONFLICT (id) DO NOTHING;

-- =====================================
-- 6. Seed data - Users
-- =====================================
-- Passwords are Base64 encoded (for demo only - NOT secure)
-- admin123 = YWRtaW4xMjM=
-- ketoan123 = a2V0b2FuMTIz
-- qlcn123 = cWxjbjEyMw==
-- member123 = bWVtYmVyMTIz

INSERT INTO users (id, username, email, password_hash, full_name, role, employee_id, is_active) VALUES
('USR001', 'admin', 'admin@company.vn', 'YWRtaW4xMjM=', 'Admin System', 'admin', NULL, true),
('USR002', 'ketoan', 'ketoan@company.vn', 'a2V0b2FuMTIz', 'Hoàng Thị Hoa', 'accountant', 'NV005', true),
('USR003', 'qlcn', 'qlcn@company.vn', 'cWxjbjEyMw==', 'Trần Thị Bình', 'branch_manager', 'NV002', true),
('USR004', 'member', 'member@company.vn', 'bWVtYmVyMTIz', 'Nguyễn Văn An', 'member', 'NV001', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================
-- Done! Tables created and seeded.
-- =====================================
-- Create employees table if it doesn't exist
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    department TEXT,
    position TEXT,
    phone TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'probation', 'inactive')),
    join_date DATE,
    address TEXT, -- Combined address or general address
    avatar TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Extended fields
    date_of_birth DATE,
    identity_card TEXT,
    address_street TEXT,
    address_ward TEXT,
    address_district TEXT,
    address_city TEXT,
    employment_type TEXT DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
    termination_date DATE,
    salary NUMERIC,
    uniform_cost NUMERIC,
    uniform_issue_date DATE,
    uniform_expiry_date DATE,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    notes TEXT
);

-- Enable Row Level Security
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations (Select, Insert, Update, Delete)
-- Warning: This is for development/internal use. In production, you'd want stricter policies based on user roles.
DROP POLICY IF EXISTS "Enable all access for all users" ON employees;
CREATE POLICY "Enable all access for all users" ON employees
    FOR ALL
    USING (true)
    WITH CHECK (true);
-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add unique constraint if not exists (for existing tables)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'departments_name_key'
    ) THEN
        ALTER TABLE departments ADD CONSTRAINT departments_name_key UNIQUE (name);
    END IF;
END $$;

-- Create positions table
CREATE TABLE IF NOT EXISTS positions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add unique constraint if not exists (for existing tables)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'positions_name_key'
    ) THEN
        ALTER TABLE positions ADD CONSTRAINT positions_name_key UNIQUE (name);
    END IF;
END $$;

-- Insert default departments (only if not exists)
INSERT INTO departments (name)
SELECT name FROM (VALUES 
    ('Kỹ thuật'),
    ('Nhân sự'),
    ('Kinh doanh'),
    ('Kế toán'),
    ('Marketing'),
    ('Ban giám đốc'),
    ('Hành chính')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.name = v.name);

-- Insert default positions (only if not exists)
INSERT INTO positions (name)
SELECT name FROM (VALUES 
    ('Nhân viên'),
    ('Trưởng nhóm'),
    ('Trưởng phòng'),
    ('Phó giám đốc'),
    ('Giám đốc'),
    ('Developer'),
    ('Senior Developer'),
    ('HR Manager'),
    ('Accountant'),
    ('Marketing Specialist'),
    ('Sales Executive')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE p.name = v.name);

-- Enable RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then create new ones
DROP POLICY IF EXISTS "Enable all access for departments" ON departments;
DROP POLICY IF EXISTS "Enable all access for positions" ON positions;

CREATE POLICY "Enable all access for departments" ON departments FOR ALL USING (true);
CREATE POLICY "Enable all access for positions" ON positions FOR ALL USING (true);
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
-- ============================================
-- WORK SCHEDULE SYSTEM
-- Run this script in Supabase SQL Editor
-- ============================================

-- Create work_schedules table (Lịch làm việc)
CREATE TABLE IF NOT EXISTS work_schedules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id VARCHAR(20) NOT NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, completed, absent, cancelled
    notes TEXT,
    created_by VARCHAR(20), -- User ID who created
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(employee_id, date) -- One schedule per employee per day
);

-- Create attendance_permissions table (Phân quyền chấm công)
CREATE TABLE IF NOT EXISTS attendance_permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL, -- User được phân quyền
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    can_check_attendance BOOLEAN DEFAULT true,
    assigned_by VARCHAR(20), -- Admin phân quyền
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, branch_id) -- One permission per user per branch
);

-- Add schedule_id and checked_by to attendance_records
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'schedule_id') THEN
        ALTER TABLE attendance_records ADD COLUMN schedule_id UUID REFERENCES work_schedules(id) ON DELETE SET NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'checked_by') THEN
        ALTER TABLE attendance_records ADD COLUMN checked_by VARCHAR(20);
    END IF;
END $$;

-- Enable RLS
ALTER TABLE work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_permissions ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Enable all access for work_schedules" ON work_schedules;
DROP POLICY IF EXISTS "Enable all access for attendance_permissions" ON attendance_permissions;

CREATE POLICY "Enable all access for work_schedules" ON work_schedules FOR ALL USING (true);
CREATE POLICY "Enable all access for attendance_permissions" ON attendance_permissions FOR ALL USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_schedules_employee_id ON work_schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON work_schedules(date);
CREATE INDEX IF NOT EXISTS idx_schedules_branch_id ON work_schedules(branch_id);
CREATE INDEX IF NOT EXISTS idx_permissions_user_id ON attendance_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_permissions_branch_id ON attendance_permissions(branch_id);
-- ============================================
-- ADD DEFAULT BUSINESS HOURS SHIFTS
-- Run this script in Supabase SQL Editor
-- ============================================

-- Function to add office shifts if they don't exist
DO $$
DECLARE
    office_branch RECORD;
BEGIN
    FOR office_branch IN SELECT id FROM branches WHERE is_office = true
    LOOP
        -- Insert 'Hành chính' shift for Office (08:00 - 17:30)
        IF NOT EXISTS (
            SELECT 1 FROM shifts 
            WHERE branch_id = office_branch.id AND (name = 'Hành chính' OR name = 'Ca hành chính')
        ) THEN
            INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate)
            VALUES (
                office_branch.id, 
                'Hành chính', 
                '08:00'::TIME, 
                '17:30'::TIME, 
                0 -- Often monthly salary, but rate can be set if needed
            );
        END IF;
    END LOOP;
END $$;

-- Update Store Shifts if needed or ensure they exist
-- (User mentioned Stores operate 06:00 - 22:00, usually broken into shifts, but we'll ensure at least the basic ones exist from previous migration)
-- The previous migration `20240103` already added Ca sáng, Ca chiều, Ca tối suitable for this range.
-- So we mainly focus on the Office shift here.
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
-- ============================================
-- QR ATTENDANCE FEATURE - STEP 1
-- Thêm qr_token vào bảng branches
-- ============================================

-- Thêm cột qr_token vào bảng branches
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'qr_token') THEN
        ALTER TABLE branches ADD COLUMN qr_token VARCHAR(64) UNIQUE;
    END IF;
END $$;

-- Tạo token cho các chi nhánh hiện có (nếu chưa có)
UPDATE branches 
SET qr_token = encode(gen_random_bytes(32), 'hex')
WHERE qr_token IS NULL;

-- Đảm bảo các chi nhánh mới sẽ tự động có token
-- (Sẽ được xử lý ở application layer khi tạo chi nhánh mới)

-- Tạo index cho qr_token để tìm kiếm nhanh
CREATE INDEX IF NOT EXISTS idx_branches_qr_token ON branches(qr_token);
-- Migration: Add GPS location fields to branches for attendance validation
-- This enables location-based check-in verification

ALTER TABLE branches 
ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS radius INTEGER DEFAULT 50;

-- Add comments for documentation
COMMENT ON COLUMN branches.latitude IS 'Vĩ độ của chi nhánh (Latitude)';
COMMENT ON COLUMN branches.longitude IS 'Kinh độ của chi nhánh (Longitude)';
COMMENT ON COLUMN branches.radius IS 'Bán kính cho phép chấm công (mét), mặc định 50m';
-- ============================================
-- OT AND SCHEDULE APPROVAL ENHANCEMENT
-- Run this script in Supabase SQL Editor
-- ============================================

-- Add overtime_hours to attendance_records
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'overtime_hours') THEN
        ALTER TABLE attendance_records ADD COLUMN overtime_hours DECIMAL(5, 2) DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'approved_by') THEN
        ALTER TABLE attendance_records ADD COLUMN approved_by VARCHAR(20);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'approved_at') THEN
        ALTER TABLE attendance_records ADD COLUMN approved_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add custom shift times to work_schedules (override shift times if needed)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_schedules' AND column_name = 'custom_start') THEN
        ALTER TABLE work_schedules ADD COLUMN custom_start TIME;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_schedules' AND column_name = 'custom_end') THEN
        ALTER TABLE work_schedules ADD COLUMN custom_end TIME;
    END IF;
END $$;

-- Create index for faster pending queries
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records(status);

COMMENT ON COLUMN attendance_records.overtime_hours IS 'Số giờ OT (tính khi check-out)';
COMMENT ON COLUMN attendance_records.approved_by IS 'User ID đã duyệt';
COMMENT ON COLUMN attendance_records.approved_at IS 'Thời gian duyệt';
-- ============================================
-- OFFICE HOURS DEFAULT SHIFT
-- Giờ hành chính cho nhân viên lương tháng
-- Run this script in Supabase SQL Editor
-- ============================================

-- 1. Tạo ca "Giờ hành chính" cho tất cả chi nhánh văn phòng (is_office = true)
-- Thứ 2 - Thứ 7: 8:00 - 17:30 (nghỉ trưa 12:00 - 13:30 = 1.5h)
-- Thực làm: 8h (8:00-12:00 = 4h + 13:30-17:30 = 4h)

INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate, is_active)
SELECT 
    b.id,
    'Giờ hành chính',
    '08:00'::TIME,
    '17:30'::TIME,
    0,  -- Lương tháng không tính theo giờ
    true
FROM branches b 
WHERE b.is_office = true
ON CONFLICT DO NOTHING;

-- 2. Tạo bảng cấu hình giờ hành chính (để admin có thể thay đổi)
CREATE TABLE IF NOT EXISTS office_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key VARCHAR(50) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by VARCHAR(20)
);

-- 3. Insert cấu hình mặc định
INSERT INTO office_settings (key, value, description) VALUES
    ('office_start_time', '08:00', 'Giờ bắt đầu làm việc'),
    ('office_end_time', '17:30', 'Giờ kết thúc làm việc'),
    ('lunch_start_time', '12:00', 'Giờ nghỉ trưa bắt đầu'),
    ('lunch_end_time', '13:30', 'Giờ nghỉ trưa kết thúc'),
    ('work_days', '1,2,3,4,5,6', 'Các ngày làm việc (0=CN, 1=T2, ..., 6=T7)')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW();

-- Enable RLS
ALTER TABLE office_settings ENABLE ROW LEVEL SECURITY;

-- RLS policy
DROP POLICY IF EXISTS "Enable all access for office_settings" ON office_settings;
CREATE POLICY "Enable all access for office_settings" ON office_settings FOR ALL USING (true);

-- Comments
COMMENT ON TABLE office_settings IS 'Cấu hình giờ hành chính - có thể thay đổi bởi Admin';
COMMENT ON COLUMN office_settings.work_days IS 'Các ngày làm việc: 0=Chủ nhật, 1=Thứ 2, 2=Thứ 3, ...';
