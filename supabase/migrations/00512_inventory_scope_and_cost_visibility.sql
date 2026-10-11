-- Branch inventory scope and cost visibility. No inventory data is changed.
begin;
create function public._can_read_branch_inventory_00476(p_user uuid,p_tenant uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles profile where profile.id=p_user
 and profile.tenant_id=p_tenant and coalesce(profile.is_active,true)
 and (public.user_has_branch_access(p_user,p_branch)
 or public.user_has_permission(p_user,'reports.view_all_branches')));
$$;
revoke all on function public._can_read_branch_inventory_00476(uuid,uuid,uuid) from public,anon;
grant execute on function public._can_read_branch_inventory_00476(uuid,uuid,uuid) to authenticated;
create policy branch_stock_scope_00476 on public.branch_stock as restrictive for select to authenticated
using(public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
create policy stock_movements_scope_00476 on public.stock_movements as restrictive for select to authenticated
using(public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
create policy internal_sales_scope_00476 on public.internal_sales as restrictive for select to authenticated
using(public._can_read_branch_inventory_00476(auth.uid(),tenant_id,from_branch_id)
 or public._can_read_branch_inventory_00476(auth.uid(),tenant_id,to_branch_id));
create policy internal_sale_items_scope_00476 on public.internal_sale_items as restrictive for select to authenticated
using(exists(select 1 from public.internal_sales sale where sale.id=internal_sale_items.internal_sale_id));
create policy fnb_cost_balances_permission_00476 on public.fnb_branch_product_cost_balances as restrictive for select to authenticated
using(public.user_has_permission(auth.uid(),'products.view_cost') and public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
create policy fnb_cost_events_permission_00476 on public.fnb_branch_product_cost_events as restrictive for select to authenticated
using(public.user_has_permission(auth.uid(),'products.view_cost') and public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
create function public.get_fnb_production_stock_health_00476(p_branch_id uuid,p_product_ids uuid[])
returns table(product_id uuid,physical_quantity numeric,costed_quantity numeric)
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid;
begin
 select profile.tenant_id into v_tenant from public.profiles profile where profile.id=auth.uid() and coalesce(profile.is_active,true);
 if v_tenant is null or not public._can_read_branch_inventory_00476(auth.uid(),v_tenant,p_branch_id)
 or not (public.user_has_permission(auth.uid(),'production.create_order') or public.user_has_permission(auth.uid(),'production.complete_order')) then
 raise exception 'PRODUCTION_BRANCH_ACCESS_DENIED' using errcode='42501'; end if;
 if coalesce(array_length(p_product_ids,1),0)>500 then raise exception 'TOO_MANY_PRODUCTS'; end if;
 return query select product.id,coalesce(stock.quantity,0),coalesce(balance.costed_quantity,0)
 from public.products product
 left join public.branch_stock stock on stock.tenant_id=v_tenant and stock.branch_id=p_branch_id and stock.product_id=product.id and stock.variant_id is null
 left join public.fnb_branch_product_cost_balances balance on balance.tenant_id=v_tenant and balance.branch_id=p_branch_id and balance.product_id=product.id
 where product.tenant_id=v_tenant and product.id=any(p_product_ids);
end; $$;
revoke all on function public.get_fnb_production_stock_health_00476(uuid,uuid[]) from public,anon;
grant execute on function public.get_fnb_production_stock_health_00476(uuid,uuid[]) to authenticated;
create view public.products_scoped with (security_barrier=true) as select
p.id,
p.tenant_id,
p.code,
p.barcode,
p.name,
p.category_id,
p.unit,
case when public.user_has_permission(auth.uid(),'products.view_cost') then p.cost_price else 0 end as cost_price,
p.sell_price,
coalesce((select sum(bs.quantity) from public.branch_stock bs where bs.tenant_id=p.tenant_id and bs.product_id=p.id and public._can_read_branch_inventory_00476(auth.uid(),bs.tenant_id,bs.branch_id)
and (public.user_has_permission(auth.uid(),'reports.view_all_branches')
or public.user_has_permission(auth.uid(),'inventory.view_assigned_totals')
or bs.branch_id=(select profile.branch_id from public.profiles profile where profile.id=auth.uid()))),0) as stock,
p.min_stock,
p.max_stock,
p.weight,
p.description,
p.image_url,
p.allow_sale,
p.is_active,
p.created_at,
p.updated_at,
p.product_type,
p.has_bom,
p.old_code,
p.group_code,
p.purchase_unit,
p.stock_unit,
p.sell_unit,
p.shelf_life_days,
p.shelf_life_unit,
p.supplier_id,
p.channel,
p.brand,
p.vat_rate,
p.sort_order,
p.bom_code,
p.is_fnb_stock_item,
p.inventory_role,
p.allow_free_sale from public.products p
where p.tenant_id=public.get_user_tenant_id() and exists(select 1 from public.profiles profile where profile.id=auth.uid() and coalesce(profile.is_active,true));
revoke all on public.products_scoped from public,anon;
grant select on public.products_scoped to authenticated;
revoke select on public.products from authenticated;
grant select ("id", "tenant_id", "code", "barcode", "name", "category_id", "unit", "sell_price", "min_stock", "max_stock", "weight", "description", "image_url", "allow_sale", "is_active", "created_at", "updated_at", "product_type", "has_bom", "old_code", "group_code", "purchase_unit", "stock_unit", "sell_unit", "shelf_life_days", "shelf_life_unit", "supplier_id", "channel", "brand", "vat_rate", "sort_order", "bom_code", "is_fnb_stock_item", "inventory_role", "allow_free_sale") on public.products to authenticated;
CREATE OR REPLACE FUNCTION public.calculate_fnb_bom_branch_cost_00390(p_bom_id uuid, p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
 v_actor uuid := auth.uid();
 v_tenant uuid;
 v_total numeric(18,4) := 0;
 v_item record;
 v_items jsonb := '[]'::jsonb;
begin
 select tenant_id into v_tenant from public.profiles
 where id = v_actor and coalesce(is_active, true);
 if v_actor is null or v_tenant is null
 or not public.user_has_permission(v_actor, 'products.view_cost')
 or not public.user_has_branch_access(v_actor, p_branch_id) then
 raise exception using errcode = '42501', message = 'FNB_BRANCH_COST_ACCESS_DENIED';
 end if;
 if not public._fnb_branch_cost_tracking_enabled_00390(v_tenant, p_branch_id) then
 raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_SCOPE_DISABLED';
 end if;

 for v_item in
 select p.id, p.code, p.name, bi.quantity, coalesce(bi.waste_percent, 0) as waste_percent,
 coalesce(cb.costed_quantity, 0) as costed_quantity,
 coalesce(cb.unit_cost, 0) as unit_cost,
 coalesce(bs.quantity, 0) as physical_quantity
 from public.bom bom
 join public.bom_items bi on bi.bom_id = bom.id
 join public.products p on p.id = bi.material_id and p.tenant_id = bom.tenant_id
 left join public.fnb_branch_product_cost_balances cb
 on cb.tenant_id = p.tenant_id and cb.branch_id = p_branch_id and cb.product_id = p.id
 left join public.branch_stock bs
 on bs.tenant_id = p.tenant_id and bs.branch_id = p_branch_id
 and bs.product_id = p.id and bs.variant_id is null
 where bom.id = p_bom_id and bom.tenant_id = v_tenant
 order by bi.sort_order, bi.id
 loop
 if abs(v_item.costed_quantity - v_item.physical_quantity) > 0.0001 then
 raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_REQUIRED',
 detail = coalesce(v_item.code, v_item.name);
 end if;
 v_total := v_total + v_item.quantity * (1 + v_item.waste_percent / 100) * v_item.unit_cost;
 v_items := v_items || jsonb_build_object(
 'material_id', v_item.id, 'code', v_item.code, 'name', v_item.name,
 'quantity', v_item.quantity, 'waste_percent', v_item.waste_percent,
 'branch_unit_cost', v_item.unit_cost,
 'line_cost', round(v_item.quantity * (1 + v_item.waste_percent / 100) * v_item.unit_cost, 4)
 );
 end loop;
 if jsonb_array_length(v_items) = 0 then
 raise exception using errcode = 'P0001', message = 'FNB_BOM_COST_NOT_FOUND';
 end if;
 return jsonb_build_object(
 'bom_id', p_bom_id, 'branch_id', p_branch_id,
 'cost_source', 'fnb_branch_weighted_average', 'total_cost', round(v_total, 4), 'items', v_items
 );
end;
$function$
;
notify pgrst,'reload schema';
commit;
