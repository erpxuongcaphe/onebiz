-- Owner-confirmed shared recipes, 2026-10-21:
-- Hồng Trà Chanh: 1.5 chanh + 0.5 tắc. Hồng Trà Mật Ong: 53g at all three sweetness levels.
-- Configuration only: no stock adjustment, invoice rewrite or historical reconsumption.
begin;
set local lock_timeout='3s';
do $recipes$
declare
 v_tenant uuid:='148e8ac5-b891-4de3-9055-cfa41f39ddb0';
 v_honey_bom uuid:='7c47398a-82fe-4a08-b117-dd5ab4099c20';
 v_lemon_bom uuid:='c52358b4-ad28-4b09-b7ef-6200b0fb5d82';
 v_expected record; v_item record;
begin
 -- The tenant-specific data patch is a no-op on new installations/other tenants.
 if not exists(select 1 from public.products where id='240e906d-e95e-4e9b-bdba-dea969feca96' and tenant_id=v_tenant) then return; end if;
 perform 1 from public.bom where id in (v_honey_bom,v_lemon_bom) order by id for update;
 if (select count(*) from public.bom where tenant_id=v_tenant and is_active and branch_id is null and variant_id is null
      and ((id=v_honey_bom and product_id='240e906d-e95e-4e9b-bdba-dea969feca96')
        or (id=v_lemon_bom and product_id='dd1f9569-604b-458c-a43e-eb5217a4c736')))<>2
 or exists(select 1 from public.bom where tenant_id=v_tenant and is_active
      and product_id in ('240e906d-e95e-4e9b-bdba-dea969feca96','dd1f9569-604b-458c-a43e-eb5217a4c736')
      and id not in (v_honey_bom,v_lemon_bom)) then raise exception 'CONFIRMED_TEA_RECIPE_SCOPE_CHANGED'; end if;
 -- Inspect and lock all three old/new values before changing any row.
 for v_expected in select * from (values
   ('8951e89d-9997-4020-a8a1-d22a5c5326d4'::uuid,v_honey_bom,'0a398b76-4de8-4317-8e34-0e594fe59b0b'::uuid,'Chai','G',0.0003::numeric,1::numeric,0.0177::numeric,53::numeric,0.00033333::numeric),
   ('8110adf1-3732-43e2-8dec-791bc90fd39d'::uuid,v_lemon_bom,'34617a2e-d6e4-40b3-b20a-3587266ddf9b'::uuid,'Trái','Trái',2::numeric,2::numeric,1.5::numeric,1.5::numeric,1::numeric),
   ('3ec63bfb-3a2d-4552-ad07-b2695f1655ac'::uuid,v_lemon_bom,'64ce6219-d22d-4313-97b7-49add8a8bd6b'::uuid,'Trái','Trái',1::numeric,1::numeric,0.5::numeric,0.5::numeric,1::numeric)
 ) x(item_id,bom_id,material_id,stock_unit,input_unit,old_qty,old_input,new_qty,new_input,factor)
 loop
  select * into v_item from public.bom_items where id=v_expected.item_id and bom_id=v_expected.bom_id and material_id=v_expected.material_id for update;
  if not found or v_item.unit is distinct from v_expected.stock_unit or v_item.input_unit is distinct from v_expected.input_unit
    or v_item.conversion_factor is distinct from v_expected.factor or coalesce(v_item.waste_percent,0)<>0 or v_item.modifier_scale_target is not null
    or not exists(select 1 from public.products where id=v_expected.material_id and tenant_id=v_tenant and unit=v_expected.stock_unit and is_active)
    or not ((v_item.quantity=v_expected.old_qty and v_item.input_quantity=v_expected.old_input)
         or (v_item.quantity=v_expected.new_qty and v_item.input_quantity=v_expected.new_input))
    or exists(select 1 from public.bom_modifier_option_quantities where bom_id=v_expected.bom_id and material_id=v_expected.material_id) then
    raise exception 'CONFIRMED_TEA_RECIPE_VALUE_CHANGED: %',v_expected.item_id;
  end if;
 end loop;
 update public.bom_items set quantity=0.0177,input_quantity=53
 where id='8951e89d-9997-4020-a8a1-d22a5c5326d4' and (quantity,input_quantity) is distinct from (0.0177::numeric,53::numeric);
 update public.bom_items set quantity=1.5,input_quantity=1.5
 where id='8110adf1-3732-43e2-8dec-791bc90fd39d' and (quantity,input_quantity) is distinct from (1.5::numeric,1.5::numeric);
 update public.bom_items set quantity=0.5,input_quantity=0.5
 where id='3ec63bfb-3a2d-4552-ad07-b2695f1655ac' and (quantity,input_quantity) is distinct from (0.5::numeric,0.5::numeric);
 -- Invalidate the two recipe cost caches after quantity changes.
 update public.bom set cached_cost=null,cached_cost_updated_at=null,updated_at=now() where id in (v_honey_bom,v_lemon_bom);
end;
$recipes$;
commit;
