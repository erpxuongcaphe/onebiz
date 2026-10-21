-- Fill only an unambiguous, free configured recipe default for missing legacy groups.
-- Installation does not update orders. Resolution runs inside send/checkout transactions.
begin;

create or replace function public._fnb_resolve_recipe_defaults_20261021(
  p_tenant_id uuid, p_branch_id uuid, p_product_id uuid, p_variant_id uuid, p_selections jsonb
) returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_result jsonb := coalesce(p_selections,'[]'::jsonb);
  v_bom_id uuid;
  v_product_name text;
  v_group record;
  v_option record;
  v_default_count integer;
  v_selected_id uuid;
begin
  if jsonb_typeof(v_result) <> 'array' then
    raise exception using errcode='22023', message='FNB_EXACT_RECIPE_INVALID_OPTION';
  end if;
  select p.name into v_product_name from public.products p
   where p.id=p_product_id and p.tenant_id=p_tenant_id;
  if not found or not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=p_tenant_id) then
    raise exception using errcode='42501',message='FNB_RECIPE_CONTEXT_DENIED';
  end if;
  v_bom_id := public.get_active_bom_for_branch(p_product_id,p_branch_id,p_variant_id);
  if v_bom_id is null then return v_result; end if;
  if not exists(select 1 from public.bom b where b.id=v_bom_id and b.tenant_id=p_tenant_id) then
    raise exception using errcode='42501',message='FNB_RECIPE_CONTEXT_DENIED';
  end if;

  for v_group in
    select distinct g.id,g.name,g.rule,g.is_active
      from public.bom_items bi
      join public.bom_modifier_option_quantities q on q.bom_id=bi.bom_id and q.material_id=bi.material_id
      join public.modifier_options mo on mo.id=q.modifier_option_id and mo.group_id=bi.modifier_scale_target
      join public.modifier_groups g on g.id=mo.group_id and g.tenant_id=p_tenant_id
     where bi.bom_id=v_bom_id order by g.id
  loop
    -- Never overwrite a saved choice or an explicitly empty selection.
    if exists(select 1 from jsonb_array_elements(v_result) s where s->>'groupId'=v_group.id::text) then
      if (select count(*) from jsonb_array_elements(v_result) s
        cross join lateral jsonb_array_elements(coalesce(s->'options','[]'::jsonb)) o
        where s->>'groupId'=v_group.id::text)<>1 then
        raise exception using errcode='P0001',message='FNB_EXACT_RECIPE_SELECTION_REQUIRED',
          detail=format('Món "%s" — nhóm "%s": cần lưu đúng một lựa chọn.',v_product_name,v_group.name);
      end if;
      begin
        select nullif(o->>'optionId','')::uuid into v_selected_id
          from jsonb_array_elements(v_result) s
          cross join lateral jsonb_array_elements(coalesce(s->'options','[]'::jsonb)) o
         where s->>'groupId'=v_group.id::text limit 1;
      exception when invalid_text_representation then
        raise exception using errcode='P0001',message='FNB_EXACT_RECIPE_INVALID_OPTION',
          detail=format('Món "%s" — nhóm "%s": lựa chọn đã lưu không hợp lệ.',v_product_name,v_group.name);
      end;
      if not exists(select 1 from public.modifier_options mo where mo.id=v_selected_id and mo.group_id=v_group.id) then
        raise exception using errcode='P0001',message='FNB_EXACT_RECIPE_INVALID_OPTION',
          detail=format('Món "%s" — nhóm "%s": lựa chọn đã lưu không thuộc nhóm.',v_product_name,v_group.name);
      end if;
      if exists(select 1 from public.bom_items bi where bi.bom_id=v_bom_id and bi.modifier_scale_target=v_group.id
        and exists(select 1 from public.bom_modifier_option_quantities q join public.modifier_options mo on mo.id=q.modifier_option_id
          where q.bom_id=bi.bom_id and q.material_id=bi.material_id and mo.group_id=v_group.id)
        and not exists(select 1 from public.bom_modifier_option_quantities q
          where q.bom_id=bi.bom_id and q.material_id=bi.material_id and q.modifier_option_id=v_selected_id)) then
        raise exception using errcode='P0001',message='FNB_EXACT_RECIPE_OPTION_MISSING',
          detail=format('Món "%s" — nhóm "%s": lựa chọn đã lưu chưa có đủ định lượng nguyên liệu.',v_product_name,v_group.name);
      end if;
      continue;
    end if;
    perform 1 from public.modifier_options mo where mo.group_id=v_group.id order by mo.id for share;
    select count(*) into v_default_count from public.modifier_options mo
     where mo.group_id=v_group.id and mo.is_active and mo.is_default;
    if not v_group.is_active or v_group.rule not in ('single','single_required') or v_default_count<>1 then
      raise exception using errcode='P0001',message='FNB_EXACT_RECIPE_DEFAULT_UNAVAILABLE',
        detail=format('Món "%s" — nhóm "%s": chưa có một mặc định duy nhất, còn hoạt động.',v_product_name,v_group.name);
    end if;
    select mo.* into strict v_option from public.modifier_options mo
     where mo.group_id=v_group.id and mo.is_active and mo.is_default;
    if coalesce(v_option.price_delta,0)<>0 or v_option.linked_product_id is not null then
      raise exception using errcode='P0001',message='FNB_EXACT_RECIPE_DEFAULT_UNAVAILABLE',
        detail=format('Món "%s" — nhóm "%s": cần chọn rõ lựa chọn có phụ thu hoặc mã hàng đi kèm.',v_product_name,v_group.name);
    end if;
    perform 1 from public.bom_modifier_option_quantities q
     where q.bom_id=v_bom_id and q.modifier_option_id=v_option.id order by q.id for share;
    if exists(
      select 1 from public.bom_items bi where bi.bom_id=v_bom_id and bi.modifier_scale_target=v_group.id
       and exists(select 1 from public.bom_modifier_option_quantities q
         join public.modifier_options mo on mo.id=q.modifier_option_id
         where q.bom_id=bi.bom_id and q.material_id=bi.material_id and mo.group_id=v_group.id)
       and not exists(select 1 from public.bom_modifier_option_quantities q
         where q.bom_id=bi.bom_id and q.material_id=bi.material_id and q.modifier_option_id=v_option.id)
    ) then
      raise exception using errcode='P0001',message='FNB_EXACT_RECIPE_OPTION_MISSING',
        detail=format('Món "%s" — nhóm "%s": mặc định chưa có đủ định lượng nguyên liệu.',v_product_name,v_group.name);
    end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'groupId',v_group.id,'groupName',v_group.name,'rule',v_group.rule,
      'options',jsonb_build_array(jsonb_build_object('optionId',v_option.id,'label',v_option.label,
        'priceDelta',0,'scaleFactor',v_option.scale_factor,'linkedProductId',null))));
  end loop;
  return v_result;
end;
$fn$;

create or replace function public._fnb_resolve_order_recipe_defaults_20261021(p_order_id uuid)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
declare v_actor uuid:=auth.uid(); v_tenant uuid; v_order record; v_item record; v_resolved jsonb;
begin
  if v_actor is null or not public.user_has_permission(v_actor,'pos_fnb.checkout') then
    raise exception using errcode='42501',message='FNB_CHECKOUT_DENIED';
  end if;
  select tenant_id into v_tenant from public.profiles where id=v_actor and is_active;
  select * into v_order from public.kitchen_orders where id=p_order_id and tenant_id=v_tenant for update;
  if not found or not public.user_has_branch_access(v_actor,v_order.branch_id) then
    raise exception using errcode='42501',message='FNB_RECIPE_CONTEXT_DENIED';
  end if;
  -- Preserve payment replay and archived bills, without rewriting historical snapshots.
  if v_order.invoice_id is not null then return; end if;
  if v_order.status not in ('pending','preparing','ready','served') or v_order.merged_into_id is not null then
    raise exception using errcode='P0001',message='FNB_RECIPE_ORDER_NOT_OPEN';
  end if;
  for v_item in select * from public.kitchen_order_items
    where kitchen_order_id=p_order_id and quantity>coalesce(cancelled_qty,0) order by id for update
  loop
    v_resolved := public._fnb_resolve_recipe_defaults_20261021(
      v_tenant,v_order.branch_id,v_item.product_id,v_item.variant_id,v_item.modifier_selections);
    if v_resolved is distinct from coalesce(v_item.modifier_selections,'[]'::jsonb) then
      update public.kitchen_order_items set modifier_selections=v_resolved where id=v_item.id;
    end if;
  end loop;
end;
$fn$;

-- Patch the existing guarded send implementation; keep menu, price and permission wrappers.
do $patch_send$
declare v_def text; v_needle text := $needle$  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))$needle$;
v_insert text := $insert$  -- safe_recipe_defaults_20261021: persist resolved choices before exact validation and insertion.
  p_items := coalesce((select jsonb_agg(jsonb_set(entry.value,'{modifierSelections}',
    public._fnb_resolve_recipe_defaults_20261021(v_tenant,p_branch_id,
      coalesce(nullif(entry.value->>'productId','')::uuid,nullif(entry.value->>'product_id','')::uuid),
      coalesce(nullif(entry.value->>'variantId','')::uuid,nullif(entry.value->>'variant_id','')::uuid),
      coalesce(entry.value->'modifierSelections','[]'::jsonb))) order by entry.ordinality)
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality entry(value,ordinality)), '[]'::jsonb);
$insert$;
begin
  select pg_get_functiondef('public._fnb_send_to_kitchen_impl_00350(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'::regprocedure) into v_def;
  if position('safe_recipe_defaults_20261021' in v_def)=0 then
    if position('ACTIVE_PROFILE_REQUIRED' in v_def)=0 or position('FNB_EXACT_RECIPE_SELECTION_REQUIRED' in v_def)=0
      or (length(v_def)-length(replace(v_def,v_needle,'')))/length(v_needle)<>1 then
      raise exception 'FNB_RECIPE_SEND_PREREQUISITE_CHANGED';
    end if;
    execute replace(v_def,v_needle,v_insert || v_needle);
  end if;
end;
$patch_send$;

-- Run normalization only after checkout auth, branch/order locks, and open-shift guards.
do $patch_payment$
declare v_def text; v_needle text := $needle$  return public._fnb_complete_payment_impl_00343($needle$; v_pos integer;
begin
  select pg_get_functiondef('public._fnb_complete_payment_checkout_impl_00345(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'::regprocedure) into v_def;
  if position('safe_recipe_defaults_20261021' in v_def)=0 then
    if position('FNB_PAYMENT_SHIFT_NOT_OPEN_FOR_USER_BRANCH' in v_def)=0 or position('for update' in lower(v_def))=0
       or position(v_needle in v_def)=0 then raise exception 'FNB_RECIPE_PAYMENT_PREREQUISITE_CHANGED'; end if;
    v_pos := length(v_def)-strpos(reverse(v_def),reverse(v_needle))-length(v_needle)+2;
    if v_pos<=position('FNB_PAYMENT_SHIFT_NOT_OPEN_FOR_USER_BRANCH' in v_def) then
      raise exception 'FNB_RECIPE_PAYMENT_GUARD_ORDER_CHANGED';
    end if;
    v_def := overlay(v_def placing $insert$  -- safe_recipe_defaults_20261021: same transaction as invoice, stock, cash and table release.
  perform public._fnb_resolve_order_recipe_defaults_20261021(p_kitchen_order_id);
$insert$ from v_pos for 0);
    execute v_def;
  end if;
end;
$patch_payment$;

revoke all on function public._fnb_resolve_recipe_defaults_20261021(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public._fnb_resolve_order_recipe_defaults_20261021(uuid) from public,anon,authenticated,service_role;
commit;
notify pgrst,'reload schema';
