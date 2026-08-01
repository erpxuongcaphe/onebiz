-- ============================================================
-- 00264: Atomic retail POS draft save
-- ============================================================
-- Function definition only. Existing invoices, stock, debt and cash are untouched.

create or replace function public.save_pos_draft_atomic(
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_total numeric,
  p_shipping_fee numeric,
  p_note text,
  p_client_session_id text,
  p_auto_saved boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_session_id uuid;
  v_invoice record;
  v_has_existing boolean := false;
  v_invoice_id uuid;
  v_invoice_code text;
  v_customer_name text := 'Khách lẻ';
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_vat_rate numeric;
  v_line_total numeric;
  v_auto_saved boolean := coalesce(p_auto_saved, false);
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.save_draft') then
    raise exception using errcode = '42501', message = 'POS_SAVE_DRAFT_DENIED';
  end if;
  if not exists (
    select 1 from public.branches b
    where b.id = p_branch_id
      and b.tenant_id = v_tenant_id
      and coalesce(b.is_active, true)
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'mixed') then
    raise exception using errcode = '22023', message = 'POS_PAYMENT_METHOD_INVALID';
  end if;
  if p_subtotal is null or p_subtotal < 0 or p_subtotal = 'NaN'::numeric
     or p_discount_amount is null or p_discount_amount < 0 or p_discount_amount = 'NaN'::numeric
     or p_total is null or p_total < 0 or p_total = 'NaN'::numeric
     or coalesce(p_shipping_fee, 0) < 0 or coalesce(p_shipping_fee, 0) = 'NaN'::numeric then
    raise exception using errcode = '22023', message = 'POS_DRAFT_TOTAL_INVALID';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 500 then
    raise exception using errcode = '22023', message = 'POS_DRAFT_ITEMS_INVALID';
  end if;

  if nullif(trim(coalesce(p_client_session_id, '')), '') is not null then
    begin
      v_session_id := trim(p_client_session_id)::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
    end;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_tenant_id::text || ':' || v_session_id::text, 264)
    );
  end if;

  if p_customer_id is not null then
    select c.name into v_customer_name
      from public.customers c
     where c.id = p_customer_id
       and c.tenant_id = v_tenant_id
       and coalesce(c.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'POS_CUSTOMER_INVALID';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item->>'productId', '')::uuid;
      v_variant_id := nullif(v_item->>'variantId', '')::uuid;
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
      v_unit_price := nullif(v_item->>'unitPrice', '')::numeric;
      v_discount := coalesce(nullif(v_item->>'discount', '')::numeric, 0);
      v_vat_rate := coalesce(nullif(v_item->>'vatRate', '')::numeric, 0);
    exception when others then
      raise exception using errcode = '22023', message = 'POS_DRAFT_ITEM_INVALID';
    end;
    if v_product_id is null
       or v_quantity is null or v_quantity <= 0 or v_quantity = 'NaN'::numeric
       or v_unit_price is null or v_unit_price < 0 or v_unit_price = 'NaN'::numeric
       or v_discount < 0 or v_discount = 'NaN'::numeric
       or v_vat_rate < 0 or v_vat_rate > 100 or v_vat_rate = 'NaN'::numeric
       or v_discount > v_quantity * v_unit_price then
      raise exception using errcode = '22023', message = 'POS_DRAFT_ITEM_INVALID';
    end if;
    select p.id, p.name, p.unit into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'POS_PRODUCT_INVALID';
    end if;
    if v_variant_id is not null and not exists (
      select 1 from public.product_variants pv
      where pv.id = v_variant_id
        and pv.tenant_id = v_tenant_id
        and pv.product_id = v_product_id
        and coalesce(pv.is_active, true)
    ) then
      raise exception using errcode = '22023', message = 'POS_VARIANT_INVALID';
    end if;
  end loop;

  if v_session_id is not null then
    select i.id, i.code, i.status, i.source, i.branch_id
      into v_invoice
      from public.invoices i
     where i.tenant_id = v_tenant_id
       and i.client_session_id = v_session_id
       and i.deleted_at is null
     order by i.created_at desc
     limit 1
     for update;
    v_has_existing := found;
    if v_has_existing and v_invoice.status <> 'draft' then
      return jsonb_build_object(
        'invoice_id', v_invoice.id, 'invoice_code', v_invoice.code,
        'status', v_invoice.status, 'idempotent', true
      );
    end if;
    if v_has_existing and v_invoice.branch_id <> p_branch_id then
      raise exception using errcode = '42501', message = 'POS_DRAFT_BRANCH_MISMATCH';
    end if;
  end if;

  if not v_has_existing then
    v_invoice_code := public.next_code(v_tenant_id, 'pos_draft');
    insert into public.invoices (
      tenant_id, branch_id, code, customer_id, customer_name, status,
      subtotal, discount_amount, tax_amount, delivery_fee, total, paid, debt,
      payment_method, note, source, created_by, client_session_id, auto_saved
    ) values (
      v_tenant_id, p_branch_id, v_invoice_code, p_customer_id, v_customer_name, 'draft',
      p_subtotal, p_discount_amount,
      greatest(0, p_total - p_subtotal + p_discount_amount - coalesce(p_shipping_fee, 0)),
      coalesce(p_shipping_fee, 0), p_total, 0, p_total,
      p_payment_method, nullif(trim(coalesce(p_note, '')), ''), 'pos',
      v_actor, v_session_id, v_auto_saved
    ) returning id, code into v_invoice_id, v_invoice_code;
  else
    v_invoice_id := v_invoice.id;
    v_invoice_code := v_invoice.code;
    update public.invoices
       set customer_id = p_customer_id,
           customer_name = v_customer_name,
           subtotal = p_subtotal,
           discount_amount = p_discount_amount,
           tax_amount = greatest(0, p_total - p_subtotal + p_discount_amount - coalesce(p_shipping_fee, 0)),
           delivery_fee = coalesce(p_shipping_fee, 0),
           total = p_total,
           paid = 0,
           debt = p_total,
           payment_method = p_payment_method,
           note = nullif(trim(coalesce(p_note, '')), ''),
           auto_saved = case when v_invoice.source = 'order' then auto_saved else v_auto_saved end,
           updated_at = now()
     where id = v_invoice_id
       and tenant_id = v_tenant_id
       and status = 'draft'
       and deleted_at is null;
    delete from public.invoice_items ii where ii.invoice_id = v_invoice_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'productId', '')::uuid;
    v_variant_id := nullif(v_item->>'variantId', '')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unitPrice')::numeric;
    v_discount := coalesce(nullif(v_item->>'discount', '')::numeric, 0);
    v_vat_rate := coalesce(nullif(v_item->>'vatRate', '')::numeric, 0);
    select p.id, p.name, p.unit into v_product
      from public.products p
     where p.id = v_product_id and p.tenant_id = v_tenant_id;
    v_line_total := round(v_quantity * v_unit_price - v_discount, 2);

    insert into public.invoice_items (
      invoice_id, product_id, variant_id, product_name, unit, quantity,
      unit_price, discount, vat_rate, vat_amount, total, note
    ) values (
      v_invoice_id, v_product_id, v_variant_id,
      coalesce(nullif(trim(coalesce(v_item->>'productName', '')), ''), v_product.name),
      coalesce(nullif(trim(coalesce(v_item->>'unit', '')), ''), v_product.unit, 'Cái'),
      v_quantity, v_unit_price, v_discount, v_vat_rate,
      round(v_line_total * v_vat_rate / 100), v_line_total,
      nullif(trim(coalesce(v_item->>'note', '')), '')
    );
  end loop;

  return jsonb_build_object(
    'invoice_id', v_invoice_id, 'invoice_code', v_invoice_code,
    'status', 'draft', 'idempotent', false
  );
end;
$$;

revoke all on function public.save_pos_draft_atomic(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, numeric, text, text, boolean
) from public, anon;
grant execute on function public.save_pos_draft_atomic(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, numeric, text, text, boolean
) to authenticated;

comment on function public.save_pos_draft_atomic(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, numeric, text, text, boolean
) is 'Atomically inserts or replaces a retail POS draft without stock, debt-ledger or cash side effects.';

create or replace function public.adopt_pos_draft_session_atomic(
  p_invoice_id uuid,
  p_client_session_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_session_id uuid;
  v_invoice record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  begin
    v_session_id := nullif(trim(coalesce(p_client_session_id, '')), '')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
  end;
  if v_session_id is null then
    raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.save_draft') then
    raise exception using errcode = '42501', message = 'POS_SAVE_DRAFT_DENIED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant_id::text || ':' || v_session_id::text, 264)
  );

  select i.id, i.code, i.branch_id, i.status, i.client_session_id
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null
   for update;
  if not found or v_invoice.status <> 'draft' then
    raise exception using errcode = '22023', message = 'POS_DRAFT_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if v_invoice.client_session_id = v_session_id then
    return jsonb_build_object('invoice_id', v_invoice.id, 'invoice_code', v_invoice.code, 'idempotent', true);
  end if;
  if exists (
    select 1 from public.invoices other
    where other.tenant_id = v_tenant_id
      and other.client_session_id = v_session_id
      and other.id <> v_invoice.id
      and other.deleted_at is null
  ) then
    raise exception using errcode = '23505', message = 'POS_SESSION_ALREADY_USED';
  end if;

  update public.invoices
     set client_session_id = v_session_id, updated_at = now()
   where id = v_invoice.id and tenant_id = v_tenant_id;
  return jsonb_build_object('invoice_id', v_invoice.id, 'invoice_code', v_invoice.code, 'idempotent', false);
end;
$$;

create or replace function public.soft_delete_pos_draft_atomic(
  p_invoice_id uuid,
  p_only_auto_saved boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_invoice record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.save_draft') then
    raise exception using errcode = '42501', message = 'POS_SAVE_DRAFT_DENIED';
  end if;

  select i.id, i.code, i.branch_id, i.status, i.source, i.auto_saved
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('invoice_id', p_invoice_id, 'deleted', false, 'idempotent', true);
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if v_invoice.status <> 'draft'
     or coalesce(v_invoice.source, 'pos') = 'order'
     or (coalesce(p_only_auto_saved, false) and not coalesce(v_invoice.auto_saved, false)) then
    return jsonb_build_object('invoice_id', v_invoice.id, 'deleted', false, 'idempotent', true);
  end if;

  update public.invoices
     set deleted_at = now(), client_session_id = null, updated_at = now()
   where id = v_invoice.id and tenant_id = v_tenant_id;
  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  values (
    v_tenant_id, v_actor, 'soft_delete', 'pos_draft', v_invoice.id,
    jsonb_build_object('code', v_invoice.code, 'status', v_invoice.status, 'auto_saved', v_invoice.auto_saved),
    jsonb_build_object('deleted_at', now(), 'atomic', true)
  );
  return jsonb_build_object('invoice_id', v_invoice.id, 'deleted', true, 'idempotent', false);
end;
$$;

revoke all on function public.adopt_pos_draft_session_atomic(uuid, text)
  from public, anon;
grant execute on function public.adopt_pos_draft_session_atomic(uuid, text)
  to authenticated;
revoke all on function public.soft_delete_pos_draft_atomic(uuid, boolean)
  from public, anon;
grant execute on function public.soft_delete_pos_draft_atomic(uuid, boolean)
  to authenticated;

select to_regprocedure(
  'public.save_pos_draft_atomic(uuid,uuid,jsonb,text,numeric,numeric,numeric,numeric,text,text,boolean)'
) is not null as save_pos_draft_atomic_ok;

select
  to_regprocedure('public.adopt_pos_draft_session_atomic(uuid,text)') is not null as adopt_pos_draft_session_atomic_ok,
  to_regprocedure('public.soft_delete_pos_draft_atomic(uuid,boolean)') is not null as soft_delete_pos_draft_atomic_ok;
