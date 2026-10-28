-- Correct new kitchen lines only; preserve every wrapper, bill, BOM and stock movement.
begin;
do $patch$
declare target regprocedure:=to_regprocedure('public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)');
 definition text; old_block text; new_block text; backup text;
begin
 if target is null then raise exception 'FNB_BRANCH_PRICE_SAVE_PREREQUISITE_MISSING'; end if;
 definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
 if position('FNB_BRANCH_PRICE_AT_SAVE_20261028' in definition)>0 then return; end if;
 old_block:=$old$      v_base_price := v_variant_price;
    elsif p_order_type = 'delivery' and v_platform <> 'direct' then
      select ppp.override_price
        into v_base_price
        from public.product_platform_prices ppp
       where ppp.tenant_id = v_tenant_id
         and ppp.product_id = v_product.id
         and ppp.platform = v_platform;
      v_base_price := coalesce(v_base_price, v_product.sell_price);
    else
      v_base_price := v_product.sell_price;
    end if;$old$;
 new_block:=$new$    end if;
    -- FNB_BRANCH_PRICE_AT_SAVE_20261028: same branch schedule/variant/platform precedence as POS.
    v_base_price := (public.resolve_sale_price_00363(
      v_product.id, v_variant_id, p_branch_id, null, 'fnb',
      case when p_order_type = 'delivery' then v_platform else 'direct' end,
      v_quantity, now()
    )->>'unit_price')::numeric;$new$;
 if (length(definition)-length(replace(definition,old_block,'')))/length(old_block)<>1
    or position('v_expected_unit_price := v_base_price + v_modifier_extra' in definition)=0 then
   raise exception 'FNB_BRANCH_PRICE_SAVE_IMPLEMENTATION_CHANGED';
 end if;
 backup:=replace(definition,'FUNCTION public._fnb_send_to_kitchen_impl_00303(','FUNCTION public._fnb_send_to_kitchen_before_branch_price_20261028(');
 if backup=definition then raise exception 'FNB_BRANCH_PRICE_SAVE_BACKUP_FAILED'; end if;
 execute backup;
 execute replace(definition,old_block,new_block);
end $patch$;
revoke all on function public._fnb_send_to_kitchen_before_branch_price_20261028(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid) from public,anon,authenticated,service_role;

-- Unqueried optional RECORDs cannot be dereferenced in catalog/platform fallback paths.
-- Guard metadata fields only; all existing price/permission/zero-price rules remain intact.
do $metadata$
declare definition text; old_block text; new_block text; backup text;
begin
 definition:=replace(pg_get_functiondef('public.resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)'::regprocedure),E'\r\n',E'\n');
 if position('FNB_PRICE_OPTIONAL_METADATA_20261028' in definition)>0 then return; end if;
 old_block:=E'begin\n  if auth.uid() is null';
 new_block:=$new$begin
  -- FNB_PRICE_OPTIONAL_METADATA_20261028: define optional RECORD shapes before CASE/JSON field access.
  select null::uuid as id, null::numeric as sell_price into v_variant;
  select null::uuid as id, null::numeric as price, null::uuid as variant_id, null::numeric as min_qty into v_tier_item;
  select null::uuid as id, null::numeric as override_price, null::uuid as variant_id into v_platform_price;
  if auth.uid() is null$new$;
 if position(old_block in definition)=0 or position('v_variant record;' in definition)=0
    or position('v_tier_item record;' in definition)=0 or position('v_platform_price record;' in definition)=0 then
   raise exception 'FNB_BRANCH_PRICE_RESOLVER_METADATA_CHANGED';
 end if;
 backup:=replace(definition,'FUNCTION public.resolve_sale_price_00363(','FUNCTION public._resolve_sale_price_before_kitchen_20261028(');
 if backup=definition then raise exception 'FNB_BRANCH_PRICE_RESOLVER_BACKUP_FAILED'; end if;
 execute backup;
 execute replace(definition,old_block,new_block);
end $metadata$;
revoke all on function public._resolve_sale_price_before_kitchen_20261028(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz) from public,anon,authenticated,service_role;
commit;
