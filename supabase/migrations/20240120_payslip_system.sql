-- Payslip System Enhancement
-- 1. Payslip templates for each branch
-- 2. Additional fields for monthly_salaries

-- ==========================================
-- 1. PAYSLIP TEMPLATES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS payslip_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    
    -- Company Information
    company_name TEXT NOT NULL,
    company_address TEXT,
    company_phone TEXT,
    company_email TEXT,
    company_tax_code TEXT,
    logo_url TEXT,
    
    -- Custom text
    header_text TEXT,
    footer_text TEXT,
    
    -- Settings
    is_default BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One template per branch max
    UNIQUE(branch_id)
);

-- Enable RLS
ALTER TABLE payslip_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "payslip_templates_read" ON payslip_templates;
CREATE POLICY "payslip_templates_read" ON payslip_templates
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "payslip_templates_all" ON payslip_templates;
CREATE POLICY "payslip_templates_all" ON payslip_templates
    FOR ALL USING (true) WITH CHECK (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_payslip_templates_branch ON payslip_templates(branch_id);

-- ==========================================
-- 2. ADD COLUMNS TO MONTHLY_SALARIES
-- ==========================================

-- Work time details
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS work_days INT DEFAULT 0;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS regular_hours DECIMAL(6,2) DEFAULT 0;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS ot_hours DECIMAL(6,2) DEFAULT 0;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS late_count INT DEFAULT 0;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS early_leave_count INT DEFAULT 0;

-- Finalization info
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS finalized_by UUID;

-- Branch reference for template lookup
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- Index for finalized lookup
CREATE INDEX IF NOT EXISTS idx_monthly_salaries_finalized ON monthly_salaries(is_finalized, month);

-- ==========================================
-- 3. DEFAULT TEMPLATE (if no branch-specific)
-- ==========================================
INSERT INTO payslip_templates (branch_id, company_name, company_address, is_default)
VALUES (NULL, 'Công ty TNHH HRM', 'Địa chỉ công ty', true)
ON CONFLICT DO NOTHING;
