-- ============================================================
-- 00285: Repair FIFO lot drift without changing real stock
-- ============================================================
-- This migration changes only product_lots, lot_allocations and audit_log.
-- It never changes products.stock, branch_stock, stock_movements, documents,
-- costs, debt, or cash transactions.

begin;

do $$
declare
  v_tenant_id constant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_inv1_count integer;
  v_inv2_count integer;
  v_negative_count integer;
begin
  if to_regprocedure(
    'public._reconcile_product_lots_to_branch_00284(uuid,uuid,uuid,text,uuid,uuid,text)'
  ) is null then
    raise exception 'MISSING_00284_FIFO_RECONCILIATION_HELPER';
  end if;

  select count(*) into v_inv1_count
  from (
    select p.id
    from public.products p
    left join (
      select bs.product_id, sum(bs.quantity) as quantity
      from public.branch_stock bs
      where bs.tenant_id = v_tenant_id
      group by bs.product_id
    ) bs on bs.product_id = p.id
    where p.tenant_id = v_tenant_id
      and abs(coalesce(p.stock, 0) - coalesce(bs.quantity, 0)) > 0.01
  ) drift;

  select count(*) into v_inv2_count
  from (
    select bs.branch_id, bs.product_id
    from public.branch_stock bs
    left join (
      select sm.branch_id, sm.product_id,
             sum(case when sm.type = 'in' then sm.quantity else -sm.quantity end)
               as quantity
      from public.stock_movements sm
      where sm.tenant_id = v_tenant_id
      group by sm.branch_id, sm.product_id
    ) sm on sm.branch_id = bs.branch_id and sm.product_id = bs.product_id
    where bs.tenant_id = v_tenant_id
      and bs.variant_id is null
      and abs(coalesce(bs.quantity, 0) - coalesce(sm.quantity, 0)) > 0.01
  ) drift;

  select count(*) into v_negative_count
    from public.branch_stock bs
   where bs.tenant_id = v_tenant_id
     and bs.variant_id is null
     and bs.quantity < 0;

  if v_inv1_count <> 0 or v_inv2_count <> 0 then
    raise exception 'REAL_STOCK_INVARIANT_FAILED: products_vs_branch=%, branch_vs_ledger=%',
      v_inv1_count, v_inv2_count;
  end if;
  if v_negative_count <> 0 then
    raise exception 'NEGATIVE_BRANCH_STOCK_REQUIRES_MANUAL_REVIEW: % rows',
      v_negative_count;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.fifo_repair_plan_00285') is not null
     or to_regclass('public.product_lots_backup_00285') is not null
     or to_regclass('public.lot_allocations_backup_00285') is not null then
    raise exception using
      errcode = '55000',
      message = 'FIFO_REPAIR_00285_ALREADY_RAN',
      detail = 'Existing repair evidence and backups were preserved.';
  end if;
end;
$$;

create table public.fifo_repair_plan_00285 as
with lot_totals as (
  select pl.tenant_id, pl.branch_id, pl.product_id,
         sum(pl.current_qty) as lot_quantity
  from public.product_lots pl
  where pl.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid
    and pl.status in ('active', 'expired')
  group by pl.tenant_id, pl.branch_id, pl.product_id
)
select
  bs.tenant_id,
  bs.branch_id,
  bs.product_id,
  bs.quantity::numeric(18,4) as branch_quantity,
  coalesce(lt.lot_quantity, 0)::numeric(18,4) as lot_quantity,
  (bs.quantity - coalesce(lt.lot_quantity, 0))::numeric(18,4) as drift,
  now() as captured_at
from public.branch_stock bs
left join lot_totals lt
  on lt.tenant_id = bs.tenant_id
 and lt.branch_id = bs.branch_id
 and lt.product_id = bs.product_id
where bs.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid
  and bs.variant_id is null
  and abs(bs.quantity - coalesce(lt.lot_quantity, 0)) > 0.01;

alter table public.fifo_repair_plan_00285 enable row level security;
revoke all on public.fifo_repair_plan_00285 from anon, authenticated;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.fifo_repair_plan_00285;
  if v_count = 0 then
    raise exception 'NO_FIFO_DRIFT_TO_REPAIR';
  end if;
  if v_count > 100 then
    raise exception 'UNEXPECTED_FIFO_DRIFT_SCOPE: % rows', v_count;
  end if;
end;
$$;

create table public.product_lots_backup_00285 as
select pl.*
from public.product_lots pl
join public.fifo_repair_plan_00285 rp
  on rp.tenant_id = pl.tenant_id
 and rp.branch_id = pl.branch_id
 and rp.product_id = pl.product_id;
alter table public.product_lots_backup_00285 enable row level security;
revoke all on public.product_lots_backup_00285 from anon, authenticated;

create table public.lot_allocations_backup_00285 as
select la.*
from public.lot_allocations la
join public.product_lots_backup_00285 pl on pl.id = la.lot_id;
alter table public.lot_allocations_backup_00285 enable row level security;
revoke all on public.lot_allocations_backup_00285 from anon, authenticated;

-- Lock only affected branch snapshots. They are read-only targets here; the
-- lock prevents a sale, receipt, or check from racing with this short repair.
do $$
declare
  v_row record;
  v_actor uuid;
  v_source_id constant uuid := '00285000-0000-4000-8000-000000000001';
begin
  select p.id into v_actor
  from public.profiles p
  where p.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid
    and p.role = 'owner'
    and coalesce(p.is_active, true)
  order by p.created_at
  limit 1;

  if v_actor is null then
    raise exception 'ACTIVE_OWNER_REQUIRED_FOR_AUDIT';
  end if;

  for v_row in
    select bs.tenant_id, bs.branch_id, bs.product_id
    from public.branch_stock bs
    join public.fifo_repair_plan_00285 rp
      on rp.tenant_id = bs.tenant_id
     and rp.branch_id = bs.branch_id
     and rp.product_id = bs.product_id
    where bs.variant_id is null
    order by bs.branch_id, bs.product_id
    for update of bs
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_row.tenant_id,
      v_row.branch_id,
      v_row.product_id,
      'reconciliation',
      v_source_id,
      v_actor,
      'Can so lo lich su 00285; khong thay doi ton kho'
    );
  end loop;
end;
$$;

do $$
declare
  v_lot_drift_count integer;
  v_inv1_count integer;
  v_inv2_count integer;
begin
  select count(*) into v_lot_drift_count
  from public.fifo_repair_plan_00285 rp
  left join (
    select pl.tenant_id, pl.branch_id, pl.product_id,
           sum(pl.current_qty) as quantity
    from public.product_lots pl
    where pl.status in ('active', 'expired')
    group by pl.tenant_id, pl.branch_id, pl.product_id
  ) lt on lt.tenant_id = rp.tenant_id
      and lt.branch_id = rp.branch_id
      and lt.product_id = rp.product_id
  where abs(rp.branch_quantity - coalesce(lt.quantity, 0)) > 0.01;

  select count(*) into v_inv1_count
  from (
    select p.id
    from public.products p
    left join (
      select bs.product_id, sum(bs.quantity) as quantity
      from public.branch_stock bs
      where bs.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid
      group by bs.product_id
    ) bs on bs.product_id = p.id
    where p.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid
      and abs(coalesce(p.stock, 0) - coalesce(bs.quantity, 0)) > 0.01
  ) drift;

  select count(*) into v_inv2_count
  from (
    select bs.branch_id, bs.product_id
    from public.branch_stock bs
    left join (
      select sm.branch_id, sm.product_id,
             sum(case when sm.type = 'in' then sm.quantity else -sm.quantity end)
               as quantity
      from public.stock_movements sm
      where sm.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid
      group by sm.branch_id, sm.product_id
    ) sm on sm.branch_id = bs.branch_id and sm.product_id = bs.product_id
    where bs.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid
      and bs.variant_id is null
      and abs(coalesce(bs.quantity, 0) - coalesce(sm.quantity, 0)) > 0.01
  ) drift;

  if v_lot_drift_count <> 0 or v_inv1_count <> 0 or v_inv2_count <> 0 then
    raise exception 'POST_REPAIR_INVARIANT_FAILED: lot=%, products=%, ledger=%',
      v_lot_drift_count, v_inv1_count, v_inv2_count;
  end if;
end;
$$;

commit;

select
  (select count(*) from public.fifo_repair_plan_00285) as repaired_pairs,
  (select count(*) from public.product_lots_backup_00285) as backed_up_lots,
  0 as real_stock_rows_changed,
  0 as stock_movement_rows_changed;

-- Immediate rollback only, before any later stock transaction:
-- begin;
-- delete from public.lot_allocations
--  where source_type = 'reconciliation'
--    and source_id = '00285000-0000-4000-8000-000000000001'::uuid;
-- delete from public.product_lots pl
-- using public.fifo_repair_plan_00285 rp
-- where pl.tenant_id = rp.tenant_id
--   and pl.branch_id = rp.branch_id
--   and pl.product_id = rp.product_id
--   and not exists (
--     select 1 from public.product_lots_backup_00285 b where b.id = pl.id
--   );
-- update public.product_lots pl
--    set current_qty = b.current_qty,
--        status = b.status,
--        updated_at = b.updated_at
--   from public.product_lots_backup_00285 b
--  where pl.id = b.id;
-- delete from public.audit_log
--  where action = 'lot_reconcile'
--    and new_data->>'migration' = '00284'
--    and new_data->>'source_id' = '00285000-0000-4000-8000-000000000001';
-- commit;
