-- Create employees table if it doesn't exist
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    department TEXT,
    position TEXT,
    phone TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'probation', 'inactive')),
    join_date DATE,
    address TEXT, -- Combined address or general address
    avatar TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Extended fields
    date_of_birth DATE,
    identity_card TEXT,
    address_street TEXT,
    address_ward TEXT,
    address_district TEXT,
    address_city TEXT,
    employment_type TEXT DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
    termination_date DATE,
    salary NUMERIC,
    uniform_cost NUMERIC,
    uniform_issue_date DATE,
    uniform_expiry_date DATE,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    notes TEXT
);

-- Enable Row Level Security
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations (Select, Insert, Update, Delete)
-- Warning: This is for development/internal use. In production, you'd want stricter policies based on user roles.
DROP POLICY IF EXISTS "Enable all access for all users" ON employees;
CREATE POLICY "Enable all access for all users" ON employees
    FOR ALL
    USING (true)
    WITH CHECK (true);
