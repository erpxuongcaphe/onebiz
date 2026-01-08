-- Add standard_work_days and detailed work info to monthly_salaries
-- Date: 2026-01-04
-- Author: Assistant

ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS standard_work_days NUMERIC DEFAULT 26,
ADD COLUMN IF NOT EXISTS actual_work_days NUMERIC,
ADD COLUMN IF NOT EXISTS paid_leave_days NUMERIC;

COMMENT ON COLUMN monthly_salaries.standard_work_days IS 'Ngày công chuẩn của tháng (dùng để tính lương ngày)';
COMMENT ON COLUMN monthly_salaries.actual_work_days IS 'Ngày đi làm thực tế';
COMMENT ON COLUMN monthly_salaries.paid_leave_days IS 'Ngày nghỉ phép có lương';
