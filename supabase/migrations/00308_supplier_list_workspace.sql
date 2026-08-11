-- ============================================================================
-- 00308 - Supplier list workspace (read-only)
--
-- Adds one tenant-scoped RPC for the supplier list. It does not update business
-- rows, tables, columns, policies, triggers, constraints, or indexes.
-- ============================================================================

create or replace function public.get_supplier_list_workspace(
  p_page                       integer     default 0,
  p_page_size                  integer     default 15,
  p_search                     text        default null,
  p_search_field               text        default 'all',
  p_statuses                   text[]      default null,
  p_created_from               timestamptz default null,
  p_created_to_exclusive       timestamptz default null,
  p_province                   text        default null,
  p_debt_min                   numeric     default null,
  p_debt_max                   numeric     default null,
  p_total_purchase_min         numeric     default null,
  p_total_purchase_max         numeric     default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor     uuid := auth.uid();
  v_tenant    uuid;
  v_search    text := nullif(trim(coalesce(p_search, '')), '');
  v_page      integer := greatest(coalesce(p_page, 0), 0);
  v_page_size integer := least(greatest(coalesce(p_page_size, 15), 1), 200);
  v_result    jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'SUPPLIER_LIST_AUTH_REQUIRED';
  end if;

  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'SUPPLIER_LIST_TENANT_UNKNOWN';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.tenant_id = v_tenant
      and coalesce(p.is_active, true)
  ) then
    raise exception using errcode = '42501', message = 'SUPPLIER_LIST_PROFILE_INACTIVE';
  end if;

  if not public.user_has_permission(v_actor, 'suppliers.view') then
    raise exception using errcode = '42501', message = 'SUPPLIER_LIST_PERMISSION_DENIED';
  end if;

  if p_debt_min is not null and p_debt_max is not null
     and p_debt_min > p_debt_max then
    raise exception using errcode = '22023', message = 'SUPPLIER_LIST_DEBT_RANGE_INVALID';
  end if;

  if p_total_purchase_min is not null and p_total_purchase_max is not null
     and p_total_purchase_min > p_total_purchase_max then
    raise exception using errcode = '22023', message = 'SUPPLIER_LIST_PURCHASE_RANGE_INVALID';
  end if;

  with supplier_totals as (
    select
      s.*,
      coalesce(sum(po.total) filter (
        where po.status in ('completed', 'partial')
      ), 0)::numeric as total_purchases
    from public.suppliers s
    left join public.purchase_orders po
      on po.tenant_id = v_tenant
     and po.supplier_id = s.id
     and po.status in ('completed', 'partial')
    where s.tenant_id = v_tenant
      and not coalesce(s.is_internal, false)
    group by s.id
  ), filtered as (
    select st.*
    from supplier_totals st
    where (
      v_search is null
      or case coalesce(p_search_field, 'all')
        when 'code' then position(lower(v_search) in lower(coalesce(st.code, ''))) > 0
        when 'name' then position(lower(v_search) in lower(coalesce(st.name, ''))) > 0
        when 'phone' then position(lower(v_search) in lower(coalesce(st.phone, ''))) > 0
        else
             position(lower(v_search) in lower(coalesce(st.code, ''))) > 0
          or position(lower(v_search) in lower(coalesce(st.name, ''))) > 0
          or position(lower(v_search) in lower(coalesce(st.phone, ''))) > 0
        end
    )
      and (
        p_statuses is null
        or cardinality(p_statuses) = 0
        or (st.is_active and 'active' = any(p_statuses))
        or (not st.is_active and 'inactive' = any(p_statuses))
      )
      and (p_created_from is null or st.created_at >= p_created_from)
      and (p_created_to_exclusive is null or st.created_at < p_created_to_exclusive)
      and (nullif(trim(coalesce(p_province, '')), '') is null or st.province = p_province)
      and (p_debt_min is null or st.debt >= p_debt_min)
      and (p_debt_max is null or st.debt <= p_debt_max)
      and (p_total_purchase_min is null or st.total_purchases >= p_total_purchase_min)
      and (p_total_purchase_max is null or st.total_purchases <= p_total_purchase_max)
  ), ranked as (
    select
      f.*,
      row_number() over (order by f.created_at desc, f.id) as row_order
    from filtered f
  ), page_rows as (
    select *
    from ranked
    where row_order > v_page * v_page_size
      and row_order <= (v_page + 1) * v_page_size
    order by row_order
  ), summary as (
    select
      count(*)::bigint as supplier_count,
      coalesce(sum(total_purchases), 0)::numeric as total_purchases,
      coalesce(sum(debt), 0)::numeric as total_debt,
      count(*) filter (where debt > 0)::bigint as suppliers_with_debt
    from filtered
  )
  select jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(to_jsonb(pr) - 'row_order' order by pr.row_order)
        from page_rows pr
      ),
      '[]'::jsonb
    ),
    'total', (select supplier_count from summary),
    'summary', jsonb_build_object(
      'totalPurchases', (select total_purchases from summary),
      'totalDebt', (select total_debt from summary),
      'suppliersWithDebt', (select suppliers_with_debt from summary)
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.get_supplier_list_workspace(
  integer, integer, text, text, text[], timestamptz, timestamptz, text,
  numeric, numeric, numeric, numeric
) is
  'Read-only supplier list with lifetime completed/partial purchase totals and filtered summary.';

revoke all on function public.get_supplier_list_workspace(
  integer, integer, text, text, text[], timestamptz, timestamptz, text,
  numeric, numeric, numeric, numeric
) from public, anon;

grant execute on function public.get_supplier_list_workspace(
  integer, integer, text, text, text[], timestamptz, timestamptz, text,
  numeric, numeric, numeric, numeric
) to authenticated;

notify pgrst, 'reload schema';

do $$
begin
  if to_regprocedure(
    'public.get_supplier_list_workspace(integer,integer,text,text,text[],timestamp with time zone,timestamp with time zone,text,numeric,numeric,numeric,numeric)'
  ) is null then
    raise exception '00308_ABORT: get_supplier_list_workspace was not installed';
  end if;
end;
$$;

select
  to_regprocedure(
    'public.get_supplier_list_workspace(integer,integer,text,text,text[],timestamp with time zone,timestamp with time zone,text,numeric,numeric,numeric,numeric)'
  ) is not null as supplier_workspace_rpc_ok;
