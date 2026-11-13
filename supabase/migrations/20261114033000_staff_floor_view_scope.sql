-- View-only floor access is branch-aware. POS, table configuration, F&B setup
-- and company-wide report/editor rights need the same underlying table data;
-- their independent grants continue to work when floor_plan.view is denied.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare table_name text;
begin
 if to_regprocedure('public._staff_floor_readable_branches()') is null
    or not exists(select 1 from pg_proc where oid='public._staff_floor_readable_branches()'::regprocedure
      and prosecdef and md5(replace(prosrc,chr(13),''))='05371602dc9310e0eb160e6377ea1e8c')
    or to_regprocedure('public._staff_permission_at_scope(uuid,text,uuid)') is null
    or to_regprocedure('public.get_user_effective_permissions_before_account_hierarchy(uuid)') is null
    or to_regprocedure('public.get_user_effective_permissions(uuid)') is null then
  raise exception 'STAFF_FLOOR_VIEW_BASELINE_CHANGED';
 end if;
 foreach table_name in array array['restaurant_tables','floor_plan_zones','floor_plan_decorations'] loop
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=table_name
    and policyname='staff_floor_branch_read' and permissive='RESTRICTIVE' and cmd='SELECT'
    and position('_staff_floor_readable_branches' in qual)>0) then
   raise exception 'STAFF_FLOOR_READ_POLICY_CHANGED: %',table_name;
  end if;
 end loop;
 if exists(select 1 from public.staff_branch_permission_catalog where permission_code='floor_plan.view') then
  raise exception 'STAFF_FLOOR_VIEW_CATALOG_ALREADY_EXISTS';
 end if;
end $$;

create or replace function public._staff_floor_readable_branches()
returns uuid[] language sql stable security definer set search_path = '' as $$
 with actor as materialized (
  select p.id,p.tenant_id,p.role,
   case when p.is_active is null then
     array(select x.permission_code from public.get_user_effective_permissions_before_account_hierarchy(p.id) x)
    else array(select x.permission_code from public.get_user_effective_permissions(p.id) x) end as permissions
  from public.profiles p
  where p.id=auth.uid() and p.tenant_id=public.get_user_tenant_id() and coalesce(p.is_active,true)
 )
 select coalesce(array_agg(b.id),'{}'::uuid[])
 from public.branches b
 join actor a on a.tenant_id=b.tenant_id
 -- The effective permission set is fetched once. Branch grants/revokes still
 -- go through the authoritative scope check, including global revocations.
 where a.role='owner' or a.permissions && array['reports.view_all_branches','floor_plan.edit_global']::text[]
     or (public.user_has_branch_access(a.id,b.id) and (
       a.permissions && array['orders.print','invoices.print','system.manage_branches','products.view','products.edit']::text[]
       or exists (
        select 1 from unnest(array['floor_plan.view','floor_plan.edit_branch','pos_fnb.send_kitchen',
          'pos_fnb.checkout','pos_fnb.view_orders','pos_fnb.manage_tables']::text[]) as candidate(code)
        where (candidate.code=any(a.permissions) or exists (
          select 1 from public.user_branch_permission_overrides o
          where o.tenant_id=a.tenant_id and o.user_id=a.id and o.branch_id=b.id
            and o.permission_code=candidate.code and o.override_type='grant'))
          and public._staff_permission_at_scope(a.id,candidate.code,b.id)
       )
     ))
$$;

insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('floor_plan.view',1);
commit;
