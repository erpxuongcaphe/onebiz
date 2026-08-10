-- ============================================================================
-- 00306 - Read-only summary for the Sales Order list.
--
-- Scope:
--   * Adds one STABLE, SECURITY INVOKER function and its execute grant.
--   * Does not update business rows, tables, columns, constraints, policies,
--     triggers, or indexes.
--   * Tenant and branch scope are derived and checked on the server.
--   * Delivery filters use EXISTS so multiple shipping rows cannot duplicate an
--     order in either the count or money totals.
-- ============================================================================

-- The first draft had ten parameters. Remove only that read-only overload so
-- PostgREST cannot choose an obsolete contract after this migration is rerun.
drop function if exists public.get_sales_order_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, uuid,
  timestamptz, timestamptz, text
);

create or replace function public.get_sales_order_list_summary(
  p_branch_id                       uuid        default null,
  p_date_from                       timestamptz default null,
  p_date_to_exclusive               timestamptz default null,
  p_statuses                        text[]      default null,
  p_search                          text        default null,
  p_search_field                    text        default 'all',
  p_delivery_partner_id             uuid        default null,
  p_shipping_date_from              timestamptz default null,
  p_shipping_date_to_exclusive      timestamptz default null,
  p_delivery_area                   text        default null,
  p_fulfillment_state               text        default null,
  p_debt_state                      text        default null,
  p_shipping_state                  text        default null,
  p_amount_min                      numeric     default null,
  p_amount_max                      numeric     default null
)
returns table (
  tong_don       bigint,
  tong_tien_hang numeric,
  tong_phi_giao  numeric,
  tong_can_thu   numeric
)
language plpgsql
stable
as $$
declare
  v_actor       uuid := auth.uid();
  v_tenant      uuid;
  v_xem_toan_bo boolean;
  v_statuses    text[];
  v_search      text;
  v_area        text;
  v_fulfillment text;
  v_debt_state  text;
  v_shipping    text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'ORDER_KPI_AUTH_REQUIRED';
  end if;

  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ORDER_KPI_TENANT_UNKNOWN';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.tenant_id = v_tenant
      and coalesce(p.is_active, true)
  ) then
    raise exception using errcode = '42501', message = 'ORDER_KPI_PROFILE_INACTIVE';
  end if;

  v_xem_toan_bo :=
       public.user_has_permission(v_actor, 'reports.view_all_branches')
    or public.user_has_permission(v_actor, 'system.manage_branches');

  if p_branch_id is not null then
    if not exists (
      select 1
      from public.branches b
      where b.id = p_branch_id
        and b.tenant_id = v_tenant
    ) then
      raise exception using errcode = '42501', message = 'ORDER_KPI_BRANCH_NOT_IN_TENANT';
    end if;

    if not v_xem_toan_bo
       and not public.user_has_branch_access(v_actor, p_branch_id) then
      raise exception using errcode = '42501', message = 'ORDER_KPI_BRANCH_DENIED';
    end if;
  end if;

  v_statuses := case
    when p_statuses is null or cardinality(p_statuses) = 0 then null
    else coalesce((
      select array_agg(distinct s)
      from unnest(p_statuses) as s
      where s = any(array['draft', 'confirmed', 'delivering', 'completed', 'cancelled'])
    ), array[]::text[])
  end;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else replace(replace(btrim(p_search), '%', '\%'), '_', '\_')
  end;

  v_area := case
    when p_delivery_area is null or btrim(p_delivery_area) = '' then null
    else replace(replace(btrim(p_delivery_area), '%', '\%'), '_', '\_')
  end;

  v_fulfillment := case
    when p_fulfillment_state in ('pending', 'fulfilled') then p_fulfillment_state
    else null
  end;

  v_debt_state := case
    when p_debt_state in ('outstanding', 'settled') then p_debt_state
    else null
  end;

  v_shipping := case
    when p_shipping_state in (
      'any', 'none', 'pending', 'picked_up', 'in_transit',
      'delivered', 'returned', 'cancelled'
    ) then p_shipping_state
    else null
  end;

  return query
  with loc as (
    select
      i.status,
      i.fulfilled_by_id,
      coalesce(i.total, 0) as total,
      coalesce(i.delivery_fee, 0) as delivery_fee,
      coalesce(i.debt, 0) as debt
    from public.invoices i
    where i.tenant_id = v_tenant
      and i.source = 'order'
      and i.deleted_at is null
      and (p_branch_id is null or i.branch_id = p_branch_id)
      and (
        v_xem_toan_bo
        or p_branch_id is not null
        or i.branch_id in (
          select b.branch_id
          from public.get_user_accessible_branches(v_actor) b
        )
      )
      and (p_date_from is null or i.created_at >= p_date_from)
      and (p_date_to_exclusive is null or i.created_at < p_date_to_exclusive)
      and (v_statuses is null or i.status = any(v_statuses))
      and (
        v_fulfillment is null
        or (v_fulfillment = 'pending' and i.fulfilled_by_id is null)
        or (v_fulfillment = 'fulfilled' and i.fulfilled_by_id is not null)
      )
      and (
        v_debt_state is null
        or (v_debt_state = 'outstanding' and coalesce(i.debt, 0) > 0)
        or (v_debt_state = 'settled' and coalesce(i.debt, 0) <= 0)
      )
      and (p_amount_min is null or coalesce(i.total, 0) >= p_amount_min)
      and (p_amount_max is null or coalesce(i.total, 0) <= p_amount_max)
      and (
        v_search is null
        or case p_search_field
          when 'code' then
               i.code ilike '%' || v_search || '%'
            or i.order_code ilike '%' || v_search || '%'
          when 'customer_name' then i.customer_name ilike '%' || v_search || '%'
          when 'customer_phone' then exists (
            select 1
            from public.customers c
            where c.id = i.customer_id
              and c.tenant_id = v_tenant
              and c.phone ilike '%' || v_search || '%'
          )
          else
               i.code ilike '%' || v_search || '%'
            or i.order_code ilike '%' || v_search || '%'
            or i.customer_name ilike '%' || v_search || '%'
        end
      )
      and (
        (
          v_shipping is null
          and p_delivery_partner_id is null
          and p_shipping_date_from is null
          and p_shipping_date_to_exclusive is null
          and v_area is null
        )
        or (
          v_shipping = 'none'
          and p_delivery_partner_id is null
          and p_shipping_date_from is null
          and p_shipping_date_to_exclusive is null
          and v_area is null
          and not exists (
            select 1
            from public.shipping_orders so_none
            where so_none.tenant_id = v_tenant
              and so_none.invoice_id = i.id
          )
        )
        or (
          (v_shipping is null or v_shipping <> 'none')
          and exists (
          select 1
          from public.shipping_orders so
          where so.tenant_id = v_tenant
            and so.invoice_id = i.id
            and (p_delivery_partner_id is null or so.partner_id = p_delivery_partner_id)
            and (
              v_shipping is null
              or v_shipping = 'any'
              or so.status = v_shipping
            )
            and (p_shipping_date_from is null or so.created_at >= p_shipping_date_from)
            and (
              p_shipping_date_to_exclusive is null
              or so.created_at < p_shipping_date_to_exclusive
            )
            and (v_area is null or so.receiver_address ilike '%' || v_area || '%')
          )
        )
      )
  )
  select
    count(*) as tong_don,
    coalesce(sum(l.total - l.delivery_fee) filter (
      where l.status <> 'cancelled' and l.fulfilled_by_id is null
    ), 0) as tong_tien_hang,
    coalesce(sum(l.delivery_fee) filter (
      where l.status <> 'cancelled' and l.fulfilled_by_id is null
    ), 0) as tong_phi_giao,
    coalesce(sum(l.debt) filter (
      where l.status <> 'cancelled' and l.fulfilled_by_id is null
    ), 0) as tong_can_thu
  from loc l;
end;
$$;

comment on function public.get_sales_order_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, uuid,
  timestamptz, timestamptz, text, text, text, text, numeric, numeric
) is
  'Read-only Sales Order list summary (00306). SECURITY INVOKER, STABLE. '
  'Server-derived tenant and effective branch permissions. Delivery filters '
  'use EXISTS to prevent duplicate order totals.';

revoke all on function public.get_sales_order_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, uuid,
  timestamptz, timestamptz, text, text, text, text, numeric, numeric
) from public, anon;

grant execute on function public.get_sales_order_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, uuid,
  timestamptz, timestamptz, text, text, text, text, numeric, numeric
) to authenticated;

-- PostgREST can keep the previous ten-parameter overload in its schema cache
-- after a CREATE OR REPLACE. Reload so the Preview can call the final contract
-- immediately instead of returning PGRST202 until the cache expires.
notify pgrst, 'reload schema';

do $$
begin
  raise notice '00306: installed get_sales_order_list_summary (read-only)';
end;
$$;

with function_check as (
  select to_regprocedure(
    'public.get_sales_order_list_summary(uuid,timestamp with time zone,timestamp with time zone,text[],text,text,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,numeric,numeric)'
  ) as function_oid
)
select
  function_oid is not null as sales_order_summary_rpc_ok,
  position(
    'from public.customers c'
    in lower(pg_get_functiondef(function_oid))
  ) > 0 as phone_search_uses_customer_table,
  position(
    'i.customer_phone'
    in lower(pg_get_functiondef(function_oid))
  ) = 0 as legacy_phone_column_removed
from function_check;
