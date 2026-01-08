-- Add salary details to employees table
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS kpi_target BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS lunch_allowance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS transport_allowance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS phone_allowance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS other_allowance BIGINT DEFAULT 0;

-- Comment on columns
COMMENT ON COLUMN employees.kpi_target IS 'Mục tiêu KPI (VND)';
COMMENT ON COLUMN employees.lunch_allowance IS 'Hỗ trợ cơm trưa (VND/ngày)';
COMMENT ON COLUMN employees.transport_allowance IS 'Hỗ trợ xăng xe (VND/tháng)';
COMMENT ON COLUMN employees.phone_allowance IS 'Hỗ trợ điện thoại (VND/tháng)';
COMMENT ON COLUMN employees.other_allowance IS 'Hỗ trợ khác (VND/tháng)';
