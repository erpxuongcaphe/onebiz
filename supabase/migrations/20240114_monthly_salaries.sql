-- Monthly Salaries Table
-- Stores editable salary data for each employee per month

CREATE TABLE IF NOT EXISTS monthly_salaries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL, -- YYYY-MM format
    
    -- Base salary (can override employee's default)
    base_salary BIGINT,
    hourly_rate BIGINT,
    hours_worked DECIMAL(5,2) DEFAULT 0,
    
    -- Allowances (editable)
    lunch_allowance BIGINT DEFAULT 0,
    transport_allowance BIGINT DEFAULT 0,
    phone_allowance BIGINT DEFAULT 0,
    other_allowance BIGINT DEFAULT 0,
    
    -- KPI
    kpi_target BIGINT DEFAULT 0,
    kpi_percent INT DEFAULT 100,
    
    -- Bonuses / Penalties
    bonus BIGINT DEFAULT 0,
    penalty BIGINT DEFAULT 0,
    bonus_note TEXT,
    
    -- Deductions (can override calculated values)
    insurance_deduction BIGINT,
    pit_deduction BIGINT,
    
    -- Calculated totals (stored for reporting)
    gross_salary BIGINT DEFAULT 0,
    net_salary BIGINT DEFAULT 0,
    
    -- Status
    is_finalized BOOLEAN DEFAULT false,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(employee_id, month)
);

-- Enable RLS
ALTER TABLE monthly_salaries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "monthly_salaries_read" ON monthly_salaries;
CREATE POLICY "monthly_salaries_read" ON monthly_salaries
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "monthly_salaries_all" ON monthly_salaries;
CREATE POLICY "monthly_salaries_all" ON monthly_salaries
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_monthly_salaries_employee_month ON monthly_salaries(employee_id, month);
CREATE INDEX IF NOT EXISTS idx_monthly_salaries_month ON monthly_salaries(month);
