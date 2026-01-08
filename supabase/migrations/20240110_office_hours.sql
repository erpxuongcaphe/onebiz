-- ============================================
-- OFFICE HOURS DEFAULT SHIFT
-- Giờ hành chính cho nhân viên lương tháng
-- Run this script in Supabase SQL Editor
-- ============================================

-- 1. Tạo ca "Giờ hành chính" cho tất cả chi nhánh văn phòng (is_office = true)
-- Thứ 2 - Thứ 7: 8:00 - 17:30 (nghỉ trưa 12:00 - 13:30 = 1.5h)
-- Thực làm: 8h (8:00-12:00 = 4h + 13:30-17:30 = 4h)

INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate, is_active)
SELECT 
    b.id,
    'Giờ hành chính',
    '08:00'::TIME,
    '17:30'::TIME,
    0,  -- Lương tháng không tính theo giờ
    true
FROM branches b 
WHERE b.is_office = true
ON CONFLICT DO NOTHING;

-- 2. Tạo bảng cấu hình giờ hành chính (để admin có thể thay đổi)
CREATE TABLE IF NOT EXISTS office_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key VARCHAR(50) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by VARCHAR(20)
);

-- 3. Insert cấu hình mặc định
INSERT INTO office_settings (key, value, description) VALUES
    ('office_start_time', '08:00', 'Giờ bắt đầu làm việc'),
    ('office_end_time', '17:30', 'Giờ kết thúc làm việc'),
    ('lunch_start_time', '12:00', 'Giờ nghỉ trưa bắt đầu'),
    ('lunch_end_time', '13:30', 'Giờ nghỉ trưa kết thúc'),
    ('work_days', '1,2,3,4,5,6', 'Các ngày làm việc (0=CN, 1=T2, ..., 6=T7)')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW();

-- Enable RLS
ALTER TABLE office_settings ENABLE ROW LEVEL SECURITY;

-- RLS policy
DROP POLICY IF EXISTS "Enable all access for office_settings" ON office_settings;
CREATE POLICY "Enable all access for office_settings" ON office_settings FOR ALL USING (true);

-- Comments
COMMENT ON TABLE office_settings IS 'Cấu hình giờ hành chính - có thể thay đổi bởi Admin';
COMMENT ON COLUMN office_settings.work_days IS 'Các ngày làm việc: 0=Chủ nhật, 1=Thứ 2, 2=Thứ 3, ...';
