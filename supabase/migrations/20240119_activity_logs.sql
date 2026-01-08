-- ============================================
-- ACTIVITY LOGS TABLE
-- Lịch sử thao tác trên hệ thống
-- ============================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,        -- Ai thực hiện
    user_name VARCHAR(100),              -- Tên người thực hiện
    user_role VARCHAR(20),               -- Role của người thực hiện
    action VARCHAR(20) NOT NULL,         -- create, update, delete
    entity_type VARCHAR(50) NOT NULL,    -- employee, user, branch, shift, attendance, etc.
    entity_id VARCHAR(100),              -- ID của đối tượng
    entity_name VARCHAR(200),            -- Tên/label của đối tượng
    details JSONB,                       -- Chi tiết thay đổi (old/new values)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS policy - all access (filtering done at application layer)
DROP POLICY IF EXISTS "Enable all access for activity_logs" ON activity_logs;
CREATE POLICY "Enable all access for activity_logs" ON activity_logs FOR ALL USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_type ON activity_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_role ON activity_logs(user_role);

-- Comments
COMMENT ON TABLE activity_logs IS 'Lịch sử thao tác trên hệ thống';
COMMENT ON COLUMN activity_logs.action IS 'Loại thao tác: create, update, delete';
COMMENT ON COLUMN activity_logs.entity_type IS 'Loại đối tượng: employee, user, branch, shift, attendance, salary...';
COMMENT ON COLUMN activity_logs.details IS 'Chi tiết thay đổi dạng JSON';
