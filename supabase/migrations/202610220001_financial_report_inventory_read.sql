-- Report-only valuation projection. Shared warehouse functions and business rows stay unchanged.
begin;

create function public._financial_inventory_timeline_20261022(
  p_from timestamptz, p_to timestamptz, p_branch uuid, p_tenant uuid
) returns table (
  product_id uuid, branch_id uuid, created_at timestamptz,
  direction text, reference_type text, quantity numeric, amount numeric
)
language sql stable security definer set search_path = '' as $$
  with source_branches as materialized (
    select e.branch_id
    from public.fnb_branch_product_cost_events e
    where e.tenant_id = p_tenant and e.created_at >= p_from and e.created_at < p_to
      and (p_branch is null or e.branch_id = p_branch)
    union
    select s.branch_id
    from public.stock_movements s
    where s.tenant_id = p_tenant and s.created_at >= p_from and s.created_at < p_to
      and s.type in ('in', 'out') and (p_branch is null or s.branch_id = p_branch)
  ), policies as materialized (
    select b.branch_id,
      public._can_read_branch_inventory_00476(auth.uid(), p_tenant, b.branch_id) as can_read,
      public._fnb_branch_cost_tracking_enabled_00390(p_tenant, b.branch_id) as tracked
    from source_branches b
  )
  select e.product_id, e.branch_id, e.created_at,
    case when e.source_reference_type = 'production_correction' and e.source_type = 'production_complete'
      then 'in' else e.direction end,
    case when e.source_reference_type = 'production_correction' and e.source_type = 'production_complete'
      then 'production_complete' else e.source_reference_type end,
    case when e.source_reference_type = 'production_correction' and e.source_type = 'production_complete' and e.direction = 'out'
      then -e.quantity else e.quantity end,
    case when e.source_reference_type = 'production_correction' and e.source_type = 'production_complete' and e.direction = 'out'
      then -e.total_cost else e.total_cost end
  from public.fnb_branch_product_cost_events e
  join policies p on p.branch_id is not distinct from e.branch_id
  where e.tenant_id = p_tenant and e.created_at >= p_from and e.created_at < p_to
    and (p_branch is null or e.branch_id = p_branch) and p.can_read and p.tracked
  union all
  select s.product_id, s.branch_id, s.created_at, s.type,
    lower(coalesce(s.reference_type, '')), s.quantity,
    case when e.id is not null and e.direction = s.type and abs(e.quantity - s.quantity) < 0.0000001
      then e.total_cost
      when e.id is not null then null
      when s.unit_cost >= 0 then s.quantity * s.unit_cost
      when s.type = 'in' and s.unit_price >= 0 then s.quantity * s.unit_price
      else null end
  from public.stock_movements s
  join policies p on p.branch_id is not distinct from s.branch_id
  left join public.fnb_branch_product_cost_events e
    on e.tenant_id = s.tenant_id and e.source_stock_movement_id = s.id
  where s.tenant_id = p_tenant and s.created_at >= p_from and s.created_at < p_to
    and s.type in ('in', 'out') and (p_branch is null or s.branch_id = p_branch)
    and p.can_read and not p.tracked
$$;
revoke all on function public._financial_inventory_timeline_20261022(timestamptz, timestamptz, uuid, uuid)
  from public, anon, authenticated;

create function public._financial_inventory_summary_20261022(
  p_from timestamptz, p_to timestamptz, p_branch uuid, p_tenant uuid
) returns table (inventory_complete boolean, opening_value numeric, closing_value numeric)
language sql stable security definer set search_path = '' as $$
  with quantities as (
    select product_id, opening_qty, closing_qty
    from public.get_xnt_report(p_from, p_to, p_branch, null)
  ), values_by_product as (
    select v.product_id,
      coalesce(sum(case when v.created_at < p_from
        then (case v.direction when 'in' then 1 else -1 end) * v.quantity else 0 end), 0) oq,
      sum((case v.direction when 'in' then 1 else -1 end) * v.quantity) cq,
      coalesce(sum(case when v.created_at < p_from
        then (case v.direction when 'in' then 1 else -1 end) * v.amount else 0 end), 0) ov,
      coalesce(sum(v.amount) filter (where v.created_at >= p_from and v.direction = 'in'), 0) iv,
      coalesce(sum(v.amount) filter (where v.created_at >= p_from and v.direction = 'out'), 0) xv,
      count(*) filter (where v.amount is null) mc
    from public._financial_inventory_timeline_20261022('-infinity', p_to, p_branch, p_tenant) v
    group by v.product_id
  ), resolved as (
    select coalesce(v.ov, 0) ov, coalesce(v.iv, 0) iv, coalesce(v.xv, 0) xv,
      coalesce(v.mc, 0) = 0 and abs(q.opening_qty - coalesce(v.oq, 0)) <= 0.0001
      and abs(q.closing_qty - coalesce(v.cq, 0)) <= 0.0001
      and q.opening_qty >= 0 and q.closing_qty >= 0
      and coalesce(v.ov, 0) >= -0.0001
      and coalesce(v.ov, 0) + coalesce(v.iv, 0) - coalesce(v.xv, 0) >= -0.0001
      and (abs(q.opening_qty) > 0.0001 or abs(coalesce(v.ov, 0)) <= 0.0001)
      and (abs(q.closing_qty) > 0.0001 or abs(coalesce(v.ov, 0) + coalesce(v.iv, 0) - coalesce(v.xv, 0)) <= 0.0001) complete
    from quantities q left join values_by_product v on v.product_id = q.product_id
  ), totals as (
    select coalesce(bool_and(complete), true) complete,
      coalesce(sum(ov) filter (where complete), 0) ov,
      coalesce(sum(ov + iv - xv) filter (where complete), 0) cv
    from resolved
  )
  select complete, case when complete then ov else null end,
    case when complete then cv else null end
  from totals
$$;
revoke all on function public._financial_inventory_summary_20261022(timestamptz, timestamptz, uuid, uuid)
  from public, anon, authenticated;

-- Patch only the known inventory aggregation; preserve the current report body and grants.
do $patch$
declare
  v_target regprocedure := 'public.get_financial_analysis_details_report_v2(timestamptz,timestamptz,uuid,boolean,integer)'::regprocedure;
  v_definition text := pg_get_functiondef(v_target);
  v_old text := $old$  select aggregate.inventory_complete,
         case when aggregate.inventory_complete then aggregate.opening_value else null end,
         case when aggregate.inventory_complete then aggregate.closing_value else null end
    into v_inventory_complete, v_opening_value, v_closing_value
    from (
      select coalesce(bool_and(x.valuation_complete), true) as inventory_complete,
             coalesce(sum(x.opening_value), 0) as opening_value,
             coalesce(sum(x.closing_value), 0) as closing_value
        from public.get_xnt_report_v2(
          p_date_from, p_date_to, p_branch_id, null
        ) x
    ) aggregate;$old$;
  v_new text := $new$  select s.inventory_complete, s.opening_value, s.closing_value
    into v_inventory_complete, v_opening_value, v_closing_value
    from public._financial_inventory_summary_20261022(
      p_date_from, p_date_to, p_branch_id, v_tenant_id
    ) s;$new$;
begin
  if strpos(v_definition, v_old) = 0 then
    v_old := replace(v_old, E'\n', E'\r\n');
    v_new := replace(v_new, E'\n', E'\r\n');
  end if;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'FINANCIAL_INVENTORY_PATCH_SOURCE_CHANGED';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$patch$;

commit;

