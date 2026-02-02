-- OneBiz ERP - RBAC core helpers

-- Collect permission patterns (strings) for current user
-- Includes both role-based permissions AND user-specific permissions
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
begin
  -- 1. Get permissions from roles
  select coalesce(array_agg(distinct p), array[]::text[])
  into role_patterns
  from (
    select jsonb_array_elements_text(r.permissions) as p
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
  ) s;

  result := role_patterns;

  -- 2. Apply user_permissions overrides
  for user_perms in
    select permission_code, granted
    from public.user_permissions
    where user_id = auth.uid()
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

-- Match permission against patterns supporting '*' wildcard
create or replace function public.has_permission(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  patterns text[];
  pat text;
  like_pat text;
begin
  patterns := public.get_my_permission_patterns();
  if patterns is null then
    return false;
  end if;

  foreach pat in array patterns loop
    if pat = '*' then
      return true;
    end if;

    -- Convert '*' wildcard to SQL LIKE
    like_pat := replace(pat, '*', '%');

    if p_permission like like_pat then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

grant execute on function public.get_my_permission_patterns() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

-- Update seed_default_roles to align with module permissions
create or replace function public.seed_default_roles(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.roles (tenant_id, name, description, permissions, is_system)
  values
    (p_tenant_id, 'Super Admin', 'Full system access', '["*"]'::jsonb, true),
    (p_tenant_id, 'Admin', 'Administrative access', '[
      "inventory.*",
      "sales.*",
      "finance.*",
      "reports.*",
      "settings.*",
      "users.*",
      "roles.*"
    ]'::jsonb, true),
    (p_tenant_id, 'Manager', 'Department manager', '[
      "inventory.read",
      "inventory.product.*",
      "inventory.category.*",
      "inventory.warehouse.*",
      "inventory.stock.adjust",
      "inventory.movement.read"
    ]'::jsonb, true),
    (p_tenant_id, 'Employee', 'Basic employee access', '[
      "inventory.read",
      "inventory.movement.read"
    ]'::jsonb, true)
  on conflict do nothing;
end;
$$;

-- Backfill permissions for existing system roles (safe overwrite)
update public.roles
set permissions = '["*"]'::jsonb
where is_system = true and name = 'Super Admin';

update public.roles
set permissions = '[
  "inventory.*",
  "sales.*",
  "finance.*",
  "reports.*",
  "settings.*",
  "users.*",
  "roles.*"
]'::jsonb
where is_system = true and name = 'Admin';

update public.roles
set permissions = '[
  "inventory.read",
  "inventory.product.*",
  "inventory.category.*",
  "inventory.warehouse.*",
  "inventory.stock.adjust",
  "inventory.movement.read"
]'::jsonb
where is_system = true and name = 'Manager';

update public.roles
set permissions = '[
  "inventory.read",
  "inventory.movement.read"
]'::jsonb
where is_system = true and name = 'Employee';
