-- FINAL FIX: Restore Admin & Fix Save Hang
-- 1. Restore Admin Role explicitly
do $$
declare
  v_user_id uuid;
  v_admin_role_id uuid; -- Correct type: UUID
begin
  -- Find user (Case insensitive)
  select id into v_user_id from auth.users where lower(email) = 'toandqq@xuongcaphe.com';
  
  -- Find 'admin' role ID by name
  select id into v_admin_role_id from roles where name = 'admin' limit 1;
  
  -- If role doesn't exist, create it with auto-generated UUID
  if v_admin_role_id is null then
     insert into roles (name, description, is_system)
     values ('admin', 'System Administrator', true)
     returning id into v_admin_role_id;
  end if;
  
  -- Assign Role
  if v_user_id is not null and v_admin_role_id is not null then
      -- Insert into user_roles (ensure role_id is UUID)
      insert into user_roles (user_id, role_id)
      values (v_user_id, v_admin_role_id)
  begin
      update users set role = 'admin' where id = v_user_id::text;
  exception when others then null; end;
  
  -- Also update 'profiles' table role column if it exists
  begin
      update profiles set role = 'admin' where id = v_user_id;
  exception when others then null; end;
end;
$$;

-- 2. Optimize user_update_own_profile to be lighter
CREATE OR REPLACE FUNCTION user_update_own_profile(
    p_full_name TEXT,
    p_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql security definer
AS $$
BEGIN
    -- Only try to update users/employees which are certain to exist or important
    -- Update users (Legacy/Auth sync)
    BEGIN
        UPDATE users 
        SET full_name = COALESCE(p_full_name, full_name)
        WHERE id = auth.uid()::text;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Update linked employee (Business Logic)
    BEGIN
        UPDATE employees e
        SET 
            name = COALESCE(p_full_name, name),
            phone = COALESCE(p_phone, phone)
        FROM users u
        WHERE u.id = auth.uid()::text AND u.employee_id = e.id;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    
    -- We skip 'profiles' update if it causes deadlock/hangs, assuming 'users' is the Single Source of Truth for this app version
END;
$$;

-- 3. Optimize Permission Check (Case Insensitive)
CREATE OR REPLACE FUNCTION get_my_permission_patterns()
RETURNS JSON
LANGUAGE plpgsql security definer
AS $$
DECLARE
    v_role_names TEXT[];
    v_permissions TEXT[];
BEGIN
    -- 1. Direct Super Admin Check (Fastest) - Case Insensitive
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND lower(email) = 'toandqq@xuongcaphe.com') THEN
        RETURN json_build_array('*');
    END IF;

    -- 2. Check user_roles (Standard)
    SELECT array_agg(r.name) INTO v_role_names
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid(); 

    -- 3. If empty, try legacy users table (Fallback)
    IF v_role_names IS NULL THEN
        BEGIN
            SELECT ARRAY[role] INTO v_role_names FROM users WHERE id = auth.uid()::text;
        EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    -- 4. Return result
    IF 'admin' = ANY(v_role_names) OR 'super_admin' = ANY(v_role_names) THEN
        RETURN json_build_array('*');
    END IF;

    SELECT array_agg(permission_code) INTO v_permissions
    FROM permissions_template
    WHERE role = ANY(v_role_names);

    RETURN to_json(COALESCE(v_permissions, ARRAY[]::TEXT[]));
END;
$$;
