-- 00346: Replay-safe purchase-order creation.
--
-- A browser can lose the HTTP response after the database transaction has
-- committed. The UI already reserves a unique PO code before saving. This
-- wrapper serializes retries by that code and reuses the proven UOM-aware save.

begin;

do $$
begin
  if to_regprocedure(
    'public.save_purchase_order_with_uom_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'
  ) is null then
    raise exception '00346: UOM-aware purchase save signature is missing';
  end if;
end;
$$;

create table if not exists public.purchase_order_save_keys (
  tenant_id uuid not null,
  reserved_code text not null,
  request_hash text not null,
  actor_id uuid not null,
  purchase_order_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, reserved_code)
);

comment on table public.purchase_order_save_keys is
  '00346 server-only idempotency keys for purchase receipt creation.';
alter table public.purchase_order_save_keys enable row level security;
revoke all on table public.purchase_order_save_keys from public, anon, authenticated;

create or replace function public.save_purchase_order_with_uom_atomic_v2(
  p_purchase_order_id uuid,
  p_requested_code text,
  p_branch_id uuid,
  p_supplier_id uuid,
  p_note text,
  p_shipping_cost numeric,
  p_other_cost numeric,
  p_order_discount numeric,
  p_paid_amount numeric,
  p_payment_method text,
  p_mark_ordered boolean,
  p_receive_now boolean,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_code text := nullif(trim(coalesce(p_requested_code, '')), '');
  v_request_hash text;
  v_saved_hash text;
  v_existing record;
  v_result jsonb;
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

  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;

  -- Existing-draft edits retain the original 00320 behavior. Replay safety is
  -- required for new documents, where a lost response could create a duplicate.
  if p_purchase_order_id is not null then
    return public.save_purchase_order_with_uom_atomic(
      p_purchase_order_id, p_requested_code, p_branch_id, p_supplier_id,
      p_note, p_shipping_cost, p_other_cost, p_order_discount, p_paid_amount,
      p_payment_method, p_mark_ordered, p_receive_now, p_items
    ) || jsonb_build_object('idempotent', false);
  end if;

  if v_code is null or length(v_code) > 50 then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_CODE_REQUIRED';
  end if;

  v_request_hash := md5(jsonb_build_object(
    'branch_id', p_branch_id,
    'supplier_id', p_supplier_id,
    'note', p_note,
    'shipping_cost', p_shipping_cost,
    'other_cost', p_other_cost,
    'order_discount', p_order_discount,
    'paid_amount', p_paid_amount,
    'payment_method', p_payment_method,
    'mark_ordered', p_mark_ordered,
    'receive_now', p_receive_now,
    'items', p_items
  )::text);

  if not exists (
    select 1
      from public.branches b
     where b.id = p_branch_id
       and b.tenant_id = v_tenant_id
       and coalesce(b.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'BRANCH_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  if not exists (
    select 1
      from public.suppliers s
     where s.id = p_supplier_id
       and s.tenant_id = v_tenant_id
       and coalesce(s.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'SUPPLIER_NOT_FOUND';
  end if;

  -- Same tenant + reserved PO code is one logical create operation. Concurrent
  -- requests wait here, then the follower returns the committed receipt.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant_id::text || ':' || v_code, 0)
  );

  select po.id, po.code, po.status, po.total, po.paid, po.debt,
         po.branch_id, po.supplier_id, po.created_by
    into v_existing
    from public.purchase_orders po
   where po.tenant_id = v_tenant_id
     and po.code = v_code
   for update;

  if found then
    select k.request_hash
      into v_saved_hash
      from public.purchase_order_save_keys k
     where k.tenant_id = v_tenant_id
       and k.reserved_code = v_code
       and k.purchase_order_id = v_existing.id;

    if v_saved_hash is null
       or v_saved_hash <> v_request_hash
       or v_existing.created_by <> v_actor
       or v_existing.branch_id <> p_branch_id
       or v_existing.supplier_id <> p_supplier_id then
      raise exception using errcode = '23505', message = 'PURCHASE_ORDER_CODE_CONFLICT';
    end if;

    return jsonb_build_object(
      'purchase_order_id', v_existing.id,
      'code', v_existing.code,
      'status', v_existing.status,
      'total', v_existing.total,
      'paid', v_existing.paid,
      'debt', v_existing.debt,
      'idempotent', true
    );
  end if;

  insert into public.purchase_order_save_keys (
    tenant_id, reserved_code, request_hash, actor_id
  ) values (
    v_tenant_id, v_code, v_request_hash, v_actor
  );

  v_result := public.save_purchase_order_with_uom_atomic(
    null, v_code, p_branch_id, p_supplier_id, p_note, p_shipping_cost,
    p_other_cost, p_order_discount, p_paid_amount, p_payment_method,
    p_mark_ordered, p_receive_now, p_items
  );

  update public.purchase_order_save_keys
     set purchase_order_id = (v_result->>'purchase_order_id')::uuid
   where tenant_id = v_tenant_id
     and reserved_code = v_code;

  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

revoke all on function public.save_purchase_order_with_uom_atomic_v2(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric, text,
  boolean, boolean, jsonb
) from public, anon;
grant execute on function public.save_purchase_order_with_uom_atomic_v2(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric, text,
  boolean, boolean, jsonb
) to authenticated;

comment on function public.save_purchase_order_with_uom_atomic_v2(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric, text,
  boolean, boolean, jsonb
) is '00346 replay-safe wrapper: one new purchase receipt per reserved tenant PO code.';

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.save_purchase_order_with_uom_atomic_v2(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'::regprocedure
  ) into v_def;
  if v_def not ilike '%pg_advisory_xact_lock%'
     or v_def not ilike '%PURCHASE_ORDER_CODE_CONFLICT%'
     or v_def not ilike '%v_saved_hash <> v_request_hash%'
     or v_def not ilike '%created_by <> v_actor%'
     or v_def not ilike '%user_has_branch_access%' then
    raise exception '00346: replay, actor, or branch guard is missing';
  end if;
  if has_function_privilege('anon',
       'public.save_purchase_order_with_uom_atomic_v2(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)',
       'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.save_purchase_order_with_uom_atomic_v2(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)',
       'EXECUTE') then
    raise exception '00346: function grants are incorrect';
  end if;
end;
$$;

commit;
notify pgrst, 'reload schema';
