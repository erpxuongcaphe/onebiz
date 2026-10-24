-- Personal UI preferences only. No invoice, stock, payment, shift or permission changes.
create table if not exists public.invoice_display_preferences (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 settings jsonb not null default '{}'::jsonb,
 revision bigint not null default 1 check (revision > 0),
 updated_at timestamptz not null default now(),
 primary key (tenant_id, profile_id),
 check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) < 8192)
);
alter table public.invoice_display_preferences enable row level security;
revoke all on public.invoice_display_preferences from public,anon,authenticated;

create or replace function public.get_invoice_display_preferences_20261024(p_tenant_id uuid,p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or p_profile_id is distinct from auth.uid() or not exists (
  select 1 from public.profiles p where p.id=auth.uid() and p.tenant_id=p_tenant_id and p.is_active=true
 ) then raise exception 'DISPLAY_PREFERENCES_ACCESS_DENIED' using errcode='42501';end if;
 return (select jsonb_build_object('settings',d.settings,'revision',d.revision) from public.invoice_display_preferences d where d.tenant_id=p_tenant_id and d.profile_id=auth.uid());
end;$$;

create or replace function public.save_invoice_display_preferences_20261024(p_tenant_id uuid,p_profile_id uuid,p_patch jsonb,p_initialize boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; k text; v jsonb; nested_key text; nested_value jsonb;
begin
 if auth.uid() is null or p_profile_id is distinct from auth.uid() or not exists (
  select 1 from public.profiles p where p.id=auth.uid() and p.tenant_id=p_tenant_id and p.is_active=true
 ) then raise exception 'DISPLAY_PREFERENCES_ACCESS_DENIED' using errcode='42501';end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>4096 then raise exception 'DISPLAY_PREFERENCES_INVALID';end if;
 for k,v in select * from jsonb_each(p_patch) loop
  if k='splitOptions' then
   if jsonb_typeof(v)<>'boolean' then raise exception 'DISPLAY_PREFERENCES_INVALID';end if;
  elsif k in ('detailVisibility','listColumns') then
   if jsonb_typeof(v)<>'object' then raise exception 'DISPLAY_PREFERENCES_INVALID';end if;
   if (select count(*) from jsonb_each(v))>50 then raise exception 'DISPLAY_PREFERENCES_INVALID';end if;
   for nested_key,nested_value in select * from jsonb_each(v) loop
    if jsonb_typeof(nested_value)<>'boolean' or (k='detailVisibility' and nested_key not in ('Mã hàng','Size','Đá/Nóng','Mức ngọt','Mức đá','Tùy chọn khác','ĐVT','Đơn giá','Giảm')) or (k='listColumns' and (nested_key !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' or nested_key in ('constructor','prototype'))) then raise exception 'DISPLAY_PREFERENCES_INVALID';end if;
   end loop;
  else raise exception 'DISPLAY_PREFERENCES_INVALID';end if;
 end loop;
 if p_initialize then
  -- One-time import from the device. An existing cloud choice always wins.
  insert into public.invoice_display_preferences(tenant_id,profile_id,settings) values(p_tenant_id,auth.uid(),p_patch) on conflict (tenant_id,profile_id) do nothing;
 else
  -- Row locking performed by ON CONFLICT makes concurrent edits atomic. Only edited fields merge.
  insert into public.invoice_display_preferences as d(tenant_id,profile_id,settings) values(p_tenant_id,auth.uid(),p_patch)
  on conflict (tenant_id,profile_id) do update set settings=jsonb_build_object(
   'splitOptions',coalesce(excluded.settings->'splitOptions',d.settings->'splitOptions','false'::jsonb),
   'detailVisibility',coalesce(d.settings->'detailVisibility','{}'::jsonb)||coalesce(excluded.settings->'detailVisibility','{}'::jsonb),
   'listColumns',coalesce(d.settings->'listColumns','{}'::jsonb)||coalesce(excluded.settings->'listColumns','{}'::jsonb)
  ),revision=d.revision+1,updated_at=clock_timestamp();
 end if;
 select jsonb_build_object('settings',d.settings,'revision',d.revision) into result from public.invoice_display_preferences d where d.tenant_id=p_tenant_id and d.profile_id=auth.uid();
 return result;
end;$$;
revoke all on function public.get_invoice_display_preferences_20261024(uuid,uuid) from public,anon;
revoke all on function public.save_invoice_display_preferences_20261024(uuid,uuid,jsonb,boolean) from public,anon;
grant execute on function public.get_invoice_display_preferences_20261024(uuid,uuid) to authenticated;
grant execute on function public.save_invoice_display_preferences_20261024(uuid,uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
