-- 00314: Read-only workspace for the supplier-return list.
-- Creates one STABLE function. It does not update stock or business documents.

create or replace function public.get_supplier_return_list_workspace(
  p_page integer default 0, p_page_size integer default 20,
  p_search text default null, p_search_field text default 'all',
  p_status text default null,
  p_date_from timestamptz default null, p_date_to_exclusive timestamptz default null,
  p_amount_min numeric default null, p_amount_max numeric default null,
  p_branch_id uuid default null
) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_page integer := greatest(coalesce(p_page, 0), 0);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 200);
  v_can_all boolean;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501', message='SUPPLIER_RETURN_LIST_AUTH_REQUIRED'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then raise exception using errcode='42501', message='SUPPLIER_RETURN_LIST_TENANT_UNKNOWN'; end if;
  if not exists (select 1 from public.profiles p where p.id=v_actor and p.tenant_id=v_tenant and coalesce(p.is_active,true)) then
    raise exception using errcode='42501', message='SUPPLIER_RETURN_LIST_PROFILE_INACTIVE';
  end if;
  if not public.user_has_permission(v_actor,'inventory.view') then
    raise exception using errcode='42501', message='SUPPLIER_RETURN_LIST_PERMISSION_DENIED';
  end if;
  v_can_all := public.user_has_permission(v_actor,'reports.view_all_branches')
    or public.user_has_permission(v_actor,'system.manage_branches');
  if p_branch_id is not null then
    if not exists (select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=v_tenant) then
      raise exception using errcode='42501', message='SUPPLIER_RETURN_LIST_BRANCH_NOT_IN_TENANT';
    end if;
    if not v_can_all and not public.user_has_branch_access(v_actor,p_branch_id) then
      raise exception using errcode='42501', message='SUPPLIER_RETURN_LIST_BRANCH_DENIED';
    end if;
  end if;
  if p_amount_min is not null and p_amount_max is not null and p_amount_min > p_amount_max then
    raise exception using errcode='22023', message='SUPPLIER_RETURN_LIST_AMOUNT_RANGE_INVALID';
  end if;

  with scoped as (
    select sr.*, p.full_name created_by_name, b.name branch_name, s.code supplier_code
    from public.supplier_returns sr
    left join public.profiles p on p.id=sr.created_by and p.tenant_id=v_tenant
    left join public.branches b on b.id=sr.branch_id and b.tenant_id=v_tenant
    left join public.suppliers s on s.id=sr.supplier_id and s.tenant_id=v_tenant
    where sr.tenant_id=v_tenant and (
      (p_branch_id is not null and sr.branch_id=p_branch_id)
      or (p_branch_id is null and v_can_all)
      or (p_branch_id is null and not v_can_all and sr.branch_id in (
        select ab.branch_id from public.get_user_accessible_branches(v_actor) ab
      ))
    )
  ), filtered as (
    select s.* from scoped s where (
      v_search is null or case coalesce(p_search_field,'all')
        when 'code' then position(lower(v_search) in lower(coalesce(s.code,'')))>0
        when 'import_code' then position(lower(v_search) in lower(coalesce(s.import_code,'')))>0
        when 'supplier' then position(lower(v_search) in lower(coalesce(s.supplier_name,'')))>0
          or position(lower(v_search) in lower(coalesce(s.supplier_code,'')))>0
        when 'note' then position(lower(v_search) in lower(coalesce(s.note,'')))>0
        else position(lower(v_search) in lower(coalesce(s.code,'')))>0
          or position(lower(v_search) in lower(coalesce(s.import_code,'')))>0
          or position(lower(v_search) in lower(coalesce(s.supplier_name,'')))>0
          or position(lower(v_search) in lower(coalesce(s.supplier_code,'')))>0
          or position(lower(v_search) in lower(coalesce(s.note,'')))>0 end
    ) and (p_status is null or p_status='all' or s.status=p_status)
      and (p_date_from is null or s.created_at>=p_date_from)
      and (p_date_to_exclusive is null or s.created_at<p_date_to_exclusive)
      and (p_amount_min is null or s.total>=p_amount_min)
      and (p_amount_max is null or s.total<=p_amount_max)
  ), ranked as (
    select f.*, row_number() over(order by f.created_at desc,f.id) row_order from filtered f
  ), page_rows as (
    select * from ranked where row_order>v_page*v_page_size
      and row_order<=(v_page+1)*v_page_size order by row_order
  ), summary as (
    select count(*)::bigint row_count,
      count(*) filter(where status='completed')::bigint completed_count,
      count(*) filter(where status='draft')::bigint draft_count,
      coalesce(sum(total),0)::numeric total_value
    from filtered
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(
      (to_jsonb(pr)-'row_order'-'created_by_name'-'branch_name'-'supplier_code') || jsonb_build_object(
        'profiles',case when pr.created_by_name is null then null else jsonb_build_object('full_name',pr.created_by_name) end,
        'branches',case when pr.branch_name is null then null else jsonb_build_object('name',pr.branch_name) end,
        'supplier_code',pr.supplier_code
      ) order by pr.row_order) from page_rows pr),'[]'::jsonb),
    'total',(select row_count from summary),
    'summary',jsonb_build_object(
      'completedCount',(select completed_count from summary),
      'draftCount',(select draft_count from summary),
      'totalValue',(select total_value from summary)
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_supplier_return_list_workspace(integer,integer,text,text,text,timestamptz,timestamptz,numeric,numeric,uuid) from public,anon;
grant execute on function public.get_supplier_return_list_workspace(integer,integer,text,text,text,timestamptz,timestamptz,numeric,numeric,uuid) to authenticated;
notify pgrst,'reload schema';
select to_regprocedure('public.get_supplier_return_list_workspace(integer,integer,text,text,text,timestamp with time zone,timestamp with time zone,numeric,numeric,uuid)') is not null as supplier_return_workspace_rpc_ok;
