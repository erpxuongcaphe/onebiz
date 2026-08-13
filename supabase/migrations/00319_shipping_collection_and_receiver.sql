-- ============================================================
-- 00319: Separate invoice debt from shipment collection.
--
-- Safety:
--   * No existing shipment, invoice, debt, stock or cash row is updated.
--   * Existing shipments keep collection_mode = NULL (legacy/unknown).
--   * New clients use v2 RPCs with an explicit collection decision.
-- ============================================================

alter table public.shipping_orders
  add column if not exists collection_mode text,
  add column if not exists receiver_customer_id uuid
    references public.customers(id) on delete set null;

alter table public.shipping_orders
  drop constraint if exists shipping_orders_collection_mode_check;

alter table public.shipping_orders
  add constraint shipping_orders_collection_mode_check
  check (collection_mode is null or collection_mode in ('cod', 'none'));

comment on column public.shipping_orders.collection_mode is
  'cod = courier collects invoice balance; none = courier does not collect; NULL = legacy shipment.';
comment on column public.shipping_orders.receiver_customer_id is
  'Optional linked customer for the receiver. Receiver name/phone/address remain immutable snapshots.';

-- Compatibility guard: old draft/order code may recalculate cod_amount. Once a
-- shipment is explicitly marked "none", it must never regain a COD amount.
create or replace function public.guard_shipping_collection_00319()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.receiver_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.receiver_customer_id
      and c.tenant_id = new.tenant_id
      and coalesce(c.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'SHIPMENT_RECEIVER_CUSTOMER_INVALID';
  end if;
  if new.collection_mode = 'none' then
    new.cod_amount := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_shipping_collection_00319 on public.shipping_orders;
create trigger trg_guard_shipping_collection_00319
before insert or update of cod_amount, collection_mode, receiver_customer_id
on public.shipping_orders
for each row execute function public.guard_shipping_collection_00319();

create or replace function public.attach_invoice_shipment_atomic_v2(
  p_invoice_id uuid,
  p_delivery_fee numeric,
  p_receiver_name text,
  p_receiver_phone text,
  p_receiver_address text,
  p_partner_id uuid,
  p_note text,
  p_collection_mode text,
  p_receiver_customer_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_result jsonb;
  v_shipment_id uuid;
  v_debt numeric;
  v_existing_mode text;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_collection_mode not in ('cod', 'none') then
    raise exception using errcode = '22023', message = 'SHIPMENT_COLLECTION_MODE_INVALID';
  end if;
  if p_receiver_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = p_receiver_customer_id
      and c.tenant_id = v_tenant_id
      and coalesce(c.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'SHIPMENT_RECEIVER_CUSTOMER_INVALID';
  end if;

  -- Reuse the hardened fee/debt/permission path. This call and the updates below
  -- are one transaction, so any validation failure rolls everything back.
  v_result := public.attach_invoice_shipment_atomic(
    p_invoice_id, p_delivery_fee, p_receiver_name, p_receiver_phone,
    p_receiver_address, p_partner_id, p_note
  );
  v_shipment_id := nullif(v_result->>'shipment_id', '')::uuid;

  if v_shipment_id is not null then
    select so.collection_mode
      into v_existing_mode
      from public.shipping_orders so
     where so.id = v_shipment_id and so.tenant_id = v_tenant_id
     for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'SHIPMENT_NOT_FOUND';
    end if;
    if v_existing_mode is not null and v_existing_mode <> p_collection_mode then
      raise exception using errcode = '23505', message = 'ACTIVE_SHIPMENT_COLLECTION_MISMATCH';
    end if;

    select greatest(0, coalesce(i.debt, 0))
      into v_debt
      from public.invoices i
     where i.id = p_invoice_id and i.tenant_id = v_tenant_id;

    update public.shipping_orders
       set collection_mode = p_collection_mode,
           receiver_customer_id = p_receiver_customer_id,
           cod_amount = case when p_collection_mode = 'cod' then v_debt else 0 end,
           updated_at = now()
     where id = v_shipment_id and tenant_id = v_tenant_id;

    v_result := v_result || jsonb_build_object(
      'collection_mode', p_collection_mode,
      'cod_amount', case when p_collection_mode = 'cod' then v_debt else 0 end,
      'receiver_customer_id', p_receiver_customer_id
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.save_sales_order_atomic_v2(
  p_order_id uuid,
  p_requested_code text,
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_delivery_fee numeric,
  p_note text,
  p_partner_id uuid,
  p_receiver_name text,
  p_receiver_phone text,
  p_receiver_address text,
  p_collection_mode text,
  p_receiver_customer_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_result jsonb;
  v_shipment_id uuid;
  v_total numeric;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_collection_mode not in ('cod', 'none') then
    raise exception using errcode = '22023', message = 'SHIPMENT_COLLECTION_MODE_INVALID';
  end if;
  if p_receiver_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = p_receiver_customer_id
      and c.tenant_id = v_tenant_id
      and coalesce(c.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'SHIPMENT_RECEIVER_CUSTOMER_INVALID';
  end if;

  v_result := public.save_sales_order_atomic(
    p_order_id, p_requested_code, p_branch_id, p_customer_id, p_items,
    p_delivery_fee, p_note, p_partner_id, p_receiver_name,
    p_receiver_phone, p_receiver_address
  );
  v_shipment_id := nullif(v_result->>'shipment_id', '')::uuid;
  v_total := greatest(0, coalesce((v_result->>'total')::numeric, 0));

  if v_shipment_id is not null then
    update public.shipping_orders
       set collection_mode = p_collection_mode,
           receiver_customer_id = p_receiver_customer_id,
           cod_amount = case when p_collection_mode = 'cod' then v_total else 0 end,
           updated_at = now()
     where id = v_shipment_id and tenant_id = v_tenant_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'SHIPMENT_NOT_FOUND';
    end if;
    v_result := v_result || jsonb_build_object(
      'collection_mode', p_collection_mode,
      'cod_amount', case when p_collection_mode = 'cod' then v_total else 0 end,
      'receiver_customer_id', p_receiver_customer_id
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.attach_invoice_shipment_atomic_v2(
  uuid, numeric, text, text, text, uuid, text, text, uuid
) from public, anon;
grant execute on function public.attach_invoice_shipment_atomic_v2(
  uuid, numeric, text, text, text, uuid, text, text, uuid
) to authenticated;

revoke all on function public.save_sales_order_atomic_v2(
  uuid, text, uuid, uuid, jsonb, numeric, text, uuid, text, text, text, text, uuid
) from public, anon;
grant execute on function public.save_sales_order_atomic_v2(
  uuid, text, uuid, uuid, jsonb, numeric, text, uuid, text, text, text, text, uuid
) to authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.attach_invoice_shipment_atomic_v2(uuid,numeric,text,text,text,uuid,text,text,uuid)') is not null as shipment_v2_ok,
  to_regprocedure('public.save_sales_order_atomic_v2(uuid,text,uuid,uuid,jsonb,numeric,text,uuid,text,text,text,text,uuid)') is not null as sales_order_v2_ok,
  exists (
    select 1 from pg_trigger
    where tgname = 'trg_guard_shipping_collection_00319' and not tgisinternal
  ) as no_collection_guard_ok;
