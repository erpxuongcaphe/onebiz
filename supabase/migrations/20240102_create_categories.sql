-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add unique constraint if not exists (for existing tables)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'departments_name_key'
    ) THEN
        ALTER TABLE departments ADD CONSTRAINT departments_name_key UNIQUE (name);
    END IF;
END $$;

-- Create positions table
CREATE TABLE IF NOT EXISTS positions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add unique constraint if not exists (for existing tables)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'positions_name_key'
    ) THEN
        ALTER TABLE positions ADD CONSTRAINT positions_name_key UNIQUE (name);
    END IF;
END $$;

-- Insert default departments (only if not exists)
INSERT INTO departments (name)
SELECT name FROM (VALUES 
    ('Kỹ thuật'),
    ('Nhân sự'),
    ('Kinh doanh'),
    ('Kế toán'),
    ('Marketing'),
    ('Ban giám đốc'),
    ('Hành chính')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.name = v.name);

-- Insert default positions (only if not exists)
INSERT INTO positions (name)
SELECT name FROM (VALUES 
    ('Nhân viên'),
    ('Trưởng nhóm'),
    ('Trưởng phòng'),
    ('Phó giám đốc'),
    ('Giám đốc'),
    ('Developer'),
    ('Senior Developer'),
    ('HR Manager'),
    ('Accountant'),
    ('Marketing Specialist'),
    ('Sales Executive')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE p.name = v.name);

-- Enable RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then create new ones
DROP POLICY IF EXISTS "Enable all access for departments" ON departments;
DROP POLICY IF EXISTS "Enable all access for positions" ON positions;

CREATE POLICY "Enable all access for departments" ON departments FOR ALL USING (true);
CREATE POLICY "Enable all access for positions" ON positions FOR ALL USING (true);
