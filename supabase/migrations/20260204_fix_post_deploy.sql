-- 1. Function: get_my_permission_patterns
-- Used by: lib/rbac.ts
-- FIX: Post-deployment issues (Permissions Hang, Company Save, User Profile)
-- CORRECTED VERSION: Uses 'user_roles' and 'profiles' tables instead of 'users'.

-- 1. Function: get_my_permission_patterns
DROP FUNCTION IF EXISTS get_my_permission_patterns();

CREATE OR REPLACE FUNCTION get_my_permission_patterns()
RETURNS JSON
LANGUAGE plpgsql security definer
AS $$
DECLARE
    v_role_names TEXT[];
    v_permissions TEXT[];
BEGIN
    -- Get role names for the current user
    SELECT array_agg(r.name) INTO v_role_names
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid(); -- ur.user_id is likely UUID

    -- If no roles, return empty
    IF v_role_names IS NULL THEN
        RETURN json_build_array();
    END IF;

    -- If any role is 'admin', return wildcard
    IF 'admin' = ANY(v_role_names) OR 'super_admin' = ANY(v_role_names) THEN
        RETURN json_build_array('*');
    END IF;

    -- Aggregate permissions from all roles
    -- Assuming roles table has 'permissions' column as text array (based on lib/roles.ts)
    SELECT array_agg(DISTINCT p) INTO v_permissions
    FROM (
        SELECT unnest(permissions) as p
        FROM roles r
        JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid()
    ) sub;

    RETURN to_json(COALESCE(v_permissions, ARRAY[]::TEXT[]));
END;
$$;

-- 2. Function: update_company_settings (and table)
CREATE TABLE IF NOT EXISTS company_info (
    id BOOL PRIMARY KEY DEFAULT TRUE,
    name TEXT,
    tax_code TEXT,
    address TEXT,
    phone TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT company_info_singleton CHECK (id)
);

ALTER TABLE company_info ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read access for all users" ON company_info;
CREATE POLICY "Enable read access for all users" ON company_info FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable update access for admins" ON company_info;
CREATE POLICY "Enable update access for admins" ON company_info FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
);

INSERT INTO company_info (name, tax_code, address, phone)
VALUES ('OneBiz ERP', '', '', '')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION update_company_settings(
    p_name TEXT,
    p_tax_code TEXT,
    p_address TEXT,
    p_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql security definer
AS $$
BEGIN
    -- Check admin permission
    IF NOT EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    INSERT INTO company_info (id, name, tax_code, address, phone, updated_at)
    VALUES (TRUE, p_name, p_tax_code, p_address, p_phone, NOW())
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        tax_code = EXCLUDED.tax_code,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        updated_at = NOW();
END;
$$;

-- 3. Function: admin_update_user_profile
CREATE OR REPLACE FUNCTION admin_update_user_profile(
    p_user_id TEXT,
    p_full_name TEXT,
    p_phone TEXT,
    p_email TEXT
)
RETURNS VOID
LANGUAGE plpgsql security definer
AS $$
BEGIN
    -- Check admin permission
    IF NOT EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Update profiles table (Using UUID cast if needed)
    UPDATE profiles
    SET 
        full_name = COALESCE(p_full_name, full_name),
        email = COALESCE(p_email, email)
        -- Add phone if it exists in profiles, otherwise ignore or update linked employee
    WHERE id = p_user_id::uuid;

    -- Try update linked employee if possible (optional, depends on schema)
    -- UPDATE employees SET ...
END;
$$;

-- 4. Function: user_update_own_profile
CREATE OR REPLACE FUNCTION user_update_own_profile(
    p_full_name TEXT,
    p_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql security definer
AS $$
BEGIN
    -- Update own profile
    UPDATE profiles
    SET full_name = COALESCE(p_full_name, full_name)
    WHERE id = auth.uid();
END;
$$;
