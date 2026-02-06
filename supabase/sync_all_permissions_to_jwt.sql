-- One-time SQL to sync permissions for ALL users who have roles
-- This ensures existing users (assigned roles before migration 069) have permissions in JWT
-- Run this in Supabase Studio → SQL Editor

DO $$
DECLARE
  rec RECORD;
  v_permissions text[];
BEGIN
  FOR rec IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
  LOOP
    -- Get aggregated permissions
    SELECT COALESCE(array_agg(DISTINCT p ORDER BY p), ARRAY[]::text[])
    INTO v_permissions
    FROM (
      SELECT jsonb_array_elements_text(r.permissions) AS p
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = rec.user_id
    ) perms;

    -- Update metadata (create if not exists)
    UPDATE auth.users
    SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                             || jsonb_build_object('permissions', v_permissions)
    WHERE id = rec.user_id;

    RAISE NOTICE 'Synced user % with permissions %', rec.user_id, v_permissions;
  END LOOP;
END $$;
