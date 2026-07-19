-- 00203: POS stock integrity and concurrency hardening.
-- Schema-only migration. It does not update, reconcile or delete existing data.

create or replace function public.assert_pos_stock_available(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_items jsonb,
  p_allow_bom_shortage boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_shortage record;
  v_bom_id uuid;
begin
  if p_tenant_id is null or p_branch_id is null then
    raise exception using errcode = '22023', message = 'POS_STOCK_SCOPE_REQUIRED';
  end if;
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'POS_ITEMS_REQUIRED';
  end if;

  -- One checkout at a time per branch. The lock is transaction-scoped and
  -- covers missing branch_stock rows as well as existing rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_branch_id::text, 203)
  );

  for v_item in
    with parsed as (
      select
        (item->>'productId')::uuid as product_id,
        (item->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_items) item
    )
    select
      p.id as product_id,
      p.name as product_name,
      p.status,
      coalesce(p.has_bom, false) as has_bom,
      sum(parsed.quantity) as required
    from parsed
    left join public.products p
      on p.id = parsed.product_id
     and p.tenant_id = p_tenant_id
    group by p.id, p.name, p.status, p.has_bom
  loop
    if v_item.product_id is null then
      raise exception using errcode = '22023', message = 'POS_PRODUCT_INVALID';
    end if;
    if v_item.required is null or v_item.required <= 0 then
      raise exception using errcode = '22023', message = 'POS_QUANTITY_INVALID';
    end if;
    if coalesce(v_item.status, '') <> 'active' then
      raise exception using errcode = 'P0001',
        message = 'POS_PRODUCT_INACTIVE|' || v_item.product_id::text;
    end if;

    if v_item.has_bom
       and public.should_cascade_bom_at_branch(
         v_item.product_id,
         p_branch_id
       ) then
      v_bom_id := public.get_active_bom_for_branch(
        v_item.product_id,
        p_branch_id,
        null
      );
      if v_bom_id is null then
        raise exception using errcode = 'P0001',
          message = 'POS_BOM_UNAVAILABLE|' || v_item.product_id::text;
      end if;
    end if;
  end loop;

  -- Products that are decremented directly must never go below zero.
  for v_shortage in
    with parsed as (
      select
        (item->>'productId')::uuid as product_id,
        (item->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_items) item
    ),
    requested as (
      select product_id, sum(quantity) as required
      from parsed
      group by product_id
    )
    select
      r.product_id,
      p.name as product_name,
      r.required,
      coalesce((
        select sum(bs.quantity)
        from public.branch_stock bs
        where bs.tenant_id = p_tenant_id
          and bs.branch_id = p_branch_id
          and bs.product_id = r.product_id
          and bs.variant_id is null
      ), 0) as available
    from requested r
    join public.products p
      on p.id = r.product_id
     and p.tenant_id = p_tenant_id
    where not (
      coalesce(p.has_bom, false)
      and public.should_cascade_bom_at_branch(p.id, p_branch_id)
    )
      and coalesce((
        select sum(bs.quantity)
        from public.branch_stock bs
        where bs.tenant_id = p_tenant_id
          and bs.branch_id = p_branch_id
          and bs.product_id = r.product_id
          and bs.variant_id is null
      ), 0) < r.required
  loop
    raise exception using errcode = 'P0001',
      message = format(
        'POS_STOCK_SHORTAGE|%s|%s|%s|%s',
        v_shortage.product_id,
        coalesce(v_shortage.product_name, 'Sản phẩm'),
        v_shortage.required,
        v_shortage.available
      );
  end loop;

  if not p_allow_bom_shortage then
    -- Aggregate shared materials across the whole cart before comparing stock.
    for v_shortage in
      with parsed as (
        select
          (item->>'productId')::uuid as product_id,
          (item->>'quantity')::numeric as quantity
        from jsonb_array_elements(p_items) item
      ),
      requested as (
        select product_id, sum(quantity) as sale_qty
        from parsed
        group by product_id
      ),
      material_need as (
        select
          bi.material_id,
          sum(
            bi.quantity
            * (1 + coalesce(bi.waste_percent, 0) / 100)
            * r.sale_qty
          ) as required
        from requested r
        join public.products p
          on p.id = r.product_id
         and p.tenant_id = p_tenant_id
        cross join lateral (
          select public.get_active_bom_for_branch(
            r.product_id,
            p_branch_id,
            null
          ) as bom_id
        ) active_bom
        join public.bom_items bi on bi.bom_id = active_bom.bom_id
        where coalesce(p.has_bom, false)
          and public.should_cascade_bom_at_branch(p.id, p_branch_id)
          and bi.material_id <> r.product_id
        group by bi.material_id
      )
      select
        need.material_id as product_id,
        p.name as product_name,
        need.required,
        coalesce((
          select sum(bs.quantity)
          from public.branch_stock bs
          where bs.tenant_id = p_tenant_id
            and bs.branch_id = p_branch_id
            and bs.product_id = need.material_id
            and bs.variant_id is null
        ), 0) as available
      from material_need need
      left join public.products p on p.id = need.material_id
      where coalesce((
        select sum(bs.quantity)
        from public.branch_stock bs
        where bs.tenant_id = p_tenant_id
          and bs.branch_id = p_branch_id
          and bs.product_id = need.material_id
          and bs.variant_id is null
      ), 0) < need.required
    loop
      raise exception using errcode = 'P0001',
        message = format(
          'NVL_INSUFFICIENT|%s|%s|%s|%s',
          v_shortage.product_id,
          coalesce(v_shortage.product_name, 'NVL'),
          v_shortage.required,
          v_shortage.available
        );
    end loop;
  end if;
end;
$$;

revoke all on function public.assert_pos_stock_available(
  uuid, uuid, jsonb, boolean
) from public, anon, authenticated;

create or replace function public.pos_complete_checkout_atomic_v2(
  p_branch_id uuid,
  p_customer_id uuid default null,
  p_customer_name text default 'Khách lẻ',
  p_items jsonb default '[]'::jsonb,
  p_payment_method text default 'cash',
  p_payment_breakdown jsonb default null,
  p_subtotal numeric default 0,
  p_discount_amount numeric default 0,
  p_total numeric default 0,
  p_paid numeric default 0,
  p_note text default null,
  p_source text default 'pos',
  p_shift_id uuid default null,
  p_promotion_id uuid default null,
  p_promotion_discount numeric default 0,
  p_promotion_free_value numeric default 0,
  p_client_session_id text default null,
  p_allow_bom_shortage boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_existing record;
  v_breakdown_total numeric;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'POS_AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.checkout') then
    raise exception using errcode = '42501', message = 'POS_CHECKOUT_DENIED';
  end if;
  if not exists (
    select 1
    from public.branches b
    where b.id = p_branch_id
      and b.tenant_id = v_tenant_id
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'mixed')
     or coalesce(p_paid, 0) < 0 then
    raise exception using errcode = '22023', message = 'POS_PAYMENT_INVALID';
  end if;
  if p_payment_method = 'mixed' and coalesce(p_paid, 0) > 0 then
    if p_payment_breakdown is null
       or jsonb_typeof(p_payment_breakdown) <> 'array'
       or jsonb_array_length(p_payment_breakdown) = 0 then
      raise exception using errcode = '22023',
        message = 'POS_PAYMENT_BREAKDOWN_INVALID';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_payment_breakdown) part
      where coalesce(part->>'method', '') not in ('cash', 'transfer', 'card')
         or coalesce((part->>'amount')::numeric, 0) <= 0
    ) then
      raise exception using errcode = '22023',
        message = 'POS_PAYMENT_BREAKDOWN_INVALID';
    end if;
    select coalesce(sum((part->>'amount')::numeric), 0)
      into v_breakdown_total
    from jsonb_array_elements(p_payment_breakdown) part;
    if abs(v_breakdown_total - p_paid) > 0.01 then
      raise exception using errcode = '22023',
        message = 'POS_PAYMENT_BREAKDOWN_MISMATCH';
    end if;
  end if;

  if nullif(p_client_session_id, '') is not null then
    select i.id, i.code, i.status
      into v_existing
    from public.invoices i
    where i.tenant_id = v_tenant_id
      and i.client_session_id = nullif(p_client_session_id, '')
    order by i.created_at desc
    limit 1;

    if found and v_existing.status = 'completed' then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'invoice_code', v_existing.code,
        'idempotent', true
      );
    end if;
  end if;

  perform public.assert_pos_stock_available(
    v_tenant_id,
    p_branch_id,
    p_items,
    p_allow_bom_shortage
  );

  return public.pos_complete_checkout_atomic(
    v_tenant_id,
    p_branch_id,
    v_actor,
    p_customer_id,
    p_customer_name,
    p_items,
    p_payment_method,
    p_payment_breakdown,
    p_subtotal,
    p_discount_amount,
    p_total,
    p_paid,
    p_note,
    p_source,
    p_shift_id,
    p_promotion_id,
    p_promotion_discount,
    p_promotion_free_value,
    p_client_session_id
  );
end;
$$;

revoke all on function public.pos_complete_checkout_atomic_v2(
  uuid, uuid, text, jsonb, text, jsonb, numeric, numeric, numeric, numeric,
  text, text, uuid, uuid, numeric, numeric, text, boolean
) from public, anon;
grant execute on function public.pos_complete_checkout_atomic_v2(
  uuid, uuid, text, jsonb, text, jsonb, numeric, numeric, numeric, numeric,
  text, text, uuid, uuid, numeric, numeric, text, boolean
) to authenticated;

create or replace function public.complete_draft_atomic_v3(
  p_invoice_id uuid,
  p_method text,
  p_paid numeric,
  p_payment_breakdown jsonb default null,
  p_shift_id uuid default null,
  p_allow_bom_shortage boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice record;
  v_item record;
  v_total numeric;
  v_debt numeric;
  v_has_bom boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
  v_breakdown_item jsonb;
  v_method text;
  v_amount numeric;
  v_cash_code text;
  v_method_label text;
  v_hd_code text;  -- 00169: mã HD cuối (cấp mới nếu đơn còn mang mã DH/NH).
  v_actor uuid;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_should_cascade boolean;
  v_stock_items jsonb;
  v_guard_status text;
  v_breakdown_total numeric;
begin
  v_actor := auth.uid();
  v_tenant_id := public.get_user_tenant_id();

  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'POS_AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.checkout') then
    raise exception using errcode = '42501', message = 'POS_CHECKOUT_DENIED';
  end if;

  select i.branch_id
    into v_branch_id
  from public.invoices i
  where i.id = p_invoice_id
    and i.tenant_id = v_tenant_id
    and i.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'POS_DRAFT_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if p_method not in ('cash', 'transfer', 'card', 'mixed')
     or coalesce(p_paid, 0) < 0 then
    raise exception using errcode = '22023', message = 'POS_PAYMENT_INVALID';
  end if;
  if p_method = 'mixed' and coalesce(p_paid, 0) > 0 then
    if p_payment_breakdown is null
       or jsonb_typeof(p_payment_breakdown) <> 'array'
       or jsonb_array_length(p_payment_breakdown) = 0 then
      raise exception using errcode = '22023',
        message = 'POS_PAYMENT_BREAKDOWN_INVALID';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_payment_breakdown) part
      where coalesce(part->>'method', '') not in ('cash', 'transfer', 'card')
         or coalesce((part->>'amount')::numeric, 0) <= 0
    ) then
      raise exception using errcode = '22023',
        message = 'POS_PAYMENT_BREAKDOWN_INVALID';
    end if;
    select coalesce(sum((part->>'amount')::numeric), 0)
      into v_breakdown_total
    from jsonb_array_elements(p_payment_breakdown) part;
    if abs(v_breakdown_total - p_paid) > 0.01 then
      raise exception using errcode = '22023',
        message = 'POS_PAYMENT_BREAKDOWN_MISMATCH';
    end if;
  end if;
  if p_shift_id is not null and not exists (
    select 1
    from public.shifts s
    where s.id = p_shift_id
      and s.tenant_id = v_tenant_id
      and s.branch_id = v_branch_id
      and s.status = 'open'
  ) then
    raise exception using errcode = 'P0001', message = 'POS_SHIFT_NOT_OPEN';
  end if;

  -- Serialize all checkout paths for this branch, including the status check.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_branch_id::text, 203)
  );

  select i.status
    into v_guard_status
  from public.invoices i
  where i.id = p_invoice_id
    and i.tenant_id = v_tenant_id
    and i.deleted_at is null;

  if not found or v_guard_status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'POS_DRAFT_ALREADY_PROCESSED';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'productId', ii.product_id,
        'quantity', ii.quantity
      )
    ),
    '[]'::jsonb
  )
    into v_stock_items
  from public.invoice_items ii
  where ii.invoice_id = p_invoice_id;

  perform public.assert_pos_stock_available(
    v_tenant_id,
    v_branch_id,
    v_stock_items,
    p_allow_bom_shortage
  );
  -- Bước 1+2: ATOMIC claim status='draft' → 'completed' với shift_id + payment_method.
  update public.invoices
  set
    status = 'completed',
    paid = coalesce(p_paid, 0),
    payment_method = p_method,
    shift_id = case when p_shift_id is not null then p_shift_id else shift_id end
  where id = p_invoice_id
    and tenant_id = v_tenant_id
    and status = 'draft'
  returning id, code, total, customer_name, branch_id
  into v_invoice;

  if not found then
    select status into v_method
    from public.invoices
    where id = p_invoice_id and tenant_id = v_tenant_id;
    if not found then
      raise exception 'Không tìm thấy đơn nháp (id=%)', p_invoice_id;
    else
      raise exception 'Đơn này đã được xử lý (trạng thái: %). Không thể hoàn tất lại.', v_method;
    end if;
  end if;

  -- 00169: cấp mã HD lúc HOÀN TẤT. Đơn mang mã DH (đặt hàng) / NH (nháp POS)
  -- → cấp HD mới + lưu mã cũ vào order_code (truy vết). Đơn đã mang mã HD (nháp
  -- CŨ tạo trước thay đổi này) → GIỮ NGUYÊN, không cấp mới (không đụng lịch sử).
  v_hd_code := v_invoice.code;
  if v_invoice.code is null or v_invoice.code not like 'HD%' then
    v_hd_code := public.next_code(v_tenant_id, 'invoice');
    if v_hd_code is null or v_hd_code = '' then
      v_hd_code := 'HD' || extract(epoch from now())::bigint::text;
    end if;
    update public.invoices
    set order_code = v_invoice.code, code = v_hd_code
    where id = p_invoice_id and tenant_id = v_tenant_id;
  end if;

  v_total := coalesce(v_invoice.total, 0);
  v_debt := greatest(0, v_total - coalesce(p_paid, 0));

  update public.invoices
  set debt = v_debt
  where id = p_invoice_id and tenant_id = v_tenant_id;

  -- Bước 3+4: Loop invoice_items, trừ stock + BOM consume.
  for v_item in
    select product_id, product_name, unit, quantity
    from public.invoice_items
    where invoice_id = p_invoice_id
  loop
    if v_item.product_id is null or v_item.quantity <= 0 then
      continue;
    end if;

    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = v_item.product_id;

    v_should_cascade :=
      v_has_bom and public.should_cascade_bom_at_branch(
        v_item.product_id,
        v_branch_id
      );

    if v_should_cascade then
      v_bom_result := public.consume_bom_for_sale(
        v_tenant_id, v_branch_id, v_item.product_id, v_item.quantity,
        p_invoice_id, v_actor, v_hd_code
      );
      v_bom_results := v_bom_results || jsonb_build_object(
        'product_id', v_item.product_id,
        'product_name', v_item.product_name,
        'sale_qty', v_item.quantity,
        'result', v_bom_result
      );
    else
      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity,
        reference_type, reference_id, note, created_by
      ) values (
        v_tenant_id, v_branch_id, v_item.product_id, 'out', v_item.quantity,
        'invoice', p_invoice_id,
        'POS hoàn tất nháp - ' || v_hd_code, v_actor
      );

      perform public.increment_product_stock(v_item.product_id, -v_item.quantity);
      perform public.upsert_branch_stock(
        v_tenant_id, v_branch_id, v_item.product_id, -v_item.quantity
      );

      begin
        perform public.allocate_lots_fifo(
          v_tenant_id, v_item.product_id, v_branch_id, v_item.quantity,
          'invoice', p_invoice_id
        );
      exception when others then null;
      end;
    end if;
  end loop;

  -- Bước 5: Cash transactions (chỉ khi paid > 0).
  if coalesce(p_paid, 0) > 0 then
    if p_method = 'mixed' and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0 then
      for v_breakdown_item in select * from jsonb_array_elements(p_payment_breakdown) loop
        v_amount := coalesce((v_breakdown_item->>'amount')::numeric, 0);
        v_method := v_breakdown_item->>'method';
        if v_amount > 0 and v_method in ('cash', 'transfer', 'card') then
          v_cash_code := public.next_code(v_tenant_id, 'cash_receipt');
          if v_cash_code is null or v_cash_code = '' then
            v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
          end if;
          v_method_label := case v_method
            when 'cash' then 'tiền mặt'
            when 'transfer' then 'chuyển khoản'
            when 'card' then 'thẻ' else v_method end;
          insert into public.cash_transactions (
            tenant_id, branch_id, code, type, category, amount,
            counterparty, payment_method, reference_type, reference_id,
            note, created_by, shift_id
          ) values (
            v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng', v_amount,
            coalesce(v_invoice.customer_name, 'Khách lẻ'), v_method,
            'invoice', p_invoice_id,
            'Thu tiền HĐ ' || v_hd_code || ' (' || v_method_label || ')',
            v_actor, p_shift_id
          );
        end if;
      end loop;
    else
      v_cash_code := public.next_code(v_tenant_id, 'cash_receipt');
      if v_cash_code is null or v_cash_code = '' then
        v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
      end if;
      insert into public.cash_transactions (
        tenant_id, branch_id, code, type, category, amount,
        counterparty, payment_method, reference_type, reference_id,
        note, created_by, shift_id
      ) values (
        v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng', p_paid,
        coalesce(v_invoice.customer_name, 'Khách lẻ'),
        case when p_method = 'mixed' then 'cash' else p_method end,
        'invoice', p_invoice_id,
        'Thu tiền HĐ ' || v_hd_code,
        v_actor, p_shift_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_code', v_hd_code,
    'order_code', case when v_hd_code <> v_invoice.code then v_invoice.code else null end,
    'total', v_total,
    'paid', p_paid,
    'debt', v_debt,
    'bom_consume_results', v_bom_results
  );
end;
$$;

revoke all on function public.complete_draft_atomic_v3(
  uuid, text, numeric, jsonb, uuid, boolean
) from public, anon;
grant execute on function public.complete_draft_atomic_v3(
  uuid, text, numeric, jsonb, uuid, boolean
) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'branch_stock'
  ) then
    alter publication supabase_realtime add table public.branch_stock;
  end if;
end;
$$;

notify pgrst, 'reload schema';

-- Read-only verification after applying:
-- select
--   to_regprocedure('public.pos_complete_checkout_atomic_v2(uuid,uuid,text,jsonb,text,jsonb,numeric,numeric,numeric,numeric,text,text,uuid,uuid,numeric,numeric,text,boolean)') is not null as pos_v2_ok,
--   to_regprocedure('public.complete_draft_atomic_v3(uuid,text,numeric,jsonb,uuid,boolean)') is not null as draft_v3_ok,
--   exists (
--     select 1 from pg_publication_tables
--     where pubname='supabase_realtime'
--       and schemaname='public'
--       and tablename='branch_stock'
--   ) as realtime_ok;
