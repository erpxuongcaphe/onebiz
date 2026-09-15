-- ============================================================================
-- 00380 - Close the linked FnB kitchen order when a completed invoice is voided
--
-- The shared invoice screen calls void_completed_invoice_atomic_v2 for both
-- Retail and FnB. The existing RPC correctly reverses stock and cash, but it
-- leaves the linked FnB kitchen order active. KDS can therefore keep showing a
-- paid/ready order after its invoice was cancelled.
--
-- This wrapper preserves the existing implementation byte-for-byte. It only
-- closes kitchen_orders when the already-voided invoice has source = 'fnb'.
-- Retail invoices never enter the FnB branch.
-- ============================================================================

begin;

do $$
declare
  v_definition text;
  v_mismatch_count integer;
begin
  if to_regclass('public.invoices') is null
     or to_regclass('public.kitchen_orders') is null
     or to_regclass('public.audit_log') is null then
    raise exception 'FNB_00380_REQUIRED_TABLE_MISSING' using errcode = 'P0001';
  end if;

  if to_regprocedure(
       'public._void_completed_invoice_atomic_v2_impl_00250(uuid,text,text,uuid)'
     ) is null then
    if to_regprocedure(
         'public.void_completed_invoice_atomic_v2(uuid,text,text,uuid)'
       ) is null then
      raise exception 'FNB_00380_REQUIRED_RPC_MISSING' using errcode = 'P0001';
    end if;

    select lower(pg_get_functiondef(
      'public.void_completed_invoice_atomic_v2(uuid,text,text,uuid)'::regprocedure
    )) into v_definition;

    if position('_void_completed_invoice_impl_00161' in v_definition) = 0
       or position('user_has_permission' in v_definition) = 0
       or position('insert into public.audit_log' in v_definition) = 0 then
      raise exception 'FNB_00380_RPC_FINGERPRINT_MISMATCH' using errcode = 'P0001';
    end if;

    alter function public.void_completed_invoice_atomic_v2(uuid,text,text,uuid)
      rename to _void_completed_invoice_atomic_v2_impl_00250;
  end if;

  select count(*) into v_mismatch_count
    from public.kitchen_orders ko
    join public.invoices i
      on i.id = ko.invoice_id
     and i.tenant_id = ko.tenant_id
   where i.source = 'fnb'
     and i.status = 'cancelled'
     and ko.status not in ('cancelled', 'completed');

  -- A large number means the production shape differs from the measured bug.
  -- Stop instead of silently changing broad historical data.
  if v_mismatch_count > 50 then
    raise exception 'FNB_00380_UNEXPECTED_MISMATCH_COUNT:%', v_mismatch_count
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.void_completed_invoice_atomic_v2(
  p_invoice_id uuid,
  p_reason text,
  p_refund_method text default null,
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
  -- The private 00250 implementation remains the source of truth for tenant,
  -- permission, branch, shift, stock, lot, cash and invoice audit handling.
  v_result := public._void_completed_invoice_atomic_v2_impl_00250(
    p_invoice_id,
    p_reason,
    p_refund_method,
    p_shift_id
  );

  -- The join on source is the hard boundary that leaves Retail untouched.
  for v_order in
    select ko.id, ko.status
      from public.kitchen_orders ko
      join public.invoices i
        on i.id = ko.invoice_id
       and i.tenant_id = ko.tenant_id
     where i.id = p_invoice_id
       and i.source = 'fnb'
       and i.status = 'cancelled'
       and ko.status not in ('cancelled', 'completed')
     for update of ko
  loop
    update public.kitchen_orders
       set status = 'cancelled',
           cancel_reason_code = 'invoice_void',
           cancel_reason = trim(p_reason),
           cancelled_at = coalesce(cancelled_at, now()),
           cancelled_by = coalesce(cancelled_by, v_actor),
           updated_at = now()
     where id = v_order.id;

    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
    )
    select
      i.tenant_id,
      v_actor,
      'fnb_kitchen_order_cancelled_from_invoice_void',
      'kitchen_order',
      v_order.id,
      jsonb_build_object('status', v_order.status),
      jsonb_build_object(
        'status', 'cancelled',
        'invoice_id', p_invoice_id,
        'reason', trim(p_reason)
      )
      from public.invoices i
     where i.id = p_invoice_id;

    v_closed_count := v_closed_count + 1;
  end loop;

  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('fnb_kitchen_orders_cancelled', v_closed_count);
end;
$$;

revoke all on function public._void_completed_invoice_atomic_v2_impl_00250(
  uuid,text,text,uuid
) from public, anon, authenticated;
revoke all on function public.void_completed_invoice_atomic_v2(
  uuid,text,text,uuid
) from public, anon;
grant execute on function public.void_completed_invoice_atomic_v2(
  uuid,text,text,uuid
) to authenticated;

comment on function public.void_completed_invoice_atomic_v2(uuid,text,text,uuid) is
  '00380: shared invoice void wrapper. Preserves 00250 and closes linked kitchen orders only for source=fnb.';

-- Repair the same integrity mismatch that existed before this wrapper. The
-- guarded preflight above prevents unexpectedly broad historical updates.
with mismatches as (
  select
    ko.id,
    i.cancelled_at as invoice_cancelled_at,
    i.cancelled_by as invoice_cancelled_by,
    i.cancel_reason as invoice_cancel_reason
  from public.kitchen_orders ko
  join public.invoices i
    on i.id = ko.invoice_id
   and i.tenant_id = ko.tenant_id
  where i.source = 'fnb'
    and i.status = 'cancelled'
    and ko.status not in ('cancelled', 'completed')
)
update public.kitchen_orders ko
   set status = 'cancelled',
       cancel_reason_code = 'invoice_void_reconcile',
       cancel_reason = coalesce(
         nullif(trim(m.invoice_cancel_reason), ''),
         'Đối soát đơn bếp theo hóa đơn FnB đã hủy'
       ),
       cancelled_at = coalesce(ko.cancelled_at, m.invoice_cancelled_at, now()),
       cancelled_by = coalesce(ko.cancelled_by, m.invoice_cancelled_by),
       updated_at = now()
  from mismatches m
 where ko.id = m.id;

do $$
declare
  v_definition text;
  v_remaining integer;
begin
  select lower(pg_get_functiondef(
    'public.void_completed_invoice_atomic_v2(uuid,text,text,uuid)'::regprocedure
  )) into v_definition;

  if position('i.source = ''fnb''' in v_definition) = 0
     or position('fnb_kitchen_orders_cancelled' in v_definition) = 0 then
    raise exception 'FNB_00380_WRAPPER_VERIFY_FAILED' using errcode = 'P0001';
  end if;

  select count(*) into v_remaining
    from public.kitchen_orders ko
    join public.invoices i
      on i.id = ko.invoice_id
     and i.tenant_id = ko.tenant_id
   where i.source = 'fnb'
     and i.status = 'cancelled'
     and ko.status not in ('cancelled', 'completed');

  if v_remaining <> 0 then
    raise exception 'FNB_00380_RECONCILE_FAILED:%', v_remaining using errcode = 'P0001';
  end if;
end;
$$;

commit;

select
  'K1_FNB_VOID_CLOSES_KDS' as muc,
  (
    select lower(pg_get_functiondef(
      'public.void_completed_invoice_atomic_v2(uuid,text,text,uuid)'::regprocedure
    )) like '%i.source = ''fnb''%'
  ) as dat
union all
select
  'K2_NO_CANCELLED_FNB_LEFT_ACTIVE',
  not exists (
    select 1
      from public.kitchen_orders ko
      join public.invoices i
        on i.id = ko.invoice_id
       and i.tenant_id = ko.tenant_id
     where i.source = 'fnb'
       and i.status = 'cancelled'
       and ko.status not in ('cancelled', 'completed')
  );
