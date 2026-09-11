-- 00376: Keep sales-return money identical in the browser and PostgreSQL.
-- Function definition only. Applying this migration does not create a return,
-- change invoice debt, restore stock, or write cash transactions.

begin;

create or replace function public.create_sales_return_atomic(
  p_invoice_id uuid,
  p_items jsonb,
  p_refund_amount numeric,
  p_refund_payment_method text default 'cash',
  p_reason text default null,
  p_note text default null,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_return_id uuid;
  v_pair record;
  v_result jsonb;
begin
  -- The implementation calculates each return line with numeric round(..., 2).
  -- Normalize the browser amount to the same precision before its debt guard.
  v_result := public._create_sales_return_auth_impl_00244(
    p_invoice_id,
    p_items,
    case
      when coalesce(p_refund_amount, 0) < 0 then p_refund_amount
      else round(coalesce(p_refund_amount, 0), 2)
    end,
    p_refund_payment_method, p_reason, p_note, p_shift_id
  );
  v_return_id := (v_result->>'return_id')::uuid;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor;

  for v_pair in
    select distinct sm.branch_id, sm.product_id
      from public.stock_movements sm
     where sm.tenant_id = v_tenant_id
       and sm.reference_id = v_return_id
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_pair.branch_id, v_pair.product_id,
      'sales_return', v_return_id, v_actor,
      'Hoan ton khi tra hang ban'
    );
  end loop;

  return v_result;
end;
$$;

revoke all on function public.create_sales_return_atomic(
  uuid, jsonb, numeric, text, text, text, uuid
) from public, anon;
grant execute on function public.create_sales_return_atomic(
  uuid, jsonb, numeric, text, text, text, uuid
) to authenticated;

commit;

select
  to_regprocedure(
    'public.create_sales_return_atomic(uuid,jsonb,numeric,text,text,text,uuid)'
  ) is not null as sales_return_rpc_ok,
  pg_get_functiondef(
    'public.create_sales_return_atomic(uuid,jsonb,numeric,text,text,text,uuid)'::regprocedure
  ) like '%else round(coalesce(p_refund_amount, 0), 2)%' as refund_rounding_ok;
