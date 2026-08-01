-- ============================================================
-- 00287: Complete FIFO coverage for remaining stock workflows
-- ============================================================
-- Function and constraint definitions only. Applying this migration does not
-- execute a stock workflow and does not change current stock or existing lots.

begin;

-- Stock provenance is extensible. A closed enum here can make a valid future
-- workflow fail after real-stock work, so integrity is enforced by the atomic
-- workflow wrappers instead of a brittle text check.
alter table public.lot_allocations
  drop constraint if exists lot_allocations_source_type_check;

do $$
begin
  if to_regprocedure('public._apply_manual_stock_movement_auth_impl_00246(uuid,uuid,uuid,jsonb)') is null then
    alter function public.apply_manual_stock_movement_atomic(uuid,uuid,uuid,jsonb)
      rename to _apply_manual_stock_movement_auth_impl_00246;
  end if;
  if to_regprocedure('public._create_sales_return_auth_impl_00244(uuid,jsonb,numeric,text,text,text,uuid)') is null then
    alter function public.create_sales_return_atomic(uuid,jsonb,numeric,text,text,text,uuid)
      rename to _create_sales_return_auth_impl_00244;
  end if;
  if to_regprocedure('public._create_internal_sale_auth_impl_00243(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)') is null then
    alter function public.create_internal_sale_atomic(
      uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text
    ) rename to _create_internal_sale_auth_impl_00243;
  end if;
  if to_regprocedure('public._void_disposal_export_auth_impl_00246(uuid,uuid,text)') is null then
    alter function public.void_disposal_export_atomic(uuid,uuid,text)
      rename to _void_disposal_export_auth_impl_00246;
  end if;
  if to_regprocedure('public._void_internal_export_auth_impl_00246(uuid,uuid,text)') is null then
    alter function public.void_internal_export_atomic(uuid,uuid,text)
      rename to _void_internal_export_auth_impl_00246;
  end if;
end;
$$;

revoke all on function public._apply_manual_stock_movement_auth_impl_00246(
  uuid,uuid,uuid,jsonb
) from public, anon, authenticated;
revoke all on function public._create_sales_return_auth_impl_00244(
  uuid,jsonb,numeric,text,text,text,uuid
) from public, anon, authenticated;
revoke all on function public._create_internal_sale_auth_impl_00243(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text
) from public, anon, authenticated;
revoke all on function public._void_disposal_export_auth_impl_00246(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public._void_internal_export_auth_impl_00246(uuid,uuid,text)
  from public, anon, authenticated;

create or replace function public.apply_manual_stock_movement_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_product_id uuid;
  v_result jsonb;
begin
  v_result := public._apply_manual_stock_movement_auth_impl_00246(
    p_tenant_id, p_branch_id, p_created_by, p_items
  );

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor;

  for v_product_id in
    select distinct (item->>'product_id')::uuid
      from jsonb_array_elements(p_items) item
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, p_branch_id, v_product_id,
      'manual_adjust', p_branch_id, v_actor,
      'Dieu chinh ton kho thu cong'
    );
  end loop;

  return v_result;
end;
$$;

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

create or replace function public.create_internal_sale_atomic(
  p_tenant_id uuid,
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_created_by uuid,
  p_int_customer_id uuid,
  p_int_customer_name text,
  p_int_supplier_id uuid,
  p_int_supplier_name text,
  p_items jsonb,
  p_payment_method text default 'transfer',
  p_paid_full boolean default true,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service_role boolean :=
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_actor uuid := case when v_is_service_role then p_created_by else auth.uid() end;
  v_tenant_id uuid;
  v_invoice_id uuid;
  v_input_invoice_id uuid;
  v_pair record;
  v_result jsonb;
begin
  v_result := public._create_internal_sale_auth_impl_00243(
    p_tenant_id, p_from_branch_id, p_to_branch_id, p_created_by,
    p_int_customer_id, p_int_customer_name, p_int_supplier_id,
    p_int_supplier_name, p_items, p_payment_method, p_paid_full, p_note
  );

  v_invoice_id := (v_result->>'invoice_id')::uuid;
  v_input_invoice_id := (v_result->>'input_invoice_id')::uuid;
  select s.tenant_id into v_tenant_id
    from public.internal_sales s
   where s.id = (v_result->>'internal_sale_id')::uuid;

  for v_pair in
    select distinct sm.branch_id, sm.product_id, sm.reference_id
      from public.stock_movements sm
     where sm.tenant_id = v_tenant_id
       and sm.reference_id in (v_invoice_id, v_input_invoice_id)
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_pair.branch_id, v_pair.product_id,
      'internal_sale', v_pair.reference_id, v_actor,
      'Can lo giao dich ban hang noi bo'
    );
  end loop;

  return v_result;
end;
$$;

create or replace function public.void_disposal_export_atomic(
  p_disposal_id uuid,
  p_created_by uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_pair record;
  v_result jsonb;
begin
  v_result := public._void_disposal_export_auth_impl_00246(
    p_disposal_id, p_created_by, p_reason
  );
  select d.tenant_id into v_tenant_id
    from public.disposal_exports d where d.id = p_disposal_id;

  for v_pair in
    select distinct sm.branch_id, sm.product_id
      from public.stock_movements sm
     where sm.tenant_id = v_tenant_id
       and sm.reference_id = p_disposal_id
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_pair.branch_id, v_pair.product_id,
      'disposal_cancel', p_disposal_id, v_actor,
      'Hoan ton khi huy phieu xuat huy'
    );
  end loop;
  return v_result;
end;
$$;

create or replace function public.void_internal_export_atomic(
  p_export_id uuid,
  p_created_by uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_pair record;
  v_result jsonb;
begin
  v_result := public._void_internal_export_auth_impl_00246(
    p_export_id, p_created_by, p_reason
  );
  select e.tenant_id into v_tenant_id
    from public.internal_exports e where e.id = p_export_id;

  for v_pair in
    select distinct sm.branch_id, sm.product_id
      from public.stock_movements sm
     where sm.tenant_id = v_tenant_id
       and sm.reference_id = p_export_id
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_pair.branch_id, v_pair.product_id,
      'internal_export_cancel', p_export_id, v_actor,
      'Hoan ton khi huy phieu xuat noi bo'
    );
  end loop;
  return v_result;
end;
$$;

revoke all on function public.apply_manual_stock_movement_atomic(uuid,uuid,uuid,jsonb)
  from public, anon;
grant execute on function public.apply_manual_stock_movement_atomic(uuid,uuid,uuid,jsonb)
  to authenticated;
revoke all on function public.create_sales_return_atomic(
  uuid,jsonb,numeric,text,text,text,uuid
) from public, anon;
grant execute on function public.create_sales_return_atomic(
  uuid,jsonb,numeric,text,text,text,uuid
) to authenticated;
revoke all on function public.create_internal_sale_atomic(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text
) from public, anon;
grant execute on function public.create_internal_sale_atomic(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text
) to authenticated, service_role;
revoke all on function public.void_disposal_export_atomic(uuid,uuid,text)
  from public, anon;
grant execute on function public.void_disposal_export_atomic(uuid,uuid,text)
  to authenticated;
revoke all on function public.void_internal_export_atomic(uuid,uuid,text)
  from public, anon;
grant execute on function public.void_internal_export_atomic(uuid,uuid,text)
  to authenticated;

commit;

select
  to_regprocedure('public.apply_manual_stock_movement_atomic(uuid,uuid,uuid,jsonb)') is not null
    as manual_adjust_fifo_ok,
  to_regprocedure('public.create_sales_return_atomic(uuid,jsonb,numeric,text,text,text,uuid)') is not null
    as sales_return_fifo_ok,
  to_regprocedure('public.create_internal_sale_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)') is not null
    as internal_sale_fifo_ok,
  to_regprocedure('public.void_disposal_export_atomic(uuid,uuid,text)') is not null
    as disposal_cancel_fifo_ok,
  to_regprocedure('public.void_internal_export_atomic(uuid,uuid,text)') is not null
    as internal_export_cancel_fifo_ok;

notify pgrst, 'reload schema';
