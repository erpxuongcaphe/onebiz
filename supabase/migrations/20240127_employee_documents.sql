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
