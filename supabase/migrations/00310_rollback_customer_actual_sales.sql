-- ============================================================================
-- 00310 rollback - restore the 00309 customer workspace implementation.
--
-- One filtered source for customer rows, birthday filtering and list metrics.
-- This function does not change customers, debt, invoices or return documents.
-- ============================================================================

create or replace function public.get_customer_list_workspace(
  p_page                       integer     default 0,
  p_page_size                  integer     default 15,
  p_search                     text        default null,
  p_search_field               text        default 'all',
  p_group_ids                  uuid[]      default null,
  p_customer_type              text        default null,
  p_gender                     text        default null,
  p_debt_filter                text        default null,
  p_sales_range                text        default null,
  p_orders_range               text        default null,
  p_last_purchase              text        default null,
  p_birthday_month             integer     default null,
  p_tags                       text[]      default null,
  p_created_from               timestamptz default null,
  p_created_to_exclusive       timestamptz default null,
  p_province                   text        default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor         uuid := auth.uid();
  v_tenant        uuid;
  v_search        text := nullif(trim(coalesce(p_search, '')), '');
  v_page          integer := greatest(coalesce(p_page, 0), 0);
  v_page_size     integer := least(greatest(coalesce(p_page_size, 15), 1), 200);
  v_can_view_debt boolean;
  v_result        jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_AUTH_REQUIRED';
  end if;

  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_TENANT_UNKNOWN';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.tenant_id = v_tenant
      and coalesce(p.is_active, true)
  ) then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_PROFILE_INACTIVE';
  end if;

  if not public.user_has_permission(v_actor, 'customers.view') then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_PERMISSION_DENIED';
  end if;

  v_can_view_debt := public.user_has_permission(v_actor, 'customers.view_debt');
  if not v_can_view_debt and nullif(trim(coalesce(p_debt_filter, '')), '') is not null then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_DEBT_PERMISSION_DENIED';
  end if;

  if p_birthday_month is not null and (p_birthday_month < 1 or p_birthday_month > 12) then
    raise exception using errcode = '22023', message = 'CUSTOMER_LIST_BIRTHDAY_MONTH_INVALID';
  end if;

  with return_totals as (
    select
      sr.customer_id,
      coalesce(sum(sr.total), 0)::numeric as returned_total
    from public.sales_returns sr
    where sr.tenant_id = v_tenant
      and sr.status = 'completed'
      and sr.customer_id is not null
    group by sr.customer_id
  ), source_rows as (
    select
      c.*,
      cg.name as group_name,
      cg.discount_percent as group_discount_percent,
      lt.name as loyalty_tier_name,
      lt.discount_percent as loyalty_tier_discount,
      coalesce(rt.returned_total, 0)::numeric as returned_total,
      greatest(coalesce(c.total_spent, 0) - coalesce(rt.returned_total, 0), 0)::numeric as net_sales
    from public.customers c
    left join public.customer_groups cg
      on cg.id = c.group_id
     and cg.tenant_id = v_tenant
    left join public.loyalty_tiers lt
      on lt.id = c.loyalty_tier_id
     and lt.tenant_id = v_tenant
    left join return_totals rt on rt.customer_id = c.id
    where c.tenant_id = v_tenant
      and not coalesce(c.is_internal, false)
  ), filtered as (
    select s.*
    from source_rows s
    where (
      v_search is null
      or case coalesce(p_search_field, 'all')
        when 'code' then position(lower(v_search) in lower(coalesce(s.code, ''))) > 0
        when 'name' then position(lower(v_search) in lower(coalesce(s.name, ''))) > 0
        when 'phone' then position(lower(v_search) in lower(coalesce(s.phone, ''))) > 0
        else
             position(lower(v_search) in lower(coalesce(s.code, ''))) > 0
          or position(lower(v_search) in lower(coalesce(s.name, ''))) > 0
          or position(lower(v_search) in lower(coalesce(s.phone, ''))) > 0
        end
    )
      and (p_group_ids is null or cardinality(p_group_ids) = 0 or s.group_id = any(p_group_ids))
      and (nullif(p_customer_type, '') is null or s.customer_type::text = p_customer_type)
      and (nullif(p_gender, '') is null or s.gender::text = p_gender)
      and (
        nullif(p_debt_filter, '') is null
        or (p_debt_filter = 'has_debt' and s.debt > 0)
        or (p_debt_filter = 'no_debt' and s.debt = 0)
      )
      and (
        nullif(p_sales_range, '') is null
        or (p_sales_range = 'tier_new' and s.total_spent < 1000000)
        or (p_sales_range = 'tier_regular' and s.total_spent >= 1000000 and s.total_spent < 10000000)
        or (p_sales_range = 'tier_loyal' and s.total_spent >= 10000000 and s.total_spent < 50000000)
        or (p_sales_range = 'tier_vip' and s.total_spent >= 50000000)
      )
      and (
        nullif(p_orders_range, '') is null
        or (p_orders_range = 'no_purchase' and s.total_orders = 0)
        or (p_orders_range = 'first_time' and s.total_orders = 1)
        or (p_orders_range = 'occasional' and s.total_orders between 2 and 5)
        or (p_orders_range = 'frequent' and s.total_orders >= 6)
      )
      and (
        nullif(p_last_purchase, '') is null
        or (p_last_purchase = 'never' and s.last_purchase_at is null)
        or (p_last_purchase = 'today' and s.last_purchase_at >= date_trunc('day', current_timestamp))
        or (p_last_purchase = 'week' and s.last_purchase_at >= current_timestamp - interval '7 days')
        or (p_last_purchase = 'month' and s.last_purchase_at >= current_timestamp - interval '30 days')
        or (p_last_purchase = '3months' and s.last_purchase_at >= current_timestamp - interval '90 days')
        or (p_last_purchase = 'churned' and s.last_purchase_at < current_timestamp - interval '90 days')
      )
      and (p_birthday_month is null or extract(month from s.birthday)::integer = p_birthday_month)
      and (p_tags is null or cardinality(p_tags) = 0 or s.tags @> p_tags)
      and (p_created_from is null or s.created_at >= p_created_from)
      and (p_created_to_exclusive is null or s.created_at < p_created_to_exclusive)
      and (nullif(trim(coalesce(p_province, '')), '') is null or s.province = p_province)
  ), ranked as (
    select f.*, row_number() over (order by f.created_at desc, f.id) as row_order
    from filtered f
  ), page_rows as (
    select *
    from ranked
    where row_order > v_page * v_page_size
      and row_order <= (v_page + 1) * v_page_size
    order by row_order
  ), summary as (
    select
      count(*)::bigint as customer_count,
      coalesce(sum(total_spent), 0)::numeric as total_sales,
      coalesce(sum(returned_total), 0)::numeric as total_returns,
      coalesce(sum(net_sales), 0)::numeric as net_sales,
      case when v_can_view_debt then coalesce(sum(debt), 0)::numeric else 0::numeric end as total_debt,
      case when v_can_view_debt then count(*) filter (where debt > 0)::bigint else 0::bigint end as customers_with_debt
    from filtered
  )
  select jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          (
            to_jsonb(pr)
            - 'row_order' - 'returned_total' - 'net_sales'
            - 'group_name' - 'group_discount_percent'
            - 'loyalty_tier_name' - 'loyalty_tier_discount' - 'debt'
          ) || jsonb_build_object(
            'debt', case when v_can_view_debt then pr.debt else 0 end,
            'returned_total', pr.returned_total,
            'customer_groups', case when pr.group_id is null then null else jsonb_build_object(
              'name', pr.group_name,
              'discount_percent', pr.group_discount_percent
            ) end,
            'loyalty_tiers', case when pr.loyalty_tier_id is null then null else jsonb_build_object(
              'name', pr.loyalty_tier_name,
              'discount_percent', pr.loyalty_tier_discount
            ) end
          )
          order by pr.row_order
        )
        from page_rows pr
      ),
      '[]'::jsonb
    ),
    'total', (select customer_count from summary),
    'summary', jsonb_build_object(
      'totalSales', (select total_sales from summary),
      'totalReturns', (select total_returns from summary),
      'netSales', (select net_sales from summary),
      'totalDebt', (select total_debt from summary),
      'customersWithDebt', (select customers_with_debt from summary),
      'canViewDebt', v_can_view_debt
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Remove the branch-aware overload only after the previous implementation
-- compiled successfully. No business rows are changed.
drop function if exists public.get_customer_list_workspace(
  integer, integer, text, text, uuid[], text, text, text, text, text, text,
  integer, text[], timestamptz, timestamptz, text, uuid
);

comment on function public.get_customer_list_workspace(
  integer, integer, text, text, uuid[], text, text, text, text, text, text,
  integer, text[], timestamptz, timestamptz, text
) is 'Read-only customer list with server-side birthday filtering and full-result metrics.';

revoke all on function public.get_customer_list_workspace(
  integer, integer, text, text, uuid[], text, text, text, text, text, text,
  integer, text[], timestamptz, timestamptz, text
) from public, anon;

grant execute on function public.get_customer_list_workspace(
  integer, integer, text, text, uuid[], text, text, text, text, text, text,
  integer, text[], timestamptz, timestamptz, text
) to authenticated;

notify pgrst, 'reload schema';

select to_regprocedure(
  'public.get_customer_list_workspace(integer,integer,text,text,uuid[],text,text,text,text,text,text,integer,text[],timestamp with time zone,timestamp with time zone,text)'
) is not null as customer_workspace_rpc_ok;
