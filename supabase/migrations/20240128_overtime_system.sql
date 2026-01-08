-- Migration: Add overtime system fields to attendance_records
-- Created: 2024-01-28

-- Add OT-related fields to attendance_records table
ALTER TABLE attendance_records 
ADD COLUMN IF NOT EXISTS scheduled_hours DECIMAL(4,2),
ADD COLUMN IF NOT EXISTS actual_raw_hours DECIMAL(4,2),
ADD COLUMN IF NOT EXISTS ot_requested_hours DECIMAL(4,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS ot_approved BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ot_approved_by TEXT,
ADD COLUMN IF NOT EXISTS ot_approved_at TIMESTAMPTZ;

-- Add index for OT approval queries
CREATE INDEX IF NOT EXISTS idx_attendance_ot_pending 
ON attendance_records(ot_approved) 
WHERE ot_requested_hours > 0;

-- Comment for documentation
COMMENT ON COLUMN attendance_records.scheduled_hours IS 'Hours calculated based on shift schedule (capped to shift duration)';
COMMENT ON COLUMN attendance_records.actual_raw_hours IS 'Actual hours from check_in to check_out without capping';
COMMENT ON COLUMN attendance_records.ot_requested_hours IS 'Overtime hours pending approval (time outside scheduled shift)';
COMMENT ON COLUMN attendance_records.ot_approved IS 'Whether overtime has been approved by manager';
COMMENT ON COLUMN attendance_records.ot_approved_by IS 'User ID who approved the overtime';
COMMENT ON COLUMN attendance_records.ot_approved_at IS 'Timestamp when overtime was approved';
