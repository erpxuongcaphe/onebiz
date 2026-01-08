-- Payroll System Enhancements
-- Enhanced tracking for payroll history, export, and finalization

-- ==========================================
-- 1. ENHANCE MONTHLY_SALARIES TABLE
-- ==========================================

-- Add payslip number (auto-generated unique identifier)
ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS payslip_number VARCHAR(50);

-- Add export tracking
ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS exported_count INT DEFAULT 0;

ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS last_exported_at TIMESTAMPTZ;

-- Add finalized by name for display (denormalized for performance)
ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS finalized_by_name VARCHAR(255);

-- Create unique index on payslip_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_salaries_payslip_number 
ON monthly_salaries(payslip_number) 
WHERE payslip_number IS NOT NULL;

-- ==========================================
-- 2. FUNCTION: GENERATE PAYSLIP NUMBER
-- ==========================================

CREATE OR REPLACE FUNCTION generate_payslip_number(
    p_month VARCHAR(7),
    p_employee_id VARCHAR(20)
)
RETURNS VARCHAR(50)
LANGUAGE plpgsql
AS $$
DECLARE
    v_year VARCHAR(4);
    v_month_num VARCHAR(2);
    v_sequence INT;
    v_payslip_number VARCHAR(50);
BEGIN
    -- Extract year and month
    v_year := SUBSTRING(p_month FROM 1 FOR 4);
    v_month_num := SUBSTRING(p_month FROM 6 FOR 2);
    
    -- Get next sequence number for this month
    SELECT COALESCE(MAX(CAST(SUBSTRING(payslip_number FROM 13) AS INT)), 0) + 1
    INTO v_sequence
    FROM monthly_salaries
    WHERE month = p_month
    AND payslip_number IS NOT NULL;
    
    -- Format: PS-YYYY-MM-### (e.g., PS-2026-01-001)
    v_payslip_number := 'PS-' || v_year || '-' || v_month_num || '-' || LPAD(v_sequence::TEXT, 3, '0');
    
    RETURN v_payslip_number;
END;
$$;

-- ==========================================
-- 3. TRIGGER: AUTO-GENERATE PAYSLIP NUMBER
-- ==========================================

CREATE OR REPLACE FUNCTION auto_generate_payslip_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only generate if not already set
    IF NEW.payslip_number IS NULL AND NEW.month IS NOT NULL AND NEW.employee_id IS NOT NULL THEN
        NEW.payslip_number := generate_payslip_number(NEW.month, NEW.employee_id);
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_payslip_number ON monthly_salaries;
CREATE TRIGGER trigger_auto_payslip_number
    BEFORE INSERT ON monthly_salaries
    FOR EACH ROW
    EXECUTE FUNCTION auto_generate_payslip_number();

-- ==========================================
-- 4. VIEW: PAYROLL HISTORY SUMMARY
-- ==========================================

CREATE OR REPLACE VIEW payroll_history_view AS
SELECT 
    ms.month,
    ms.branch_id,
    b.name as branch_name,
    COUNT(DISTINCT ms.employee_id) as total_employees,
    SUM(ms.gross_salary) as total_gross_salary,
    SUM(ms.net_salary) as total_net_salary,
    SUM(ms.insurance_deduction) as total_insurance_deduction,
    SUM(ms.pit_deduction) as total_pit_deduction,
    AVG(ms.net_salary) as avg_net_salary,
    COUNT(CASE WHEN ms.is_finalized THEN 1 END) as finalized_count,
    MIN(ms.finalized_at) as first_finalized_at,
    MAX(ms.finalized_at) as last_finalized_at,
    SUM(ms.exported_count) as total_exports
FROM monthly_salaries ms
LEFT JOIN branches b ON b.id = ms.branch_id
GROUP BY ms.month, ms.branch_id, b.name;

-- ==========================================
-- 5. VIEW: EMPLOYEE SALARY HISTORY
-- ==========================================

CREATE OR REPLACE VIEW employee_salary_history_view AS
SELECT 
    ms.employee_id,
    e.name as employee_name,
    e.department,
    e.position,
    ms.month,
    ms.payslip_number,
    ms.base_salary,
    ms.work_days,
    ms.ot_hours,
    ms.gross_salary,
    ms.insurance_deduction,
    ms.pit_deduction,
    ms.net_salary,
    ms.is_finalized,
    ms.finalized_at,
    ms.finalized_by_name,
    ms.exported_count,
    ms.last_exported_at,
    ms.created_at,
    ms.updated_at
FROM monthly_salaries ms
LEFT JOIN employees e ON e.id = ms.employee_id
ORDER BY ms.month DESC, e.name;

-- ==========================================
-- 6. GRANT PERMISSIONS ON VIEWS
-- ==========================================

-- Allow authenticated users to read from views
GRANT SELECT ON payroll_history_view TO authenticated;
GRANT SELECT ON employee_salary_history_view TO authenticated;

-- ==========================================
-- 7. UPDATE EXISTING RECORDS
-- ==========================================

-- Generate payslip numbers for existing records that don't have them
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN 
        SELECT id, month, employee_id 
        FROM monthly_salaries 
        WHERE payslip_number IS NULL
        ORDER BY month, employee_id
    LOOP
        UPDATE monthly_salaries
        SET payslip_number = generate_payslip_number(rec.month, rec.employee_id)
        WHERE id = rec.id;
    END LOOP;
END $$;

-- ==========================================
-- 8. COMMENTS FOR DOCUMENTATION
-- ==========================================

COMMENT ON COLUMN monthly_salaries.payslip_number IS 'Unique payslip identifier in format PS-YYYY-MM-### (auto-generated)';
COMMENT ON COLUMN monthly_salaries.exported_count IS 'Number of times this payslip has been exported';
COMMENT ON COLUMN monthly_salaries.last_exported_at IS 'Timestamp of last export';
COMMENT ON COLUMN monthly_salaries.finalized_by_name IS 'Name of user who finalized this payroll (for display)';

COMMENT ON VIEW payroll_history_view IS 'Summary of payroll by month and branch for history tracking';
COMMENT ON VIEW employee_salary_history_view IS 'Detailed salary history for each employee';

COMMENT ON FUNCTION generate_payslip_number IS 'Generates unique payslip number in format PS-YYYY-MM-###';
