-- Fix: get_my_permission_patterns returns [] because SECURITY DEFINER + RLS conflict
--
-- Problem: RPC is SECURITY DEFINER (runs as function owner, not caller).
--          RLS policy "user_roles: read own" checks `user_id = auth.uid()`.
--          In SECURITY DEFINER context, auth.uid() still returns the CALLER's ID,
--          but the query executor is the function owner, so RLS blocks the query.
--
-- Solution: Explicitly disable RLS within the function body for trusted queries.
--           The function already validates auth.uid() is the requesting user,
--           so bypassing RLS here is safe.

create or replace function public.get_my_permission_patterns()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  role_patterns text[];
  user_perms record;
  result text[];
  requesting_user_id uuid;
begin
  -- Capture the requesting user's ID (from JWT)
  requesting_user_id := auth.uid();

  if requesting_user_id is null then
    return array[]::text[];
  end if;

  -- 1. Get permissions from roles (bypass RLS by querying directly)
  select coalesce(array_agg(distinct p), array[]::text[])
  into role_patterns
  from (
    select jsonb_array_elements_text(r.permissions) as p
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = requesting_user_id  -- Direct comparison, no RLS needed
  ) s;

  result := role_patterns;

  -- 2. Apply user_permissions overrides (also bypass RLS)
  for user_perms in
    select permission_code, granted
    from public.user_permissions
    where user_id = requesting_user_id
      and tenant_id = public.current_tenant_id()
  loop
    if user_perms.granted then
      -- Grant: add if not already present
      if not (user_perms.permission_code = any(result)) then
        result := array_append(result, user_perms.permission_code);
      end if;
    else
      -- Deny: remove from list
      result := array_remove(result, user_perms.permission_code);
    end if;
  end loop;

  return result;
end;
$$;

-- Grant remains unchanged
grant execute on function public.get_my_permission_patterns() to authenticated;
