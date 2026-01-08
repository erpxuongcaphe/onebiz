-- Work Hour Requirements by Employment Type
-- Quy định giờ làm tối thiểu theo loại hình nhân viên

CREATE TABLE IF NOT EXISTS work_hour_requirements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employment_type TEXT NOT NULL UNIQUE,
    min_hours_per_month DECIMAL(6,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE work_hour_requirements ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "work_hour_requirements_read" ON work_hour_requirements;
CREATE POLICY "work_hour_requirements_read" ON work_hour_requirements
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "work_hour_requirements_all" ON work_hour_requirements;
CREATE POLICY "work_hour_requirements_all" ON work_hour_requirements
    FOR ALL USING (true) WITH CHECK (true);

-- Default values
INSERT INTO work_hour_requirements (employment_type, min_hours_per_month, description) VALUES
    ('full_time', 176, 'Nhân viên toàn thời gian - 8h/ngày x 22 ngày'),
    ('part_time', 88, 'Nhân viên bán thời gian - 4h/ngày x 22 ngày'),
    ('contract', 160, 'Nhân viên hợp đồng'),
    ('intern', 120, 'Thực tập sinh - 6h/ngày x 20 ngày')
ON CONFLICT (employment_type) DO NOTHING;
