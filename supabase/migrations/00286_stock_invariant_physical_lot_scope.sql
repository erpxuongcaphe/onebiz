-- ============================================================
-- 00286: Verify all physical FIFO lots, including expired lots
-- ============================================================
-- Function definition only. No business data is changed.

create or replace function public.verify_stock_invariants(
  p_tenant_id uuid default null,
  p_tolerance numeric default 0.01
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_inv1 jsonb := '[]'::jsonb;
  v_inv2 jsonb := '[]'::jsonb;
  v_inv3 jsonb := '[]'::jsonb;
  v_inv1_count int := 0;
  v_inv2_count int := 0;
  v_inv3_count int := 0;
  r record;
begin
  if p_tenant_id is null then
    select tenant_id into v_tenant_id
      from public.profiles where id = auth.uid();
    if v_tenant_id is null then
      raise exception 'TENANT_REQUIRED';
    end if;
  else
    v_tenant_id := p_tenant_id;
    if v_tenant_id <> (select tenant_id from public.profiles where id = auth.uid())
       and (select role from public.profiles where id = auth.uid()) <> 'owner' then
      raise exception 'PERMISSION_DENIED';
    end if;
  end if;

  for r in
    select p.id, p.code, p.name, p.stock as product_stock,
           coalesce(bs.branch_total, 0) as branch_sum,
           p.stock - coalesce(bs.branch_total, 0) as drift
    from public.products p
    left join (
      select product_id, sum(quantity) as branch_total
      from public.branch_stock
      where tenant_id = v_tenant_id
      group by product_id
    ) bs on bs.product_id = p.id
    where p.tenant_id = v_tenant_id
      and abs(coalesce(p.stock, 0) - coalesce(bs.branch_total, 0)) > p_tolerance
    order by abs(p.stock - coalesce(bs.branch_total, 0)) desc
    limit 100
  loop
    v_inv1 := v_inv1 || jsonb_build_object(
      'product_id', r.id,
      'code', r.code,
      'name', r.name,
      'product_stock', r.product_stock,
      'branch_stock_sum', r.branch_sum,
      'drift', r.drift
    );
    v_inv1_count := v_inv1_count + 1;
  end loop;

  for r in
    select bs.branch_id, bs.product_id, bs.quantity as branch_qty,
           coalesce(sm.movement_net, 0) as movement_sum,
           p.code, p.name, b.name as branch_name,
           bs.quantity - coalesce(sm.movement_net, 0) as drift
    from public.branch_stock bs
    join public.products p on p.id = bs.product_id
    join public.branches b on b.id = bs.branch_id
    left join (
      select branch_id, product_id,
             sum(case when type = 'in' then quantity else -quantity end)
               as movement_net
      from public.stock_movements
      where tenant_id = v_tenant_id
      group by branch_id, product_id
    ) sm on sm.branch_id = bs.branch_id and sm.product_id = bs.product_id
    where bs.tenant_id = v_tenant_id
      and bs.variant_id is null
      and abs(coalesce(bs.quantity, 0) - coalesce(sm.movement_net, 0)) > p_tolerance
    order by abs(bs.quantity - coalesce(sm.movement_net, 0)) desc
    limit 100
  loop
    v_inv2 := v_inv2 || jsonb_build_object(
      'branch_id', r.branch_id,
      'branch_name', r.branch_name,
      'product_id', r.product_id,
      'product_code', r.code,
      'product_name', r.name,
      'branch_stock_qty', r.branch_qty,
      'stock_movements_net', r.movement_sum,
      'drift', r.drift
    );
    v_inv2_count := v_inv2_count + 1;
  end loop;

  -- Expired lots are still physically in stock until disposal. A pair remains
  -- tracked even when every lot has become consumed, so a missing replacement
  -- lot cannot silently disappear from this check.
  for r in
    with tracked_pairs as (
      select distinct tenant_id, branch_id, product_id
      from public.product_lots
      where tenant_id = v_tenant_id
    ), lot_totals as (
      select tenant_id, branch_id, product_id, sum(current_qty) as lot_total
      from public.product_lots
      where tenant_id = v_tenant_id
        and status in ('active', 'expired')
      group by tenant_id, branch_id, product_id
    )
    select bs.branch_id, bs.product_id, bs.quantity as branch_qty,
           coalesce(lt.lot_total, 0) as lot_sum,
           p.code, p.name, b.name as branch_name,
           bs.quantity - coalesce(lt.lot_total, 0) as drift
    from public.branch_stock bs
    join tracked_pairs tp
      on tp.tenant_id = bs.tenant_id
     and tp.branch_id = bs.branch_id
     and tp.product_id = bs.product_id
    join public.products p on p.id = bs.product_id
    join public.branches b on b.id = bs.branch_id
    left join lot_totals lt
      on lt.tenant_id = bs.tenant_id
     and lt.branch_id = bs.branch_id
     and lt.product_id = bs.product_id
    where bs.tenant_id = v_tenant_id
      and bs.variant_id is null
      and bs.quantity >= 0
      and abs(bs.quantity - coalesce(lt.lot_total, 0)) > p_tolerance
    order by abs(bs.quantity - coalesce(lt.lot_total, 0)) desc
    limit 100
  loop
    v_inv3 := v_inv3 || jsonb_build_object(
      'branch_id', r.branch_id,
      'branch_name', r.branch_name,
      'product_id', r.product_id,
      'product_code', r.code,
      'product_name', r.name,
      'branch_stock_qty', r.branch_qty,
      'product_lots_sum', r.lot_sum,
      'drift', r.drift
    );
    v_inv3_count := v_inv3_count + 1;
  end loop;

  return jsonb_build_object(
    'verified_at', now(),
    'tenant_id', v_tenant_id,
    'tolerance', p_tolerance,
    'all_ok', (v_inv1_count + v_inv2_count + v_inv3_count) = 0,
    'invariant_1', jsonb_build_object(
      'description', 'products.stock = SUM(branch_stock.quantity)',
      'violations_count', v_inv1_count,
      'violations', v_inv1
    ),
    'invariant_2', jsonb_build_object(
      'description', 'branch_stock.quantity = SUM(stock_movements: in - out)',
      'violations_count', v_inv2_count,
      'violations', v_inv2
    ),
    'invariant_3', jsonb_build_object(
      'description', 'SUM(product_lots.current_qty active + expired) = branch_stock.quantity',
      'violations_count', v_inv3_count,
      'violations', v_inv3
    )
  );
end;
$$;

revoke all on function public.verify_stock_invariants(uuid,numeric)
  from public, anon;
grant execute on function public.verify_stock_invariants(uuid,numeric)
  to authenticated;

comment on function public.verify_stock_invariants(uuid,numeric) is
  'Checks stock snapshots, immutable movement ledger and all physical FIFO lots. 00286 includes expired and consumed-only tracked pairs.';

select to_regprocedure('public.verify_stock_invariants(uuid,numeric)') is not null
  as physical_lot_invariant_ok;

notify pgrst, 'reload schema';
