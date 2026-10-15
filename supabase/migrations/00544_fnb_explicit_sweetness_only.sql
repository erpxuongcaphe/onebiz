-- Owner decision: preparation notes never scale ingredients. Preserve explicit option recipes.
begin;
CREATE OR REPLACE FUNCTION public.consume_bom_for_sale(p_tenant_id uuid, p_branch_id uuid, p_sku_id uuid, p_qty numeric, p_invoice_id uuid, p_created_by uuid, p_invoice_code text DEFAULT NULL::text, p_modifier_selections jsonb DEFAULT NULL::jsonb, p_skip_bom_consume boolean DEFAULT false, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_bom_id uuid;
  v_bom record;
  v_item record;
  v_consumed jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_consume_qty numeric;
  v_available numeric;
  v_allow_negative boolean;
  v_note text;
  v_modifier_scale numeric;
  v_sel jsonb;
  v_opt jsonb;
  v_linked_id uuid;
  v_topping_qty numeric;
  v_topping_name text;
  v_exact_enabled boolean;
  v_exact_quantity numeric;
  v_exact_option_id uuid;
  v_exact_group_name text;
begin
  if p_tenant_id is null or p_branch_id is null or p_sku_id is null then
    raise exception 'consume_bom_for_sale: tenant_id, branch_id, sku_id are required';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'consume_bom_for_sale: qty must be > 0';
  end if;

  if not p_skip_bom_consume then
    v_bom_id := public.get_active_bom_for_branch(p_sku_id, p_branch_id, p_variant_id);
  else
    v_bom_id := null;
  end if;

  v_allow_negative := coalesce(
    public._allow_negative_sale_00473(p_tenant_id,p_branch_id),
    true
  );

  if v_bom_id is not null then
    -- Serialize recipe reads with a stock-unit cutover before computing qty.
    perform 1 from public.products p where p.id in
      (select material_id from public.bom_items where bom_id=v_bom_id)
      order by p.id for share;
    select b.id, b.name, b.code into v_bom from public.bom b where b.id = v_bom_id;
    v_note := format('Tiêu hao NVL theo BOM [%s] — HĐ %s',
      coalesce(v_bom.code, v_bom.name, 'BOM'), coalesce(p_invoice_code, p_invoice_id::text));

    for v_item in
      select bi.material_id, bi.unit, bi.quantity, coalesce(bi.waste_percent, 0) as waste_percent,
             bi.modifier_scale_target, p.code as material_code, p.name as material_name
        from public.bom_items bi
        left join public.products p on p.id = bi.material_id
       where bi.bom_id = v_bom_id
       order by bi.sort_order, bi.id
    loop
      if v_item.material_id = p_sku_id then continue; end if;

      -- Có dòng exact cho BOM + NVL này thì không được suy diễn từ % chung.
      select exists (
        select 1
          from public.bom_modifier_option_quantities q
          join public.modifier_options mo on mo.id = q.modifier_option_id
         where q.bom_id = v_bom_id
           and q.material_id = v_item.material_id
           and mo.group_id = v_item.modifier_scale_target
      ) into v_exact_enabled;

      v_modifier_scale := null;
      v_exact_quantity := null;
      v_exact_option_id := null;
      v_exact_group_name := null;
      if v_exact_enabled then
        if p_modifier_selections is not null and jsonb_typeof(p_modifier_selections) = 'array' then
          begin
            select nullif(o.value->>'optionId', '')::uuid, s.value->>'groupName'
              into v_exact_option_id, v_exact_group_name
              from jsonb_array_elements(p_modifier_selections) s
              cross join lateral jsonb_array_elements(coalesce(s.value->'options', '[]'::jsonb)) o(value)
             where s.value->>'groupId' = v_item.modifier_scale_target::text
             limit 1;
          exception when invalid_text_representation then
            raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_INVALID_OPTION';
          end;
        end if;
        if v_exact_option_id is null then
          raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_SELECTION_REQUIRED',
            detail = coalesce(v_exact_group_name, 'Nhóm lựa chọn') || ' chưa được chọn.';
        end if;
        select q.quantity into v_exact_quantity
          from public.bom_modifier_option_quantities q
         where q.bom_id = v_bom_id
           and q.material_id = v_item.material_id
           and q.modifier_option_id = v_exact_option_id;
        if not found then
          raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_OPTION_MISSING',
            detail = format('Chua khai dinh luong %s cho lua chon nay.', coalesce(v_item.material_name, v_item.material_code, 'NVL'));
        end if;
        v_consume_qty := round((v_exact_quantity * (1 + v_item.waste_percent / 100) * p_qty)::numeric, 4);
      else
        -- explicit_sweetness_00544: sweetness changes stock only through measured option quantities.
        if not exists(select 1 from public.modifier_groups g where g.id=v_item.modifier_scale_target
          and (lower(trim(g.name)) like 'mức đường%' or lower(trim(g.name)) like 'mức ngọt%'))
           and v_item.modifier_scale_target is not null
           and p_modifier_selections is not null
           and jsonb_typeof(p_modifier_selections) = 'array' then
          for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
            if (v_sel->>'groupId')::uuid = v_item.modifier_scale_target then
              for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
                -- authoritative_modifier_scale_00541: database option is authoritative, not the cart factor.
 select least(v_modifier_scale, mo.scale_factor) into v_modifier_scale
 from public.modifier_options mo join public.modifier_groups grp on grp.id=mo.group_id
 where mo.id::text=v_opt->>'optionId' and mo.group_id=v_item.modifier_scale_target
 and grp.tenant_id=p_tenant_id and grp.is_active and mo.is_active;
              end loop;
              exit;
            end if;
          end loop;
        end if;
        v_modifier_scale := coalesce(v_modifier_scale,1);
        v_consume_qty := round((v_item.quantity * (1 + v_item.waste_percent / 100) * p_qty * v_modifier_scale)::numeric, 4);
      end if;

      if v_consume_qty <= 0 then continue; end if;
      perform public.upsert_branch_stock(p_tenant_id,p_branch_id,v_item.material_id,0);
perform 1 from public.branch_stock where tenant_id=p_tenant_id and branch_id=p_branch_id and product_id=v_item.material_id and variant_id is null for update;
select coalesce(sum(quantity), 0) into v_available from public.branch_stock
       where product_id = v_item.material_id and branch_id = p_branch_id and variant_id is null;
      if v_available < v_consume_qty then
        if not v_allow_negative then
          raise exception 'NVL_INSUFFICIENT: NVL "%" tại chi nhánh thiếu — còn %, cần % (cho %s × %s)',
            coalesce(v_item.material_name, v_item.material_code, v_item.material_id::text), v_available,
            v_consume_qty, p_qty, coalesce(v_bom.name, 'BOM');
        else
          v_warnings := v_warnings || jsonb_build_object(
            'material_id', v_item.material_id, 'material_code', v_item.material_code,
            'material_name', v_item.material_name, 'available', v_available, 'required', v_consume_qty,
            'modifier_mode', case when v_exact_enabled then 'exact' else 'legacy_scale' end,
            'modifier_scale', case when v_exact_enabled then null else v_modifier_scale end,
            'exact_unit_quantity', v_exact_quantity,
            'reason', format('NVL "%s" còn %s nhưng cần %s — tồn kho sẽ âm',
              coalesce(v_item.material_name, v_item.material_code), v_available, v_consume_qty)
          );
        end if;
      end if;

      perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_item.material_id, -v_consume_qty);
      perform public.increment_product_stock(v_item.material_id, -v_consume_qty);
      begin
        perform public.allocate_lots_fifo(p_tenant_id, v_item.material_id, p_branch_id, v_consume_qty, 'invoice', p_invoice_id);
      exception when others then null;
      end;
      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity, reference_type, reference_id, note, created_by
      ) values (
        p_tenant_id, p_branch_id, v_item.material_id, 'out', v_consume_qty, 'bom_consume', p_invoice_id,
        v_note || case when v_exact_enabled
          then format(' [%s × %s × exact %s]', p_qty, coalesce(v_item.material_name, 'NVL'), v_exact_quantity)
          else format(' [%s × %s × scale %s]', p_qty, coalesce(v_item.material_name, 'NVL'), v_modifier_scale)
        end,
        p_created_by
      );
      v_consumed := v_consumed || jsonb_build_object(
        'material_id', v_item.material_id, 'material_code', v_item.material_code,
        'material_name', v_item.material_name, 'qty', v_consume_qty, 'unit', v_item.unit,
        'modifier_mode', case when v_exact_enabled then 'exact' else 'legacy_scale' end,
        'modifier_scale', case when v_exact_enabled then null else v_modifier_scale end,
        'exact_unit_quantity', v_exact_quantity, 'modifier_option_id', v_exact_option_id
      );
    end loop;
  end if;

  -- Giữ nguyên đường legacy cho option linked_product_id. Topping mới phải đi
  -- theo SKU-TPP có BOM riêng; migration này không làm thay đổi topping cũ.
  if p_modifier_selections is not null and jsonb_typeof(p_modifier_selections) = 'array' then
    for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
      for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
        if v_opt->>'linkedProductId' is not null and v_opt->>'linkedProductId' <> '' and v_opt->>'linkedProductId' <> 'null' then
          v_linked_id := (v_opt->>'linkedProductId')::uuid;
          v_topping_name := coalesce(v_opt->>'label', 'Topping');
          v_topping_qty := p_qty;
          perform public.upsert_branch_stock(p_tenant_id,p_branch_id,v_linked_id,0);
perform 1 from public.branch_stock where tenant_id=p_tenant_id and branch_id=p_branch_id and product_id=v_linked_id and variant_id is null for update;
select coalesce(sum(quantity), 0) into v_available from public.branch_stock
           where product_id = v_linked_id and branch_id = p_branch_id and variant_id is null;
          if v_available < v_topping_qty then
            if not v_allow_negative then
              raise exception 'NVL_INSUFFICIENT: Topping "%" tại chi nhánh thiếu — còn %, cần %', v_topping_name, v_available, v_topping_qty;
            else
              v_warnings := v_warnings || jsonb_build_object('material_id', v_linked_id, 'material_name', v_topping_name,
                'available', v_available, 'required', v_topping_qty,
                'reason', format('Topping NVL "%s" còn %s nhưng cần %s', v_topping_name, v_available, v_topping_qty));
            end if;
          end if;
          perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_linked_id, -v_topping_qty);
          perform public.increment_product_stock(v_linked_id, -v_topping_qty);
          begin
            perform public.allocate_lots_fifo(p_tenant_id, v_linked_id, p_branch_id, v_topping_qty, 'invoice', p_invoice_id);
          exception when others then null;
          end;
          insert into public.stock_movements (
            tenant_id, branch_id, product_id, type, quantity, reference_type, reference_id, note, created_by
          ) values (
            p_tenant_id, p_branch_id, v_linked_id, 'out', v_topping_qty, 'modifier_topping', p_invoice_id,
            format('Topping %s × %s — HĐ %s', v_topping_name, v_topping_qty, coalesce(p_invoice_code, p_invoice_id::text)),
            p_created_by
          );
          v_consumed := v_consumed || jsonb_build_object('material_id', v_linked_id, 'material_name', v_topping_name,
            'qty', v_topping_qty, 'kind', 'modifier_topping');
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'bom_id', v_bom_id, 'bom_name', coalesce(v_bom.name, null),
    'consumed', v_consumed, 'warnings', v_warnings, 'allow_negative', v_allow_negative, 'skipped_bom', p_skip_bom_consume);
end;
$function$;

-- Undo only links introduced by 00542 that have not since gained an explicit recipe.
update public.bom_items i set modifier_scale_target=null
from public.audit_log a, lateral jsonb_array_elements(a.old_data->'items') old_item
where a.action='fnb_recipe_sugar_link_repair' and a.tenant_id=(select b.tenant_id from public.bom b where b.id=i.bom_id)
and i.bom_id=a.entity_id and i.id::text=old_item->>'id'
and old_item->>'modifier_scale_target' is null
and i.modifier_scale_target::text=a.new_data->>'modifier_group_id'
and not exists(select 1 from public.bom_modifier_option_quantities q join public.modifier_options o on o.id=q.modifier_option_id
 where q.bom_id=i.bom_id and q.material_id=i.material_id and o.group_id=i.modifier_scale_target);

-- POS reads IDs only; never exposes quantities, costs, or other branches.
create or replace function public.get_fnb_exact_sweetness_groups_00544(p_product_id uuid,p_branch_id uuid)
returns uuid[] language plpgsql stable security definer set search_path='' as $rpc$
declare tenant uuid; result uuid[];
begin
 select p.tenant_id into tenant from public.profiles p where p.id=auth.uid() and p.is_active;
 if tenant is null or not public._can_read_branch_inventory_00476(auth.uid(),tenant,p_branch_id) then
 raise exception using errcode='42501',message='BRANCH_ACCESS_DENIED';end if;
 select coalesce(array_agg(distinct g.id),'{}'::uuid[]) into result
 from public.bom b join public.bom_items i on i.bom_id=b.id
 join public.modifier_groups g on g.id=i.modifier_scale_target and g.tenant_id=tenant and g.is_active
 join public.bom_modifier_option_quantities q on q.bom_id=b.id and q.material_id=i.material_id
 join public.modifier_options o on o.id=q.modifier_option_id and o.group_id=g.id
 where b.tenant_id=tenant and b.product_id=p_product_id and b.is_active
 and b.id=public.get_active_bom_for_branch(p_product_id,p_branch_id,b.variant_id);
 return result;
end $rpc$;
revoke all on function public.get_fnb_exact_sweetness_groups_00544(uuid,uuid) from public,anon;
grant execute on function public.get_fnb_exact_sweetness_groups_00544(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
