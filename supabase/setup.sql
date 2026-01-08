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
