-- =============================================
-- FIX USER ROLE cho toandqq@xuongcaphe.com
-- Chạy trên Supabase Dashboard > SQL Editor
-- =============================================

-- Bước 1: Tìm user ID từ email
DO $$
DECLARE
    v_user_id uuid;
    v_tenant_id uuid := 'b1077f99-fec8-4ff3-aefe-f387225b32a7'; -- Tenant từ screenshot
    v_role_id uuid;
    v_user_email text := 'toandqq@xuongcaphe.com';
BEGIN
    -- Lấy user ID từ auth.users
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_user_email;

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'User % không tìm thấy trong auth.users', v_user_email;
        RETURN;
    END IF;

    RAISE NOTICE 'Found user: % with ID: %', v_user_email, v_user_id;

    -- Bước 2: Đảm bảo có profile
    INSERT INTO public.profiles (id, tenant_id, email, full_name, status)
    VALUES (v_user_id, v_tenant_id, v_user_email, 'Admin', 'active')
    ON CONFLICT (id) DO UPDATE SET tenant_id = v_tenant_id, status = 'active';

    RAISE NOTICE 'Profile created/updated for user %', v_user_email;

    -- Bước 3: Seed default roles nếu chưa có
    PERFORM public.seed_default_roles(v_tenant_id);

    RAISE NOTICE 'Default roles seeded for tenant %', v_tenant_id;

    -- Bước 4: Lấy Super Admin role ID
    SELECT id INTO v_role_id FROM public.roles
    WHERE tenant_id = v_tenant_id AND name = 'Super Admin' LIMIT 1;

    IF v_role_id IS NULL THEN
        RAISE NOTICE 'Super Admin role not found! Creating manually...';
        INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
        VALUES (v_tenant_id, 'Super Admin', 'Full system access', '["*"]'::jsonb, true)
        RETURNING id INTO v_role_id;
    END IF;

    RAISE NOTICE 'Super Admin role ID: %', v_role_id;

    -- Bước 5: Gán Super Admin role cho user
    INSERT INTO public.user_roles (tenant_id, user_id, role_id)
    VALUES (v_tenant_id, v_user_id, v_role_id)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'SUCCESS! User % is now Super Admin', v_user_email;
END $$;

-- Verify kết quả
SELECT
    p.email,
    p.full_name,
    r.name as role_name,
    r.permissions
FROM public.profiles p
LEFT JOIN public.user_roles ur ON ur.user_id = p.id
LEFT JOIN public.roles r ON r.id = ur.role_id
WHERE p.email = 'toandqq@xuongcaphe.com';
