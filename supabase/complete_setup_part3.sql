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
-- Refactor Employee Type System
-- Gộp employment_type và pay_type thành employee_type
-- Values: full_time_monthly, full_time_hourly, part_time, probation, intern

-- Step 1: Add new employee_type column
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'employee_type') THEN
        ALTER TABLE employees ADD COLUMN employee_type VARCHAR(30) DEFAULT 'full_time_monthly';
    END IF;
END $$;

-- Step 2: Add CHECK constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE constraint_name = 'employees_employee_type_check') THEN
        ALTER TABLE employees ADD CONSTRAINT employees_employee_type_check 
        CHECK (employee_type IN ('full_time_monthly', 'full_time_hourly', 'part_time', 'probation', 'intern'));
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        NULL; -- Constraint already exists
END $$;

-- Step 3: Migrate existing data
UPDATE employees SET employee_type = 
    CASE 
        -- Hourly workers (check pay_type first)
        WHEN pay_type = 'hourly' THEN 'full_time_hourly'
        -- Probation status
        WHEN status = 'probation' THEN 'probation'
        -- Interns
        WHEN employment_type = 'intern' THEN 'intern'
        -- Part-time
        WHEN employment_type = 'part_time' THEN 'part_time'
        -- Contract workers - treat as full_time_monthly
        WHEN employment_type = 'contract' THEN 'full_time_monthly'
        -- Default: full_time_monthly
        ELSE 'full_time_monthly'
    END
WHERE employee_type IS NULL OR employee_type = 'full_time_monthly';

-- Step 4: Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_employees_employee_type ON employees(employee_type);

-- Note: We keep the old columns (employment_type, pay_type) for now
-- They can be dropped in a future migration after confirming everything works
-- Leave Management System
-- Quản lý nghỉ phép cho nhân viên

-- =====================================================
-- 1. LEAVE TYPES (Loại nghỉ phép)
-- =====================================================
CREATE TABLE IF NOT EXISTS leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT '#3B82F6', -- For UI display
    default_days_per_year INTEGER DEFAULT 12, -- Số ngày mặc định/năm
    is_paid BOOLEAN DEFAULT TRUE, -- Có lương hay không
    requires_approval BOOLEAN DEFAULT TRUE, -- Cần duyệt không
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default leave types
INSERT INTO leave_types (name, description, color, default_days_per_year, is_paid) VALUES
    ('Nghỉ phép năm', 'Phép năm theo quy định', '#3B82F6', 12, TRUE),
    ('Nghỉ ốm', 'Nghỉ do bệnh tật', '#EF4444', 30, TRUE),
    ('Nghỉ việc riêng', 'Nghỉ việc cá nhân có lương', '#F59E0B', 3, TRUE),
    ('Nghỉ không lương', 'Nghỉ việc riêng không lương', '#6B7280', 0, FALSE),
    ('Nghỉ thai sản', 'Nghỉ sinh con (nữ)', '#EC4899', 180, TRUE),
    ('Nghỉ cưới', 'Nghỉ kết hôn', '#8B5CF6', 3, TRUE),
    ('Nghỉ tang', 'Nghỉ khi có người thân mất', '#1F2937', 3, TRUE)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 2. LEAVE BALANCES (Số ngày phép còn lại)
-- =====================================================
CREATE TABLE IF NOT EXISTS leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
    total_days DECIMAL(5,1) NOT NULL DEFAULT 0, -- Tổng số ngày được phép
    used_days DECIMAL(5,1) NOT NULL DEFAULT 0, -- Số ngày đã sử dụng
    pending_days DECIMAL(5,1) NOT NULL DEFAULT 0, -- Số ngày đang chờ duyệt
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, leave_type_id, year)
);

-- =====================================================
-- 3. LEAVE REQUESTS (Đơn xin nghỉ phép)
-- =====================================================
CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days DECIMAL(5,1) NOT NULL, -- Số ngày nghỉ
    is_half_day BOOLEAN DEFAULT FALSE, -- Nghỉ nửa ngày
    half_day_period VARCHAR(20), -- 'morning' or 'afternoon'
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, cancelled
    reviewed_by VARCHAR(20) REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 4. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_year ON leave_balances(year);

-- =====================================================
-- 5. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- Policies for leave_types (everyone can read, only admin can modify)
CREATE POLICY "leave_types_read" ON leave_types FOR SELECT USING (true);
CREATE POLICY "leave_types_admin" ON leave_types FOR ALL USING (true);

-- Policies for leave_balances
CREATE POLICY "leave_balances_read" ON leave_balances FOR SELECT USING (true);
CREATE POLICY "leave_balances_admin" ON leave_balances FOR ALL USING (true);

-- Policies for leave_requests
CREATE POLICY "leave_requests_read" ON leave_requests FOR SELECT USING (true);
CREATE POLICY "leave_requests_admin" ON leave_requests FOR ALL USING (true);

-- =====================================================
-- 6. TRIGGER for auto-update leave balances
-- =====================================================
CREATE OR REPLACE FUNCTION update_leave_balance_on_request()
RETURNS TRIGGER AS $$
BEGIN
    -- When a leave request is approved, update used_days
    IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
        UPDATE leave_balances 
        SET used_days = used_days + NEW.total_days,
            pending_days = pending_days - NEW.total_days,
            updated_at = NOW()
        WHERE employee_id = NEW.employee_id 
          AND leave_type_id = NEW.leave_type_id
          AND year = EXTRACT(YEAR FROM NEW.start_date);
    END IF;
    
    -- When a leave request is rejected or cancelled, reduce pending_days
    IF NEW.status IN ('rejected', 'cancelled') AND OLD.status = 'pending' THEN
        UPDATE leave_balances 
        SET pending_days = pending_days - NEW.total_days,
            updated_at = NOW()
        WHERE employee_id = NEW.employee_id 
          AND leave_type_id = NEW.leave_type_id
          AND year = EXTRACT(YEAR FROM NEW.start_date);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_leave_balance ON leave_requests;
CREATE TRIGGER trigger_update_leave_balance
    AFTER UPDATE ON leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_leave_balance_on_request();

-- =====================================================
-- 7. TRIGGER for adding pending_days when creating request
-- =====================================================
CREATE OR REPLACE FUNCTION add_pending_leave_on_create()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure balance exists for this employee/type/year
    INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days)
    SELECT NEW.employee_id, NEW.leave_type_id, EXTRACT(YEAR FROM NEW.start_date)::INTEGER, 
           COALESCE(lt.default_days_per_year, 12), 0, NEW.total_days
    FROM leave_types lt WHERE lt.id = NEW.leave_type_id
    ON CONFLICT (employee_id, leave_type_id, year) 
    DO UPDATE SET pending_days = leave_balances.pending_days + NEW.total_days,
                  updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_add_pending_leave ON leave_requests;
CREATE TRIGGER trigger_add_pending_leave
    AFTER INSERT ON leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION add_pending_leave_on_create();
-- Notification System
-- Thông báo tự động cho người dùng

-- =====================================================
-- 1. NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- birthday, contract_expiry, leave_approved, attendance_reminder, etc.
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    link VARCHAR(255), -- Optional link to navigate to
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    metadata JSONB, -- Additional data (employee_id, leave_request_id, etc.)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. NOTIFICATION SETTINGS (per user preferences)
-- =====================================================
CREATE TABLE IF NOT EXISTS notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    birthday_notifications BOOLEAN DEFAULT TRUE,
    contract_expiry_notifications BOOLEAN DEFAULT TRUE,
    leave_notifications BOOLEAN DEFAULT TRUE,
    attendance_reminders BOOLEAN DEFAULT TRUE,
    salary_notifications BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- =====================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

-- Users can only read their own notifications
CREATE POLICY "notifications_own" ON notifications 
    FOR ALL USING (true);

CREATE POLICY "notification_settings_own" ON notification_settings 
    FOR ALL USING (true);

-- =====================================================
-- 5. VIEW for unread count
-- =====================================================
CREATE OR REPLACE VIEW notification_unread_counts AS
SELECT 
    user_id,
    COUNT(*) as unread_count
FROM notifications
WHERE is_read = FALSE
GROUP BY user_id;
-- Performance Review System
-- Hệ thống đánh giá hiệu suất nhân viên

-- =====================================================
-- 1. REVIEW CYCLES (Chu kỳ đánh giá)
-- =====================================================
CREATE TABLE IF NOT EXISTS review_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    review_deadline DATE NOT NULL,
    cycle_type VARCHAR(20) DEFAULT 'quarterly', -- monthly, quarterly, annually
    status VARCHAR(20) DEFAULT 'draft', -- draft, active, completed, cancelled
    created_by VARCHAR(20) REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. REVIEW CRITERIA (Tiêu chí đánh giá)
-- =====================================================
CREATE TABLE IF NOT EXISTS review_criteria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL, -- performance, attitude, skills, teamwork
    weight DECIMAL(5,2) DEFAULT 1.0, -- Trọng số
    max_score INTEGER DEFAULT 5,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default criteria
INSERT INTO review_criteria (name, description, category, weight) VALUES
    ('Hoàn thành công việc', 'Mức độ hoàn thành các nhiệm vụ được giao', 'performance', 2.0),
    ('Chất lượng công việc', 'Độ chính xác và chất lượng kết quả', 'performance', 2.0),
    ('Đúng giờ', 'Tuân thủ thời gian làm việc', 'attitude', 1.0),
    ('Thái độ làm việc', 'Sự nhiệt tình và trách nhiệm', 'attitude', 1.5),
    ('Kỹ năng chuyên môn', 'Trình độ và kỹ năng nghề nghiệp', 'skills', 1.5),
    ('Khả năng học hỏi', 'Tiếp thu kiến thức và kỹ năng mới', 'skills', 1.0),
    ('Làm việc nhóm', 'Khả năng phối hợp với đồng nghiệp', 'teamwork', 1.0),
    ('Giao tiếp', 'Kỹ năng giao tiếp và trình bày', 'teamwork', 1.0)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. PERFORMANCE REVIEWS (Kết quả đánh giá)
-- =====================================================
CREATE TABLE IF NOT EXISTS performance_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    reviewer_id VARCHAR(20) REFERENCES users(id),
    review_type VARCHAR(20) DEFAULT 'manager', -- self, manager, peer
    status VARCHAR(20) DEFAULT 'pending', -- pending, submitted, reviewed, final
    overall_score DECIMAL(5,2),
    overall_rating VARCHAR(20), -- excellent, good, average, needs_improvement, poor
    strengths TEXT,
    improvements TEXT,
    goals TEXT,
    manager_comments TEXT,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cycle_id, employee_id, review_type)
);

-- =====================================================
-- 4. REVIEW SCORES (Điểm chi tiết từng tiêu chí)
-- =====================================================
CREATE TABLE IF NOT EXISTS review_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
    criteria_id UUID NOT NULL REFERENCES review_criteria(id),
    score INTEGER CHECK (score >= 0 AND score <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(review_id, criteria_id)
);

-- =====================================================
-- 5. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_review_cycles_status ON review_cycles(status);
CREATE INDEX IF NOT EXISTS idx_reviews_employee ON performance_reviews(employee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_cycle ON performance_reviews(cycle_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON performance_reviews(status);

-- =====================================================
-- 6. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_scores ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "review_cycles_read" ON review_cycles FOR SELECT USING (true);
CREATE POLICY "review_cycles_admin" ON review_cycles FOR ALL USING (true);

CREATE POLICY "review_criteria_read" ON review_criteria FOR SELECT USING (true);
CREATE POLICY "review_criteria_admin" ON review_criteria FOR ALL USING (true);

CREATE POLICY "reviews_read" ON performance_reviews FOR SELECT USING (true);
CREATE POLICY "reviews_admin" ON performance_reviews FOR ALL USING (true);

CREATE POLICY "scores_read" ON review_scores FOR SELECT USING (true);
CREATE POLICY "scores_admin" ON review_scores FOR ALL USING (true);

-- =====================================================
-- 7. FUNCTION to calculate overall rating
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_review_rating(p_score DECIMAL)
RETURNS VARCHAR(20) AS $$
BEGIN
    IF p_score >= 4.5 THEN
        RETURN 'excellent';
    ELSIF p_score >= 3.5 THEN
        RETURN 'good';
    ELSIF p_score >= 2.5 THEN
        RETURN 'average';
    ELSIF p_score >= 1.5 THEN
        RETURN 'needs_improvement';
    ELSE
        RETURN 'poor';
    END IF;
END;
$$ LANGUAGE plpgsql;
-- Enhanced Employee Profile - Documents & History
-- Quản lý tài liệu và lịch sử nhân viên

-- =====================================================
-- 1. EMPLOYEE DOCUMENTS (Tài liệu nhân viên)
-- =====================================================
CREATE TABLE IF NOT EXISTS employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL, -- identity_card, degree, certificate, contract, other
    name VARCHAR(255) NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL, -- Supabase Storage URL
    file_type VARCHAR(50), -- pdf, jpg, png, doc
    file_size INTEGER, -- bytes
    uploaded_by VARCHAR(20) REFERENCES users(id),
    issue_date DATE,
    expiry_date DATE,
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR(20) REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. EMPLOYEE HISTORY (Lịch sử nhân viên)
-- =====================================================
CREATE TABLE IF NOT EXISTS employee_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- hired, promoted, transferred, salary_change, warning, terminated
    event_date DATE NOT NULL,
    description TEXT NOT NULL,
    old_value TEXT, -- For tracking changes (e.g., old position, old salary)
    new_value TEXT, -- New value after change
    metadata JSONB, -- Additional data
    created_by VARCHAR(20) REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_type ON employee_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_employee_history_employee ON employee_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_history_event_type ON employee_history(event_type);
CREATE INDEX IF NOT EXISTS idx_employee_history_date ON employee_history(event_date DESC);

-- =====================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_history ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "employee_documents_read" ON employee_documents FOR SELECT USING (true);
CREATE POLICY "employee_documents_admin" ON employee_documents FOR ALL USING (true);

CREATE POLICY "employee_history_read" ON employee_history FOR SELECT USING (true);
CREATE POLICY "employee_history_admin" ON employee_history FOR ALL USING (true);

-- =====================================================
-- 5. TRIGGER to auto-log employee changes
-- =====================================================
CREATE OR REPLACE FUNCTION log_employee_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Log position changes
    IF OLD.position IS DISTINCT FROM NEW.position THEN
        INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
        VALUES (NEW.id, 'promoted', CURRENT_DATE, 'Thay đổi chức vụ', OLD.position, NEW.position);
    END IF;
    
    -- Log department changes
    IF OLD.department IS DISTINCT FROM NEW.department THEN
        INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
        VALUES (NEW.id, 'transferred', CURRENT_DATE, 'Chuyển phòng ban', OLD.department, NEW.department);
    END IF;
    
    -- Log salary changes
    IF OLD.salary IS DISTINCT FROM NEW.salary THEN
        INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
        VALUES (NEW.id, 'salary_change', CURRENT_DATE, 'Điều chỉnh lương', OLD.salary::TEXT, NEW.salary::TEXT);
    END IF;
    
    -- Log status changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = 'inactive' THEN
            INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
            VALUES (NEW.id, 'terminated', CURRENT_DATE, 'Nghỉ việc', OLD.status, NEW.status);
        ELSE
            INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
            VALUES (NEW.id, 'hired', CURRENT_DATE, 'Thay đổi trạng thái', OLD.status, NEW.status);
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_employee_changes ON employees;
CREATE TRIGGER trigger_log_employee_changes
    AFTER UPDATE ON employees
    FOR EACH ROW
    EXECUTE FUNCTION log_employee_changes();

-- =====================================================
-- 6. Insert initial hire record for existing employees
-- =====================================================
-- This can be run once to initialize history for existing employees
-- INSERT INTO employee_history (employee_id, event_type, event_date, description)
-- SELECT id, 'hired', join_date::DATE, 'Ngày vào làm'
-- FROM employees
-- WHERE id NOT IN (SELECT DISTINCT employee_id FROM employee_history WHERE event_type = 'hired');
-- Migration: Add overtime system fields to attendance_records
-- Created: 2024-01-28

-- Add OT-related fields to attendance_records table
ALTER TABLE attendance_records 
ADD COLUMN IF NOT EXISTS scheduled_hours DECIMAL(4,2),
ADD COLUMN IF NOT EXISTS actual_raw_hours DECIMAL(4,2),
ADD COLUMN IF NOT EXISTS ot_requested_hours DECIMAL(4,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS ot_approved BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ot_approved_by TEXT,
ADD COLUMN IF NOT EXISTS ot_approved_at TIMESTAMPTZ;

-- Add index for OT approval queries
CREATE INDEX IF NOT EXISTS idx_attendance_ot_pending 
ON attendance_records(ot_approved) 
WHERE ot_requested_hours > 0;

-- Comment for documentation
COMMENT ON COLUMN attendance_records.scheduled_hours IS 'Hours calculated based on shift schedule (capped to shift duration)';
COMMENT ON COLUMN attendance_records.actual_raw_hours IS 'Actual hours from check_in to check_out without capping';
COMMENT ON COLUMN attendance_records.ot_requested_hours IS 'Overtime hours pending approval (time outside scheduled shift)';
COMMENT ON COLUMN attendance_records.ot_approved IS 'Whether overtime has been approved by manager';
COMMENT ON COLUMN attendance_records.ot_approved_by IS 'User ID who approved the overtime';
COMMENT ON COLUMN attendance_records.ot_approved_at IS 'Timestamp when overtime was approved';
-- Add department column to review_criteria
-- Allows criteria to be department-specific
-- NULL = applies to all departments

ALTER TABLE review_criteria 
ADD COLUMN IF NOT EXISTS department VARCHAR(100) DEFAULT NULL;

-- Create index for faster department lookups
CREATE INDEX IF NOT EXISTS idx_review_criteria_department ON review_criteria(department);

COMMENT ON COLUMN review_criteria.department IS 'Department this criteria applies to. NULL means all departments.';
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
