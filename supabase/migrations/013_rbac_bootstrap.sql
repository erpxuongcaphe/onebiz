-- OneBiz ERP - RBAC bootstrap
-- Auto-assign a default role to new users.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  full_name text;
  role_id uuid;
  has_any_role boolean;
begin
  select id into t_id from public.tenants where custom_domain = 'onebiz.com.vn' limit 1;
  if t_id is null then
    select id into t_id from public.tenants order by created_at asc limit 1;
  end if;

  full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));

  insert into public.profiles (id, tenant_id, email, full_name)
  values (new.id, t_id, new.email, full_name)
  on conflict (id) do nothing;

  -- ensure system roles exist
  perform public.seed_default_roles(t_id);

  -- if this tenant has no user_roles yet -> first user becomes Super Admin
  select exists(select 1 from public.user_roles where tenant_id = t_id) into has_any_role;
  if not has_any_role then
    select id into role_id from public.roles where tenant_id = t_id and name = 'Super Admin' limit 1;
  else
    select id into role_id from public.roles where tenant_id = t_id and name = 'Employee' limit 1;
  end if;

  if role_id is not null then
    insert into public.user_roles (tenant_id, user_id, role_id)
    values (t_id, new.id, role_id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

-- Recreate trigger to ensure it points to latest function
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill: assign Super Admin to existing users without roles (per tenant)
insert into public.user_roles (tenant_id, user_id, role_id)
select p.tenant_id, p.id as user_id, r.id as role_id
from public.profiles p
join public.roles r on r.tenant_id = p.tenant_id and r.name = 'Super Admin'
left join public.user_roles ur on ur.user_id = p.id
where ur.id is null
on conflict do nothing;
