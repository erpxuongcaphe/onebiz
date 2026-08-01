-- ============================================================
-- 00268: Atomic creation and stock application for internal/disposal exports
-- ============================================================
-- Function definitions only. Existing documents and stock are untouched.

create or replace function public._create_and_apply_stock_export_00268(
  p_kind text,
  p_branch_id uuid,
  p_purpose text,
  p_note text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_document_id uuid;
  v_code text;
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_quantity numeric;
  v_available numeric;
  v_total numeric := 0;
  v_apply_result jsonb;
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
  if p_kind = 'internal' then
    if not public.user_has_permission(v_actor, 'inventory.internal_export') then
      raise exception using errcode = '42501', message = 'INTERNAL_EXPORT_DENIED';
    end if;
  elsif p_kind = 'disposal' then
    if not public.user_has_permission(v_actor, 'inventory.dispose') then
      raise exception using errcode = '42501', message = 'DISPOSAL_EXPORT_DENIED';
    end if;
  else
    raise exception using errcode = '22023', message = 'EXPORT_KIND_INVALID';
  end if;
  if not exists (
    select 1 from public.branches b
     where b.id = p_branch_id
       and b.tenant_id = v_tenant_id
       and coalesce(b.is_active, true)
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'EXPORT_BRANCH_DENIED';
  end if;
  if nullif(trim(coalesce(p_purpose, '')), '') is null then
    raise exception using errcode = '22023', message = 'EXPORT_PURPOSE_REQUIRED';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 1000 then
    raise exception using errcode = '22023', message = 'EXPORT_ITEMS_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
     group by e->>'product_id' having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'DUPLICATE_PRODUCT';
  end if;

  -- Stable lock order prevents two terminals from consuming the same remaining stock.
  for v_item in
    select value from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    begin
      v_product_id := nullif(v_item->>'product_id', '')::uuid;
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'EXPORT_ITEM_INVALID';
    end;
    if v_product_id is null or v_quantity is null or v_quantity <= 0
       or v_quantity = 'NaN'::numeric then
      raise exception using errcode = '22023', message = 'EXPORT_ITEM_INVALID';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_tenant_id::text || ':' || p_branch_id::text || ':' || v_product_id::text,
        0
      )
    );
    select p.id, p.name, p.unit, coalesce(p.cost_price, 0) as cost_price,
           p.inventory_role
      into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'EXPORT_PRODUCT_INVALID';
    end if;
    if v_product.inventory_role = 'fnb_menu_item' then
      raise exception using errcode = '22023', message = 'MENU_NO_DIRECT_STOCK';
    end if;

    select coalesce(bs.quantity, 0) into v_available
      from public.branch_stock bs
     where bs.tenant_id = v_tenant_id
       and bs.branch_id = p_branch_id
       and bs.product_id = v_product_id
       and bs.variant_id is null
     for update;
    if not found then v_available := 0; end if;
    if v_available < v_quantity then
      raise exception using errcode = '22023', message = 'INSUFFICIENT_BRANCH_STOCK',
        detail = jsonb_build_object(
          'product_id', v_product_id,
          'product_name', v_product.name,
          'available', v_available,
          'requested', v_quantity
        )::text;
    end if;
    v_total := v_total + round(v_quantity * v_product.cost_price, 2);
  end loop;

  if p_kind = 'internal' then
    v_code := public.next_code(v_tenant_id, 'internal_export');
    insert into public.internal_exports (
      tenant_id, branch_id, code, status, total_amount, department, note, created_by
    ) values (
      v_tenant_id, p_branch_id, v_code, 'draft', v_total,
      trim(p_purpose), nullif(trim(coalesce(p_note, '')), ''), v_actor
    ) returning id into v_document_id;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
      select p.name, p.unit, coalesce(p.cost_price, 0) as cost_price into v_product
        from public.products p
       where p.id = v_product_id and p.tenant_id = v_tenant_id;
      insert into public.internal_export_items (
        export_id, product_id, product_name, unit, quantity, unit_price, total
      ) values (
        v_document_id, v_product_id, v_product.name, coalesce(v_product.unit, ''),
        v_quantity, v_product.cost_price, round(v_quantity * v_product.cost_price, 2)
      );
    end loop;
    v_apply_result := public.apply_internal_export_atomic(v_document_id, null);
  else
    v_code := public.next_code(v_tenant_id, 'disposal');
    insert into public.disposal_exports (
      tenant_id, branch_id, code, status, total_amount, reason, note, created_by
    ) values (
      v_tenant_id, p_branch_id, v_code, 'draft', v_total,
      trim(p_purpose), nullif(trim(coalesce(p_note, '')), ''), v_actor
    ) returning id into v_document_id;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
      select p.name, p.unit, coalesce(p.cost_price, 0) as cost_price into v_product
        from public.products p
       where p.id = v_product_id and p.tenant_id = v_tenant_id;
      insert into public.disposal_export_items (
        disposal_id, product_id, product_name, unit, quantity, unit_price, total, unit_cost
      ) values (
        v_document_id, v_product_id, v_product.name, coalesce(v_product.unit, ''),
        v_quantity, v_product.cost_price, round(v_quantity * v_product.cost_price, 2),
        v_product.cost_price
      );
    end loop;
    v_apply_result := public.apply_disposal_export_atomic(v_document_id, null);
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id, v_actor, 'stock_export_created',
    case when p_kind = 'internal' then 'internal_export' else 'disposal_export' end,
    v_document_id,
    jsonb_build_object(
      'code', v_code, 'branch_id', p_branch_id, 'kind', p_kind,
      'item_count', jsonb_array_length(p_items), 'total_amount', v_total,
      'apply_result', v_apply_result, 'atomic', true
    )
  );

  return jsonb_build_object(
    'id', v_document_id, 'code', v_code, 'kind', p_kind,
    'total_amount', v_total, 'apply_result', v_apply_result
  );
end;
$$;

create or replace function public.create_internal_export_atomic(
  p_branch_id uuid,
  p_department text,
  p_note text,
  p_items jsonb
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._create_and_apply_stock_export_00268(
    'internal', p_branch_id, p_department, p_note, p_items
  );
$$;

create or replace function public.create_disposal_export_atomic(
  p_branch_id uuid,
  p_reason text,
  p_note text,
  p_items jsonb
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._create_and_apply_stock_export_00268(
    'disposal', p_branch_id, p_reason, p_note, p_items
  );
$$;

revoke all on function public._create_and_apply_stock_export_00268(
  text, uuid, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.create_internal_export_atomic(
  uuid, text, text, jsonb
) from public, anon;
revoke all on function public.create_disposal_export_atomic(
  uuid, text, text, jsonb
) from public, anon;
grant execute on function public.create_internal_export_atomic(
  uuid, text, text, jsonb
) to authenticated;
grant execute on function public.create_disposal_export_atomic(
  uuid, text, text, jsonb
) to authenticated;

comment on function public.create_internal_export_atomic(uuid, text, text, jsonb) is
  'Creates and applies one internal stock export atomically using server product cost.';
comment on function public.create_disposal_export_atomic(uuid, text, text, jsonb) is
  'Creates and applies one disposal stock export atomically using server product cost.';

select
  to_regprocedure('public.create_internal_export_atomic(uuid,text,text,jsonb)') is not null as internal_export_create_ok,
  to_regprocedure('public.create_disposal_export_atomic(uuid,text,text,jsonb)') is not null as disposal_export_create_ok;
