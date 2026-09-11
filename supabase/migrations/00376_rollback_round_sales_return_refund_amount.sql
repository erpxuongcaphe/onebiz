-- Emergency rollback for 00376. This restores the 00287 wrapper definition.
-- It does not change existing return, invoice, stock or cash data.

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
  v_result := public._create_sales_return_auth_impl_00244(
    p_invoice_id, p_items, p_refund_amount, p_refund_payment_method,
    p_reason, p_note, p_shift_id
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
