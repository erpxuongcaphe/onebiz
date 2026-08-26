-- ============================================================================
-- 00350 rollback — only run if 00350 has to be withdrawn before using exact
-- recipes in production. This restores the prior send-kitchen wrapper.
--
-- IMPORTANT: This rollback intentionally refuses to run while exact mapping
-- rows exist. Deleting a used exact recipe definition would make later bill
-- analysis ambiguous. Disable the affected menu/BOM and review first.
-- ============================================================================

begin;

do $rollback$
begin
  if exists (select 1 from public.bom_modifier_option_quantities) then
    raise exception using errcode = 'P0001', message = 'FNB_00350_ROLLBACK_EXACT_RECIPES_EXIST';
  end if;
  if exists (
    select 1 from public.stock_movements sm
     where sm.reference_type = 'bom_consume'
       and sm.note like '%exact %'
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_00350_ROLLBACK_EXACT_SALE_EXISTS';
  end if;
end;
$rollback$;

-- Revert public send-kitchen entry point to the proven 00330 wrapper.
drop function if exists public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
);
alter function public._fnb_send_to_kitchen_impl_00330(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) rename to fnb_send_to_kitchen_atomic_v2;
revoke all on function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) from public, anon;
grant execute on function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) to authenticated;

-- Restore the exact 00226/00147 consumption body. The public function keeps
-- its OID through CREATE OR REPLACE, so existing payment RPCs continue to call
-- the restored implementation rather than a stale cached routine.
create or replace function public.consume_bom_for_sale(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sku_id uuid,
  p_qty numeric,
  p_invoice_id uuid,
  p_created_by uuid,
  p_invoice_code text default null,
  p_modifier_selections jsonb default null,
  p_skip_bom_consume boolean default false,
  p_variant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
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
    (public.get_tenant_setting(p_tenant_id, 'allow_negative_stock', 'true'::jsonb))::boolean,
    true
  );
  if v_bom_id is not null then
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
      v_modifier_scale := 1;
      if v_item.modifier_scale_target is not null
         and p_modifier_selections is not null
         and jsonb_typeof(p_modifier_selections) = 'array' then
        for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
          if (v_sel->>'groupId')::uuid = v_item.modifier_scale_target then
            for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
              if v_opt->>'scaleFactor' is not null and v_opt->>'scaleFactor' <> 'null' then
                v_modifier_scale := least(v_modifier_scale, coalesce((v_opt->>'scaleFactor')::numeric, 1));
              end if;
            end loop;
            exit;
          end if;
        end loop;
      end if;
      v_consume_qty := round((v_item.quantity * (1 + v_item.waste_percent / 100) * p_qty * v_modifier_scale)::numeric, 4);
      if v_consume_qty <= 0 then continue; end if;
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
            'modifier_scale', v_modifier_scale,
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
        v_note || format(' [%s × %s × scale %s]', p_qty, coalesce(v_item.material_name, 'NVL'), v_modifier_scale), p_created_by
      );
      v_consumed := v_consumed || jsonb_build_object(
        'material_id', v_item.material_id, 'material_code', v_item.material_code,
        'material_name', v_item.material_name, 'qty', v_consume_qty, 'unit', v_item.unit,
        'modifier_scale', v_modifier_scale
      );
    end loop;
  end if;
  if p_modifier_selections is not null and jsonb_typeof(p_modifier_selections) = 'array' then
    for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
      for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
        if v_opt->>'linkedProductId' is not null and v_opt->>'linkedProductId' <> '' and v_opt->>'linkedProductId' <> 'null' then
          v_linked_id := (v_opt->>'linkedProductId')::uuid;
          v_topping_name := coalesce(v_opt->>'label', 'Topping');
          v_topping_qty := p_qty;
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

revoke all on function public.consume_bom_for_sale(
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, boolean, uuid
) from public, anon;
grant execute on function public.consume_bom_for_sale(
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, boolean, uuid
) to authenticated;

drop trigger if exists trg_enforce_bom_modifier_option_quantity_00350
  on public.bom_modifier_option_quantities;
drop function if exists public.enforce_bom_modifier_option_quantity_00350();
drop function if exists public.save_bom_modifier_option_quantities(uuid, jsonb);
drop table if exists public.bom_modifier_option_quantities;

commit;
notify pgrst, 'reload schema';
