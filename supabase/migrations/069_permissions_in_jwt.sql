-- Fix RLS permission issue by caching permissions in JWT
--
-- Root cause: RLS policies on user_roles table block SECURITY DEFINER functions
--             from querying permissions, even with auth.uid() validation.
--             Supabase managed DB doesn't allow BYPASSRLS on postgres role.
--
-- Solution: Store permissions in auth.users.raw_user_meta_data (appears in JWT)
--           → Frontend reads from session.user.user_metadata.permissions
--           → No DB query needed, no RLS issues, faster performance
--
-- Trade-off: User must re-login after role change to refresh JWT

-- 1. Trigger function: Auto-sync permissions to user_metadata when role changes
CREATE OR REPLACE FUNCTION public.sync_permissions_to_user_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_permissions text[];
  v_user_id uuid;
BEGIN
  -- Get affected user_id (works for INSERT, UPDATE, DELETE)
  v_user_id := COALESCE(NEW.user_id, OLD.user_id);

  IF v_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Aggregate all permissions for this user from their roles
  -- This query bypasses RLS because it's in a SECURITY DEFINER function
  -- and we're querying with explicit user_id (safe)
  SELECT COALESCE(array_agg(DISTINCT p ORDER BY p), ARRAY[]::text[])
  INTO v_permissions
  FROM (
    SELECT jsonb_array_elements_text(r.permissions) AS p
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id
  ) perms;

  -- Update auth.users.raw_user_meta_data
  -- This will be included in the JWT on next login
  UPDATE auth.users
  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                           || jsonb_build_object('permissions', v_permissions)
  WHERE id = v_user_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 2. Attach trigger to user_roles table
DROP TRIGGER IF EXISTS sync_permissions_trigger ON public.user_roles;
CREATE TRIGGER sync_permissions_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.sync_permissions_to_user_metadata();

-- 3. Backfill: Sync all existing users
DO $$
DECLARE
  rec RECORD;
  v_permissions text[];
  v_count integer := 0;
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

    -- Update metadata
    UPDATE auth.users
    SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                             || jsonb_build_object('permissions', v_permissions)
    WHERE id = rec.user_id;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfilled permissions for % users', v_count;
END $$;
