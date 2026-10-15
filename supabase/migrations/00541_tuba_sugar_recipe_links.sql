-- Repair sugar bindings on recipes currently effective at Xưởng Tư Búa.
-- Shared recipes stay shared: do not fork BOMs behind the product editor.
-- Existing invoices/snapshots/stock and measured option quantities remain unchanged.
begin;
set local lock_timeout='3s';
do $repair$
declare tenant constant uuid:='148e8ac5-b891-4de3-9055-cfa41f39ddb0';
 branch constant uuid:='0dfc218e-0b32-4096-8205-d5f82ab42492';
 source public.bom%rowtype; target uuid; v_group_id uuid; groups uuid[]; old_data jsonb;
begin
 if not exists(select 1 from public.branches where id=branch and tenant_id=tenant) then return;end if;
 for source in
 select b.* from public.bom b join public.products product on product.id=b.product_id and product.tenant_id=tenant
 where b.tenant_id=tenant and b.is_active and product.is_active and product.channel='fnb'
 and not coalesce(product.is_fnb_stock_item,false) and (b.branch_id is null or b.branch_id=branch)
 and exists(select 1 from public.bom_items i join public.products ingredient on ingredient.id=i.material_id and ingredient.tenant_id=tenant
 where i.bom_id=b.id and i.modifier_scale_target is null and ingredient.code in ('SKU-BOT-009','SKU-BTP-003'))
 and public.get_active_bom_for_branch(b.product_id,branch,b.variant_id)=b.id
 order by b.id for update of b
 loop
 select array_agg(distinct g.id) into groups from public.modifier_groups g
 where g.tenant_id=tenant and g.is_active and g.name like 'Mức đường%'
 and g.channel in ('fnb','all') and (
 exists(select 1 from public.product_modifier_groups link where link.tenant_id=tenant and link.product_id=source.product_id and link.modifier_group_id=g.id)
 or (not exists(select 1 from public.product_modifier_groups link where link.tenant_id=tenant and link.product_id=source.product_id)
 and exists(select 1 from public.category_modifier_groups link join public.products product on product.category_id=link.category_id
 where product.id=source.product_id and link.tenant_id=tenant and link.modifier_group_id=g.id)));
 if coalesce(array_length(groups,1),0)<>1 then continue;end if;
 v_group_id:=groups[1];
 -- Only the standard numeric scale is repaired here. Measured custom recipes remain untouched.
 if exists(select 1 from public.modifier_options o where o.group_id=v_group_id and o.is_active and o.scale_factor is null) then continue;end if;
 old_data:=jsonb_build_object('bom',to_jsonb(source),'items',(select jsonb_agg(to_jsonb(i)) from public.bom_items i where i.bom_id=source.id));
 target:=source.id;
 update public.bom_items i set modifier_scale_target=v_group_id from public.products ingredient
 where i.bom_id=target and i.material_id=ingredient.id and ingredient.tenant_id=tenant
 and ingredient.code in ('SKU-BOT-009','SKU-BTP-003') and i.modifier_scale_target is null;
 update public.bom set updated_at=now() where id=target;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(tenant,coalesce(auth.uid(),'7f763419-5392-49de-9796-af2402c8cd23'::uuid),'fnb_recipe_sugar_link_repair','bom',target,old_data,
 jsonb_build_object('reviewed_at_branch_id',branch,'shared_recipe',source.branch_id is null,'source_bom_id',source.id,'modifier_group_id',v_group_id,'rule','Only sugar and sugar syrup; preserve condensed milk and honey'));
 end loop;
end $repair$;
commit;
