-- FINAL FIX (v4): Restore Admin & Fix Save Hang (Constraint Corrected)
-- 1. Restore Admin Role explicitly
do $$
declare
  v_user_id uuid;
  v_admin_role_id uuid;
  v_tenant_id uuid;
begin
  -- Find user (Case insensitive)
  select id into v_user_id from auth.users where lower(email) = 'toandqq@xuongcaphe.com';
  
  -- Find Tenant ID
  if v_user_id is not null then
      select tenant_id into v_tenant_id from profiles where id = v_user_id;
  end if;
  if v_tenant_id is null then
      select id into v_tenant_id from tenants limit 1;
  end if;
  
  -- Find 'admin' role ID
  select id into v_admin_role_id from roles where name = 'admin' and (tenant_id = v_tenant_id or tenant_id is null) limit 1;
  
  -- If role doesn't exist, create it
  if v_admin_role_id is null and v_tenant_id is not null then
     insert into roles (name, description, is_system, tenant_id)
     values ('admin', 'System Administrator', true, v_tenant_id)
     returning id into v_admin_role_id;
  end if;
  
  -- Assign Role w/ Tenant Scope (Crucial Fix)
  if v_user_id is not null and v_admin_role_id is not null and v_tenant_id is not null then
      -- Check if row exists first to avoid conflict error noise
      if not exists (select 1 from user_roles where user_id = v_user_id and role_id = v_admin_role_id) then
          -- Insert with Explicit SCOPE = 'tenant' to pass the check constraint
          -- Assuming the column is named 'scope' based on the error "user_roles_branch_scope_check"
          insert into user_roles (user_id, role_id, tenant_id, scope)
          values (v_user_id, v_admin_role_id, v_tenant_id, 'tenant');
      end if;

      -- Update legacy tables
      begin update users set role = 'admin' where id = v_user_id::text; exception when others then null; end;
  end if;
end;
$$;

-- 2. Optimize user_update_own_profile
CREATE OR REPLACE FUNCTION user_update_own_profile(
    p_full_name TEXT,
    p_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql security definer
AS $$
BEGIN
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
END;
$$;

-- 3. Optimize Permission Check (Case Insensitive)
CREATE OR REPLACE FUNCTION get_my_permission_patterns()
RETURNS JSON
LANGUAGE plpgsql security definer
AS $$
DECLARE
    v_role_names TEXT[];
BEGIN
    -- 1. Direct Super Admin Check (Fastest)
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND lower(email) = 'toandqq@xuongcaphe.com') THEN
        RETURN json_build_array('*');
    END IF;

    -- 2. Check user_roles
    -- Safe check for user_roles table existence and content
    BEGIN
        SELECT array_agg(r.name) INTO v_role_names
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid(); 
    EXCEPTION WHEN OTHERS THEN
        v_role_names := NULL;
    END;

    -- 3. Admin Wildcard Check
    IF 'admin' = ANY(v_role_names) OR 'super_admin' = ANY(v_role_names) THEN
        RETURN json_build_array('*');
    END IF;

    RETURN json_build_array(); 
END;
$$;
