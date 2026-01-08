-- Add kpi_bonus column to monthly_salaries table to store the actual monetary value
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS kpi_bonus numeric DEFAULT 0;

-- Comment on column for clarity
COMMENT ON COLUMN monthly_salaries.kpi_bonus IS 'Actual monetary bonus received based on KPI performance, distinct from the kpi_target (goal)';