-- ============================================================
-- 00289: Atomic state transitions for input invoices/internal sales
-- ============================================================
-- Schema and function definitions only. Applying this migration does not
-- update stock, stock movements, cash transactions, or existing documents.

begin;

do $$
begin
  if exists (
    select 1
      from public.input_invoices
     where status not in ('recorded', 'unrecorded', 'cancelled')
  ) then
    raise exception 'INPUT_INVOICE_STATUS_PREFLIGHT_FAILED';
  end if;
end;
$$;

alter table public.input_invoices
  drop constraint if exists input_invoices_status_check;

alter table public.input_invoices
  add constraint input_invoices_status_check
  check (status in ('recorded', 'unrecorded', 'cancelled')) not valid;

alter table public.input_invoices
  validate constraint input_invoices_status_check;

create or replace function public.set_input_invoice_state_atomic(
  p_invoice_id uuid,
  p_action text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_invoice record;
  v_new_status text;
  v_new_note text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.adjust') then
    raise exception using errcode = '42501', message = 'INPUT_INVOICE_STATE_DENIED';
  end if;

  select ii.id, ii.code, ii.branch_id, ii.status, ii.note
    into v_invoice
    from public.input_invoices ii
   where ii.id = p_invoice_id
     and ii.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'INPUT_INVOICE_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'INPUT_INVOICE_BRANCH_DENIED';
  end if;

  if v_action = 'record' then
    if v_invoice.status = 'recorded' then
      return jsonb_build_object(
        'id', v_invoice.id, 'code', v_invoice.code,
        'status', 'recorded', 'idempotent', true
      );
    end if;
    if v_invoice.status <> 'unrecorded' then
      raise exception using errcode = '22023', message = 'INPUT_INVOICE_NOT_RECORDABLE';
    end if;
    v_new_status := 'recorded';
    v_new_note := v_invoice.note;
  elsif v_action = 'cancel' then
    if v_reason is null or length(v_reason) < 5 then
      raise exception using errcode = '22023', message = 'INPUT_INVOICE_CANCEL_REASON_REQUIRED';
    end if;
    if v_invoice.status = 'cancelled' then
      return jsonb_build_object(
        'id', v_invoice.id, 'code', v_invoice.code,
        'status', 'cancelled', 'idempotent', true
      );
    end if;
    if v_invoice.status not in ('unrecorded', 'recorded') then
      raise exception using errcode = '22023', message = 'INPUT_INVOICE_NOT_CANCELLABLE';
    end if;
    v_new_status := 'cancelled';
    v_new_note := concat_ws(
      E'\n', nullif(trim(coalesce(v_invoice.note, '')), ''), '[ĐÃ HỦY] ' || v_reason
    );
  else
    raise exception using errcode = '22023', message = 'INPUT_INVOICE_ACTION_INVALID';
  end if;

  update public.input_invoices
     set status = v_new_status,
         note = v_new_note,
         updated_at = now()
   where id = v_invoice.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    case when v_action = 'record' then 'input_invoice_recorded'
         else 'input_invoice_cancelled' end,
    'input_invoice',
    v_invoice.id,
    jsonb_build_object('status', v_invoice.status, 'note', v_invoice.note),
    jsonb_build_object(
      'status', v_new_status, 'note', v_new_note,
      'reason', v_reason, 'atomic', true
    )
  );

  return jsonb_build_object(
    'id', v_invoice.id, 'code', v_invoice.code,
    'status', v_new_status, 'idempotent', false
  );
end;
$$;

create or replace function public.cancel_internal_sale_atomic(
  p_internal_sale_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_sale record;
  v_new_note text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.internal_export') then
    raise exception using errcode = '42501', message = 'INTERNAL_SALE_CANCEL_DENIED';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception using errcode = '22023', message = 'INTERNAL_SALE_CANCEL_REASON_REQUIRED';
  end if;

  select s.id, s.code, s.from_branch_id, s.to_branch_id, s.status, s.note
    into v_sale
    from public.internal_sales s
   where s.id = p_internal_sale_id
     and s.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'INTERNAL_SALE_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_sale.from_branch_id)
     or not public.user_has_branch_access(v_actor, v_sale.to_branch_id) then
    raise exception using errcode = '42501', message = 'INTERNAL_SALE_BRANCH_DENIED';
  end if;
  if v_sale.status = 'cancelled' then
    return jsonb_build_object(
      'id', v_sale.id, 'code', v_sale.code,
      'status', 'cancelled', 'idempotent', true
    );
  end if;
  if v_sale.status not in ('draft', 'confirmed') then
    raise exception using errcode = '22023', message = 'INTERNAL_SALE_NOT_CANCELLABLE';
  end if;

  v_new_note := concat_ws(
    E'\n', nullif(trim(coalesce(v_sale.note, '')), ''), '[ĐÃ HỦY] ' || v_reason
  );

  update public.internal_sales
     set status = 'cancelled', note = v_new_note, updated_at = now()
   where id = v_sale.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'internal_sale_cancelled', 'internal_sale', v_sale.id,
    jsonb_build_object('status', v_sale.status, 'note', v_sale.note),
    jsonb_build_object(
      'status', 'cancelled', 'note', v_new_note,
      'reason', v_reason, 'stock_changed', false, 'atomic', true
    )
  );

  return jsonb_build_object(
    'id', v_sale.id, 'code', v_sale.code,
    'status', 'cancelled', 'stock_changed', false, 'idempotent', false
  );
end;
$$;

revoke all on function public.set_input_invoice_state_atomic(uuid, text, text) from public, anon, authenticated;
revoke all on function public.cancel_internal_sale_atomic(uuid, text) from public, anon, authenticated;
grant execute on function public.set_input_invoice_state_atomic(uuid, text, text) to authenticated;
grant execute on function public.cancel_internal_sale_atomic(uuid, text) to authenticated;

-- Browser users read these tables directly, but all mutations now go through
-- guarded SECURITY DEFINER functions above/existing atomic creation RPCs.
revoke insert, update, delete on table public.input_invoices from authenticated;
revoke insert, update, delete on table public.internal_sales from authenticated;
grant select on table public.input_invoices to authenticated;
grant select on table public.internal_sales to authenticated;

comment on function public.set_input_invoice_state_atomic(uuid, text, text) is
  'Ghi sổ/hủy hóa đơn đầu vào atomically with effective permission, branch scope and audit. Does not change stock.';
comment on function public.cancel_internal_sale_atomic(uuid, text) is
  'Cancel draft/confirmed internal sale atomically. Completed sales require a separate reversal workflow.';

commit;

-- Read-only postflight. Expected: all true.
select
  to_regprocedure('public.set_input_invoice_state_atomic(uuid,text,text)') is not null
    as input_invoice_rpc_ok,
  to_regprocedure('public.cancel_internal_sale_atomic(uuid,text)') is not null
    as internal_sale_rpc_ok,
  exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.input_invoices'::regclass
       and c.conname = 'input_invoices_status_check'
       and pg_get_constraintdef(c.oid) like '%cancelled%'
  ) as cancelled_status_ok;
