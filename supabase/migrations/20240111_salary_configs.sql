-- Salary Configuration Table
-- Store configurations for different pay types (hourly/monthly)

CREATE TABLE IF NOT EXISTS salary_configs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pay_type VARCHAR(20) NOT NULL CHECK (pay_type IN ('hourly', 'monthly')),
    config_key VARCHAR(100) NOT NULL,
    config_value TEXT,
    description VARCHAR(255),
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pay_type, config_key)
);

-- Insert default configurations for Monthly employees
INSERT INTO salary_configs (pay_type, config_key, config_value, description, sort_order) VALUES
    ('monthly', 'base_salary', '0', 'Lương cơ bản (VND/tháng)', 1),
    ('monthly', 'lunch_allowance', '30000', 'Hỗ trợ cơm trưa (VND/ngày đủ công)', 2),
    ('monthly', 'transport_allowance', '0', 'Hỗ trợ xăng xe (VND/tháng)', 3),
    ('monthly', 'phone_allowance', '0', 'Hỗ trợ điện thoại (VND/tháng)', 4),
    ('monthly', 'other_allowance', '0', 'Hỗ trợ khác (VND/tháng)', 5),
    ('monthly', 'kpi_bonus', '0', 'Thưởng KPI (VND/tháng, nhập tay)', 6),
    ('monthly', 'has_insurance', '1', 'Có đóng BHXH (1=Có, 0=Không)', 9),
    ('monthly', 'bhxh_percent', '8', 'BHXH (% lương đóng BH)', 10),
    ('monthly', 'bhyt_percent', '1.5', 'BHYT (% lương đóng BH)', 11),
    ('monthly', 'bhtn_percent', '1', 'BHTN (% lương đóng BH)', 12),
    ('monthly', 'dependents_count', '0', 'Số người phụ thuộc (cho thuế TNCN)', 13),
    ('monthly', 'min_hours_for_lunch', '7', 'Số giờ tối thiểu để tính hỗ trợ cơm', 14)
ON CONFLICT (pay_type, config_key) DO NOTHING;

-- Insert default configurations for Hourly employees  
INSERT INTO salary_configs (pay_type, config_key, config_value, description, sort_order) VALUES
    ('hourly', 'hourly_rate', '0', 'Mức lương giờ cơ bản (VND/giờ)', 1),
    ('hourly', 'ot_rate_weekday', '1.5', 'Hệ số OT ngày thường', 2),
    ('hourly', 'ot_rate_weekend', '2', 'Hệ số OT cuối tuần', 3),
    ('hourly', 'ot_rate_holiday', '3', 'Hệ số OT ngày lễ', 4),
    ('hourly', 'night_shift_allowance', '0', 'Hỗ trợ ca đêm (VND/ca)', 5),
    ('hourly', 'attendance_bonus', '0', 'Thưởng chuyên cần (VND/tháng)', 6),
    ('hourly', 'has_insurance', '0', 'Có đóng BHXH (1=Có, 0=Không)', 9),
    ('hourly', 'bhxh_percent', '8', 'BHXH (% lương đóng BH)', 10),
    ('hourly', 'bhyt_percent', '1.5', 'BHYT (% lương đóng BH)', 11),
    ('hourly', 'bhtn_percent', '1', 'BHTN (% lương đóng BH)', 12)
ON CONFLICT (pay_type, config_key) DO NOTHING;

-- Enable RLS
ALTER TABLE salary_configs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Everyone can read
DROP POLICY IF EXISTS "salary_configs_read_all" ON salary_configs;
CREATE POLICY "salary_configs_read_all" ON salary_configs
    FOR SELECT USING (true);

-- Admin/Accountant can insert/update/delete
DROP POLICY IF EXISTS "salary_configs_admin_manage" ON salary_configs;

DROP POLICY IF EXISTS "salary_configs_insert" ON salary_configs;
CREATE POLICY "salary_configs_insert" ON salary_configs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid()::text 
            AND users.role IN ('admin', 'accountant')
        )
    );

DROP POLICY IF EXISTS "salary_configs_update" ON salary_configs;
CREATE POLICY "salary_configs_update" ON salary_configs
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid()::text 
            AND users.role IN ('admin', 'accountant')
        )
    );

DROP POLICY IF EXISTS "salary_configs_delete" ON salary_configs;
CREATE POLICY "salary_configs_delete" ON salary_configs
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid()::text 
            AND users.role IN ('admin', 'accountant')
        )
    );

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_salary_configs_pay_type ON salary_configs(pay_type);
