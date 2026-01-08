-- Holidays configuration table
-- Bảng cấu hình ngày lễ để admin có thể chỉnh sửa

CREATE TABLE IF NOT EXISTS holidays (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL,
    name TEXT NOT NULL,
    is_recurring BOOLEAN DEFAULT false, -- true = lặp lại hàng năm (dùng tháng-ngày), false = ngày cụ thể
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "holidays_read" ON holidays;
CREATE POLICY "holidays_read" ON holidays FOR SELECT USING (true);

DROP POLICY IF EXISTS "holidays_all" ON holidays;
CREATE POLICY "holidays_all" ON holidays FOR ALL USING (true) WITH CHECK (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

-- Default Vietnamese holidays (recurring)
INSERT INTO holidays (date, name, is_recurring) VALUES
    ('2024-01-01', 'Tết Dương lịch', true),
    ('2024-04-30', 'Giải phóng miền Nam', true),
    ('2024-05-01', 'Quốc tế Lao động', true),
    ('2024-09-02', 'Quốc khánh', true)
ON CONFLICT DO NOTHING;
