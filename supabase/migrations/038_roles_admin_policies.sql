-- OneBiz ERP - Role management policies and bootstrap

-- Allow role admins to read and manage user_roles within tenant
create policy "user_roles: read within tenant by admin"
on public.user_roles
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('roles.*')
);

create policy "user_roles: insert by admin"
on public.user_roles
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('roles.*')
);

create policy "user_roles: delete by admin"
on public.user_roles
for delete
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('roles.*')
);

-- Bootstrap first super admin for a tenant if no roles assigned yet
create or replace function public.bootstrap_super_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  role_id uuid;
  has_any_role boolean;
begin
  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  select exists(select 1 from public.user_roles where tenant_id = t_id) into has_any_role;
  if has_any_role then
    raise exception 'Roles already assigned for tenant';
  end if;

  select id into role_id from public.roles where tenant_id = t_id and name = 'Super Admin' limit 1;
  if role_id is null then
    perform public.seed_default_roles(t_id);
    select id into role_id from public.roles where tenant_id = t_id and name = 'Super Admin' limit 1;
  end if;

  if role_id is null then
    raise exception 'Super Admin role not found';
  end if;

  insert into public.user_roles (tenant_id, user_id, role_id)
  values (t_id, auth.uid(), role_id)
  on conflict do nothing;
end;
$$;

grant execute on function public.bootstrap_super_admin() to authenticated;
