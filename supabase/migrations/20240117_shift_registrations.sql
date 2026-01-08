-- Shift Registration System
-- Allow hourly employees to register for shifts each week

-- Main registrations table
CREATE TABLE IF NOT EXISTS shift_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by TEXT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  week_start DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, branch_id, shift_date, shift_id)
);

-- Registration window settings per branch
CREATE TABLE IF NOT EXISTS registration_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  registration_start_day INT DEFAULT 4 CHECK (registration_start_day BETWEEN 0 AND 6),
  registration_start_hour INT DEFAULT 21 CHECK (registration_start_hour BETWEEN 0 AND 23),
  registration_end_day INT DEFAULT 5 CHECK (registration_end_day BETWEEN 0 AND 6),
  registration_end_hour INT DEFAULT 21 CHECK (registration_end_hour BETWEEN 0 AND 23),
  weeks_ahead INT DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(branch_id)
);

-- Enable RLS
ALTER TABLE shift_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_settings ENABLE ROW LEVEL SECURITY;

-- Permissive policies (app-level access control)
CREATE POLICY "Allow all access to shift_registrations" ON shift_registrations FOR ALL USING (true);
CREATE POLICY "Allow all access to registration_settings" ON registration_settings FOR ALL USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_shift_registrations_employee ON shift_registrations(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_registrations_branch ON shift_registrations(branch_id);
CREATE INDEX IF NOT EXISTS idx_shift_registrations_week ON shift_registrations(week_start);
CREATE INDEX IF NOT EXISTS idx_shift_registrations_status ON shift_registrations(status);

-- Insert default global settings (null branch_id = default for all)
INSERT INTO registration_settings (branch_id, registration_start_day, registration_start_hour, registration_end_day, registration_end_hour, weeks_ahead)
VALUES (NULL, 4, 21, 5, 21, 1)
ON CONFLICT DO NOTHING;
