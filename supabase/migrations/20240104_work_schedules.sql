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
