-- 00223: Read-only stock card RPC.
-- This migration adds an index and a read function only. It never changes stock rows.

create index if not exists idx_stock_movements_stock_card
  on public.stock_movements (tenant_id, product_id, branch_id, created_at, id);

create or replace function public.get_stock_card_v2(
  p_product_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.get_user_tenant_id();
  v_rows jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_system_stock numeric := 0;
  v_computed_final numeric := 0;
begin
  if auth.uid() is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'STOCK_CARD_AUTH_REQUIRED';
  end if;

  if p_product_id is null or p_branch_id is null then
    raise exception using errcode = '22023', message = 'STOCK_CARD_SCOPE_REQUIRED';
  end if;

  perform public.assert_report_access('inventory.view', p_branch_id);

  if not exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.tenant_id = v_tenant_id
  ) then
    raise exception using errcode = '22023', message = 'STOCK_CARD_PRODUCT_INVALID';
  end if;

  if not exists (
    select 1
    from public.branches b
    where b.id = p_branch_id
      and b.tenant_id = v_tenant_id
  ) then
    raise exception using errcode = '22023', message = 'STOCK_CARD_BRANCH_INVALID';
  end if;

  with ledger as (
    select
      sm.id,
      sm.type,
      sm.quantity,
      sm.created_at,
      sm.note,
      sm.created_by,
      pr.full_name as created_by_name,
      sm.reference_type,
      sm.reference_id,
      sm.branch_id,
      b.name as branch_name,
      b.code as branch_code,
      sm.unit_cost,
      sm.unit_price,
      sum(
        case
          when sm.type = 'out' then -abs(coalesce(sm.quantity, 0))
          else coalesce(sm.quantity, 0)
        end
      ) over (
        order by sm.created_at asc, sm.id asc
        rows between unbounded preceding and current row
      ) as running_balance
    from public.stock_movements sm
    left join public.profiles pr on pr.id = sm.created_by
    join public.branches b
      on b.id = sm.branch_id
     and b.tenant_id = sm.tenant_id
    where sm.tenant_id = v_tenant_id
      and sm.product_id = p_product_id
      and sm.branch_id = p_branch_id
  )
  select
    coalesce(
      jsonb_agg(to_jsonb(ledger) order by created_at desc, id desc),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_rows, v_total
  from ledger;

  select coalesce(
    sum(
      case
        when sm.type = 'out' then -abs(coalesce(sm.quantity, 0))
        else coalesce(sm.quantity, 0)
      end
    ),
    0
  )
  into v_computed_final
  from public.stock_movements sm
  where sm.tenant_id = v_tenant_id
    and sm.product_id = p_product_id
    and sm.branch_id = p_branch_id;

  select coalesce(sum(bs.quantity), 0)
  into v_system_stock
  from public.branch_stock bs
  where bs.tenant_id = v_tenant_id
    and bs.product_id = p_product_id
    and bs.branch_id = p_branch_id
    and bs.variant_id is null;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'system_stock', v_system_stock,
    'computed_final', v_computed_final,
    'drift', v_computed_final - v_system_stock
  );
end;
$$;

revoke all on function public.get_stock_card_v2(uuid, uuid)
  from public, anon;
grant execute on function public.get_stock_card_v2(uuid, uuid)
  to authenticated;

comment on function public.get_stock_card_v2(uuid, uuid) is
  'Read-only stock card by product and branch. Running balance is ordered by created_at and id.';
