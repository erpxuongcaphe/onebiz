-- Granular Permission System
-- Tables for managing fine-grained user permissions

-- Permission template by role (default permissions for each role)
CREATE TABLE IF NOT EXISTS permissions_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role, permission_code)
);

-- User-specific permission overrides
CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL,
  granted BOOLEAN DEFAULT true,
  assigned_by TEXT REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, permission_code)
);

-- Enable RLS
ALTER TABLE permissions_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Only admins can manage permissions
CREATE POLICY "Admins can read permission templates" ON permissions_template
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage permission templates" ON permissions_template
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND role = 'admin')
  );

CREATE POLICY "Users can read own permissions" ON user_permissions
  FOR SELECT USING (user_id = auth.uid()::text OR 
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND role = 'admin'));

CREATE POLICY "Admins can manage user permissions" ON user_permissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND role = 'admin')
  );

-- Seed default permissions for Admin (full access)
INSERT INTO permissions_template (role, permission_code) VALUES
  ('admin', 'view_dashboard'),
  ('admin', 'view_personnel'),
  ('admin', 'manage_personnel'),
  ('admin', 'view_timekeeping'),
  ('admin', 'manage_timekeeping'),
  ('admin', 'manual_checkin'),
  ('admin', 'view_schedules'),
  ('admin', 'manage_schedules'),
  ('admin', 'view_salary'),
  ('admin', 'manage_salary'),
  ('admin', 'view_branches'),
  ('admin', 'manage_branches'),
  ('admin', 'view_users'),
  ('admin', 'manage_users'),
  ('admin', 'manage_permissions'),
  ('admin', 'view_settings'),
  ('admin', 'manage_settings')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Seed default permissions for Accountant
INSERT INTO permissions_template (role, permission_code) VALUES
  ('accountant', 'view_dashboard'),
  ('accountant', 'view_personnel'),
  ('accountant', 'view_timekeeping'),
  ('accountant', 'manage_timekeeping'),
  ('accountant', 'view_schedules'),
  ('accountant', 'view_salary'),
  ('accountant', 'manage_salary')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Seed default permissions for Branch Manager
INSERT INTO permissions_template (role, permission_code) VALUES
  ('branch_manager', 'view_dashboard'),
  ('branch_manager', 'view_personnel'),
  ('branch_manager', 'manage_personnel'),
  ('branch_manager', 'view_timekeeping'),
  ('branch_manager', 'manage_timekeeping'),
  ('branch_manager', 'manual_checkin'),
  ('branch_manager', 'view_schedules'),
  ('branch_manager', 'manage_schedules'),
  ('branch_manager', 'view_branches')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Seed default permissions for Member (basic access)
INSERT INTO permissions_template (role, permission_code) VALUES
  ('member', 'view_dashboard'),
  ('member', 'view_schedules')
ON CONFLICT (role, permission_code) DO NOTHING;
