-- OneBiz ERP - Triggers for bootstrap automation

-- 1) Auto-seed default roles when a tenant is created
create or replace function public.handle_new_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_roles(new.id);
  return new;
end;
$$;

drop trigger if exists on_tenant_created on public.tenants;
create trigger on_tenant_created
after insert on public.tenants
for each row execute procedure public.handle_new_tenant();


-- 2) Auto-create profile when a new auth user is created
-- This avoids manual inserts into public.profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  full_name text;
begin
  select id into t_id from public.tenants where custom_domain = 'onebiz.com.vn' limit 1;
  if t_id is null then
    select id into t_id from public.tenants order by created_at asc limit 1;
  end if;

  full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));

  insert into public.profiles (id, tenant_id, email, full_name)
  values (new.id, t_id, new.email, full_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
