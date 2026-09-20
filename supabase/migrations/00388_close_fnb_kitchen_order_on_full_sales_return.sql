-- ============================================================================
-- 00388 - Close the linked FnB kitchen order after a full sales return
--
-- The existing sales-return RPC correctly posts return stock, cash/customer
-- credit, FIFO lots and audit history. It does not close the linked KDS order,
-- so a fully returned FnB invoice can remain pending/preparing on the kitchen
-- screen. This wrapper preserves that implementation and adds only the FnB KDS
-- lifecycle step after the return transaction succeeds.
--
-- Retail boundary: invoices.source must be exactly 'fnb'. This migration never
-- writes invoices, invoice items, stock, lots, cash or Retail records.
-- ============================================================================

begin;

do $$
declare
  v_definition text;
  v_mismatch_count integer;
begin
  if to_regclass('public.invoices') is null
     or to_regclass('public.invoice_items') is null
     or to_regclass('public.sales_returns') is null
     or to_regclass('public.kitchen_orders') is null
     or to_regclass('public.audit_log') is null then
    raise exception 'FNB_00388_REQUIRED_TABLE_MISSING' using errcode = 'P0001';
  end if;

  if to_regprocedure(
       'public._create_sales_return_atomic_impl_00376(uuid,jsonb,numeric,text,text,text,uuid)'
     ) is null then
    if to_regprocedure(
         'public.create_sales_return_atomic(uuid,jsonb,numeric,text,text,text,uuid)'
       ) is null then
      raise exception 'FNB_00388_REQUIRED_RPC_MISSING' using errcode = 'P0001';
    end if;

    select lower(pg_get_functiondef(
      'public.create_sales_return_atomic(uuid,jsonb,numeric,text,text,text,uuid)'::regprocedure
    )) into v_definition;

    if position('_create_sales_return_auth_impl_00244' in v_definition) = 0
       or position('_reconcile_product_lots_to_branch_00284' in v_definition) = 0
       or position('round(coalesce(p_refund_amount, 0), 2)' in v_definition) = 0 then
      raise exception 'FNB_00388_RPC_FINGERPRINT_MISMATCH' using errcode = 'P0001';
    end if;

    alter function public.create_sales_return_atomic(
      uuid,jsonb,numeric,text,text,text,uuid
    ) rename to _create_sales_return_atomic_impl_00376;
  end if;

  select count(*) into v_mismatch_count
    from public.kitchen_orders ko
    join public.invoices i
      on i.id = ko.invoice_id
     and i.tenant_id = ko.tenant_id
   where i.source = 'fnb'
     and i.status = 'completed'
     and ko.status not in ('cancelled', 'completed', 'served')
     and exists (
       select 1 from public.invoice_items ii where ii.invoice_id = i.id
     )
     and not exists (
       select 1
         from public.invoice_items ii
        where ii.invoice_id = i.id
          and coalesce(ii.returned_qty, 0) < ii.quantity
     )
     and exists (
       select 1
         from public.sales_returns sr
        where sr.invoice_id = i.id
          and sr.tenant_id = i.tenant_id
          and sr.status = 'completed'
     );

  if v_mismatch_count > 50 then
    raise exception 'FNB_00388_UNEXPECTED_MISMATCH_COUNT:%', v_mismatch_count
      using errcode = 'P0001';
  end if;
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
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_order record;
  v_closed_count integer := 0;
begin
  -- 00376 remains authoritative for auth, permission, locking, return lines,
  -- refund/customer credit, stock restoration, FIFO and audit handling.
  v_result := public._create_sales_return_atomic_impl_00376(
    p_invoice_id,
    p_items,
    p_refund_amount,
    p_refund_payment_method,
    p_reason,
    p_note,
    p_shift_id
  );

  -- Close KDS only after the return committed all invoice lines as returned.
  for v_order in
    select ko.id, ko.status, i.tenant_id
      from public.kitchen_orders ko
      join public.invoices i
        on i.id = ko.invoice_id
       and i.tenant_id = ko.tenant_id
     where i.id = p_invoice_id
       and i.source = 'fnb'
       and i.status = 'completed'
       and ko.status not in ('cancelled', 'completed', 'served')
       and exists (
         select 1 from public.invoice_items ii where ii.invoice_id = i.id
       )
       and not exists (
         select 1
           from public.invoice_items ii
          where ii.invoice_id = i.id
            and coalesce(ii.returned_qty, 0) < ii.quantity
       )
     for update of ko
  loop
    update public.kitchen_orders
       set status = 'cancelled',
           cancel_reason_code = 'full_sales_return',
           cancel_reason = coalesce(
             nullif(trim(p_reason), ''),
             'Đóng đơn bếp do hóa đơn đã được trả toàn bộ'
           ),
           cancelled_at = coalesce(cancelled_at, now()),
           cancelled_by = coalesce(cancelled_by, v_actor),
           updated_at = now()
     where id = v_order.id;

    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
    ) values (
      v_order.tenant_id,
      v_actor,
      'fnb_kitchen_order_cancelled_from_full_sales_return',
      'kitchen_order',
      v_order.id,
      jsonb_build_object('status', v_order.status),
      jsonb_build_object(
        'status', 'cancelled',
        'invoice_id', p_invoice_id,
        'sales_return_id', v_result->>'return_id',
        'reason', coalesce(nullif(trim(p_reason), ''), 'full_sales_return')
      )
    );

    v_closed_count := v_closed_count + 1;
  end loop;

  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('fnb_kitchen_orders_cancelled', v_closed_count);
end;
$$;

revoke all on function public._create_sales_return_atomic_impl_00376(
  uuid,jsonb,numeric,text,text,text,uuid
) from public, anon, authenticated;
revoke all on function public.create_sales_return_atomic(
  uuid,jsonb,numeric,text,text,text,uuid
) from public, anon;
grant execute on function public.create_sales_return_atomic(
  uuid,jsonb,numeric,text,text,text,uuid
) to authenticated;

comment on function public.create_sales_return_atomic(
  uuid,jsonb,numeric,text,text,text,uuid
) is '00388: preserve atomic sales return and close linked active KDS only after a full FnB return.';

-- Reconcile only the measured historical mismatch. No invoice, stock, cash or
-- Retail data is changed here.
with mismatches as (
  select ko.id, ko.status, i.tenant_id, sr.id as sales_return_id,
         sr.reason, sr.created_at, sr.created_by
    from public.kitchen_orders ko
    join public.invoices i
      on i.id = ko.invoice_id
     and i.tenant_id = ko.tenant_id
    join lateral (
      select r.id, r.reason, r.created_at, r.created_by
        from public.sales_returns r
       where r.invoice_id = i.id
         and r.tenant_id = i.tenant_id
         and r.status = 'completed'
       order by r.created_at desc, r.id desc
       limit 1
    ) sr on true
   where i.source = 'fnb'
     and i.status = 'completed'
     and ko.status not in ('cancelled', 'completed', 'served')
     and exists (
       select 1 from public.invoice_items ii where ii.invoice_id = i.id
     )
     and not exists (
       select 1
         from public.invoice_items ii
        where ii.invoice_id = i.id
          and coalesce(ii.returned_qty, 0) < ii.quantity
     )
), repaired as (
  update public.kitchen_orders ko
     set status = 'cancelled',
         cancel_reason_code = 'full_sales_return_reconcile',
         cancel_reason = coalesce(
           nullif(trim(m.reason), ''),
           'Đối soát đơn bếp theo hóa đơn F&B đã trả toàn bộ'
         ),
         cancelled_at = coalesce(ko.cancelled_at, m.created_at, now()),
         cancelled_by = coalesce(ko.cancelled_by, m.created_by),
         updated_at = now()
    from mismatches m
   where ko.id = m.id
  returning ko.id, m.status as old_status, m.tenant_id,
            m.sales_return_id, m.created_by
)
insert into public.audit_log (
  tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
)
select tenant_id, created_by,
       'fnb_kitchen_order_cancelled_from_full_sales_return_reconcile',
       'kitchen_order', id,
       jsonb_build_object('status', old_status),
       jsonb_build_object(
         'status', 'cancelled',
         'sales_return_id', sales_return_id,
         'migration', '00388'
       )
  from repaired;

do $$
declare
  v_definition text;
  v_remaining integer;
begin
  select lower(pg_get_functiondef(
    'public.create_sales_return_atomic(uuid,jsonb,numeric,text,text,text,uuid)'::regprocedure
  )) into v_definition;

  -- PostgreSQL normalizes whitespace and implicit text casts in pg_get_functiondef,
  -- so verify stable functional markers rather than formatting-sensitive fragments.
  if position('fnb_kitchen_orders_cancelled' in v_definition) = 0
     or position('_create_sales_return_atomic_impl_00376' in v_definition) = 0
     or position('full_sales_return' in v_definition) = 0 then
    raise exception 'FNB_00388_WRAPPER_VERIFY_FAILED' using errcode = 'P0001';
  end if;

  select count(*) into v_remaining
    from public.kitchen_orders ko
    join public.invoices i
      on i.id = ko.invoice_id
     and i.tenant_id = ko.tenant_id
   where i.source = 'fnb'
     and i.status = 'completed'
     and ko.status not in ('cancelled', 'completed', 'served')
     and exists (
       select 1 from public.invoice_items ii where ii.invoice_id = i.id
     )
     and not exists (
       select 1
         from public.invoice_items ii
        where ii.invoice_id = i.id
          and coalesce(ii.returned_qty, 0) < ii.quantity
     )
     and exists (
       select 1 from public.sales_returns sr
        where sr.invoice_id = i.id and sr.tenant_id = i.tenant_id
          and sr.status = 'completed'
     );

  if v_remaining <> 0 then
    raise exception 'FNB_00388_RECONCILE_FAILED:%', v_remaining using errcode = 'P0001';
  end if;
end;
$$;

commit;

select
  'K1_FULL_FNB_RETURN_CLOSES_KDS' as muc,
  pg_get_functiondef(
    'public.create_sales_return_atomic(uuid,jsonb,numeric,text,text,text,uuid)'::regprocedure
  ) like '%i.source = ''fnb''%' as dat
union all
select
  'K2_RETAIL_RETURN_PATH_PRESERVED',
  to_regprocedure(
    'public._create_sales_return_atomic_impl_00376(uuid,jsonb,numeric,text,text,text,uuid)'
  ) is not null
union all
select
  'K3_NO_FULLY_RETURNED_FNB_LEFT_ACTIVE',
  not exists (
    select 1
      from public.kitchen_orders ko
      join public.invoices i on i.id = ko.invoice_id and i.tenant_id = ko.tenant_id
     where i.source = 'fnb'
       and i.status = 'completed'
       and ko.status not in ('cancelled', 'completed', 'served')
       and exists (select 1 from public.invoice_items ii where ii.invoice_id = i.id)
       and not exists (
         select 1 from public.invoice_items ii
          where ii.invoice_id = i.id and coalesce(ii.returned_qty, 0) < ii.quantity
       )
  );
