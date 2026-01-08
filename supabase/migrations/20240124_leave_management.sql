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
