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
