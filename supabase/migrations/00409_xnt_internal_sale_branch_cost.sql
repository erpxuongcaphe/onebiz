-- 00409: Resolve internal-sale receipt valuation from the receiving branch's
-- immutable F&B cost event, not the legacy stock-movement unit_cost snapshot.
-- Quantity and all non-internal-sale valuation rules remain owned by 00404.

begin;

create or replace function public.get_xnt_report_v2(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null,
  p_search text default null
) returns table (
  product_id uuid,
  code text,
  name text,
  unit text,
  category_name text,
  opening_qty numeric,
  in_supplier numeric,
  in_check numeric,
  in_return numeric,
  in_transfer numeric,
  in_production numeric,
  in_other numeric,
  out_sale numeric,
  out_disposal numeric,
  out_supplier_return numeric,
  out_check numeric,
  out_transfer numeric,
  out_production numeric,
  out_internal numeric,
  out_other numeric,
  closing_qty numeric,
  opening_value numeric,
  in_value numeric,
  out_value numeric,
  closing_value numeric,
  valued_movement_count bigint,
  missing_cost_movement_count bigint,
  valuation_complete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select profile.tenant_id
    into v_tenant_id
    from public.profiles profile
   where profile.id = auth.uid()
     and coalesce(profile.is_active, true);

  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  return query
  with quantities as (
    select *
      from public.get_xnt_report(p_date_from, p_date_to, p_branch_id, p_search)
  ),
  movement_source as (
    select
      movement.product_id,
      movement.type,
      movement.quantity::numeric as quantity,
      movement.created_at,
      case
        when cost_event.total_cost is not null then cost_event.total_cost
        -- Internal-sale receipt movements point to the generated input invoice,
        -- while their immutable cost event points to the internal-sale record.
        -- Do not fall back to the legacy movement cost if that link is absent
        -- or quantity does not reconcile: expose the row as unvalued instead.
        when movement.type = 'in'
         and movement.reference_type = 'internal_sale'
         and public._fnb_branch_cost_tracking_enabled_00390(
           movement.tenant_id, movement.branch_id
         )
          then internal_sale_cost.total_cost
        else case
          when movement.unit_cost is not null
            then movement.quantity * movement.unit_cost
          when movement.type = 'in' and movement.unit_price is not null
            then movement.quantity * movement.unit_price
          else null
        end
      end::numeric as movement_value
    from public.stock_movements movement
    join quantities quantity_row on quantity_row.product_id = movement.product_id
    left join public.fnb_branch_product_cost_events cost_event
      on cost_event.tenant_id = movement.tenant_id
     and cost_event.branch_id = movement.branch_id
     and cost_event.product_id = movement.product_id
     and cost_event.source_stock_movement_id = movement.id
    left join lateral (
      select case
        when count(distinct sale.id) = 1
         and count(receipt_event.id) > 0
         and abs(coalesce(sum(receipt_event.quantity), 0) - movement.quantity) <= 0.0001
          then sum(receipt_event.total_cost)::numeric
        else null::numeric
      end as total_cost
      from public.internal_sales sale
      join public.fnb_branch_product_cost_events receipt_event
        on receipt_event.tenant_id = sale.tenant_id
       and receipt_event.branch_id = sale.to_branch_id
       and receipt_event.product_id = movement.product_id
       and receipt_event.source_stock_movement_id is null
       and receipt_event.direction = 'in'
       and receipt_event.source_type = 'internal_sale_receipt'
       and receipt_event.source_reference_type = 'internal_sale'
       and receipt_event.source_reference_id = sale.id
      where movement.type = 'in'
        and movement.reference_type = 'internal_sale'
        and sale.tenant_id = movement.tenant_id
        and sale.to_branch_id = movement.branch_id
        and sale.input_invoice_id = movement.reference_id
        and (
          select count(*)
          from public.internal_sales candidate
          where candidate.tenant_id = movement.tenant_id
            and candidate.to_branch_id = movement.branch_id
            and candidate.input_invoice_id = movement.reference_id
        ) = 1
    ) internal_sale_cost on true
    where movement.tenant_id = v_tenant_id
      and movement.created_at < p_date_to
      and (p_branch_id is null or movement.branch_id = p_branch_id)
      and movement.type in ('in', 'out')
  ),
  valued as (
    select
      source.product_id,
      coalesce(sum(case
        when source.created_at < p_date_from and source.type = 'in' then source.quantity
        when source.created_at < p_date_from and source.type = 'out' then -source.quantity
        else 0
      end), 0)::numeric as ledger_opening_qty,
      coalesce(sum(case
        when source.created_at >= p_date_from and source.type = 'in' then source.quantity
        when source.created_at >= p_date_from and source.type = 'out' then -source.quantity
        else 0
      end), 0)::numeric as ledger_period_net_qty,
      coalesce(sum(case
        when source.created_at < p_date_from and source.type = 'in' then source.movement_value
        when source.created_at < p_date_from and source.type = 'out' then -source.movement_value
        else 0
      end), 0)::numeric as opening_value_raw,
      coalesce(sum(source.movement_value) filter (
        where source.created_at >= p_date_from and source.type = 'in'
      ), 0)::numeric as in_value_raw,
      coalesce(sum(source.movement_value) filter (
        where source.created_at >= p_date_from and source.type = 'out'
      ), 0)::numeric as out_value_raw,
      count(*) filter (where source.movement_value is not null)::bigint
        as valued_movement_count,
      count(*) filter (
        where source.movement_value is null and abs(source.quantity) > 0.0000001
      )::bigint as missing_cost_movement_count
    from movement_source source
    group by source.product_id
  ),
  resolved as (
    select
      quantity_row.*,
      coalesce(valued_row.ledger_opening_qty, 0)::numeric as ledger_opening_qty,
      coalesce(valued_row.ledger_period_net_qty, 0)::numeric as ledger_period_net_qty,
      coalesce(valued_row.opening_value_raw, 0)::numeric as opening_value_raw,
      coalesce(valued_row.in_value_raw, 0)::numeric as in_value_raw,
      coalesce(valued_row.out_value_raw, 0)::numeric as out_value_raw,
      coalesce(valued_row.valued_movement_count, 0)::bigint as valued_count,
      coalesce(valued_row.missing_cost_movement_count, 0)::bigint as missing_count,
      (
        coalesce(valued_row.missing_cost_movement_count, 0) = 0
        and abs(quantity_row.opening_qty - coalesce(valued_row.ledger_opening_qty, 0)) <= 0.0001
         and abs(
           quantity_row.closing_qty
           - coalesce(valued_row.ledger_opening_qty, 0)
           - coalesce(valued_row.ledger_period_net_qty, 0)
         ) <= 0.0001
        and quantity_row.opening_qty >= -0.0001
        and quantity_row.closing_qty >= -0.0001
        and coalesce(valued_row.opening_value_raw, 0) >= -0.0001
        and (
          coalesce(valued_row.opening_value_raw, 0)
          + coalesce(valued_row.in_value_raw, 0)
          - coalesce(valued_row.out_value_raw, 0)
        ) >= -0.0001
        and (
          abs(quantity_row.opening_qty) > 0.0001
          or abs(coalesce(valued_row.opening_value_raw, 0)) <= 0.0001
        )
        and (
          abs(quantity_row.closing_qty) > 0.0001
          or abs(
            coalesce(valued_row.opening_value_raw, 0)
            + coalesce(valued_row.in_value_raw, 0)
            - coalesce(valued_row.out_value_raw, 0)
          ) <= 0.0001
        )
      ) as is_complete
    from quantities quantity_row
    left join valued valued_row on valued_row.product_id = quantity_row.product_id
  )
  select
    resolved.product_id,
    resolved.code,
    resolved.name,
    resolved.unit,
    resolved.category_name,
    resolved.opening_qty,
    resolved.in_supplier,
    resolved.in_check,
    resolved.in_return,
    resolved.in_transfer,
    resolved.in_production,
    resolved.in_other,
    resolved.out_sale,
    resolved.out_disposal,
    resolved.out_supplier_return,
    resolved.out_check,
    resolved.out_transfer,
    resolved.out_production,
    resolved.out_internal,
    resolved.out_other,
    resolved.closing_qty,
    case when resolved.is_complete then resolved.opening_value_raw else null end,
    case when resolved.is_complete then resolved.in_value_raw else null end,
    case when resolved.is_complete then resolved.out_value_raw else null end,
    case when resolved.is_complete
      then resolved.opening_value_raw + resolved.in_value_raw - resolved.out_value_raw
      else null
    end,
    resolved.valued_count,
    resolved.missing_count,
    resolved.is_complete
  from resolved
  order by resolved.name, resolved.code, resolved.product_id;
end;
$$;

revoke all on function public.get_xnt_report_v2(
  timestamptz, timestamptz, uuid, text
) from public, anon;

grant execute on function public.get_xnt_report_v2(
  timestamptz, timestamptz, uuid, text
) to authenticated;

comment on function public.get_xnt_report_v2(
  timestamptz, timestamptz, uuid, text
) is
  'Read-only XNT quantities and historical values. Internal-sale receipts use the receiving branch F&B cost event; incomplete legacy valuation is returned as NULL.';

commit;
