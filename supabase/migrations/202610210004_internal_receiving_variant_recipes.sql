-- Receiving must follow the BOM of every active menu variant (250g/500g, sizes).
-- Installation does not update historical receipts, expenses, stock or recipes.
begin;
set local lock_timeout='3s';

create or replace function public._internal_receiving_recipe_boms_20261021(
 p_tenant uuid,p_product uuid,p_branch uuid
) returns table(bom_id uuid) language sql stable security definer set search_path=public,pg_temp as $fn$
 select distinct b.id from public.products p
 cross join lateral (
  select null::uuid as variant_id where not exists(
   select 1 from public.product_variants pv where pv.tenant_id=p_tenant and pv.product_id=p.id)
   or exists(select 1 from public.bom base where base.id=public.get_active_bom_for_branch(p.id,p_branch,null) and base.variant_id is null)
  union all
  select pv.id from public.product_variants pv
   where pv.tenant_id=p_tenant and pv.product_id=p.id and pv.is_active
 ) choice
 join public.bom b on b.id=public.get_active_bom_for_branch(p.id,p_branch,choice.variant_id)
 where p.id=p_product and p.tenant_id=p_tenant and p.is_active
  and b.tenant_id=p_tenant and b.is_active and (b.branch_id is null or b.branch_id=p_branch);
$fn$;
revoke all on function public._internal_receiving_recipe_boms_20261021(uuid,uuid,uuid) from public,anon,authenticated,service_role;

do $patch$
declare d text; a text; b text;
begin
 d:=replace(pg_get_functiondef('public._internal_receiving_policy_00570(uuid,uuid,uuid,uuid)'::regprocedure),E'\r\n',E'\n');
 if position('receiving_variant_recipes_20261021' in d)>0 then return; end if;
 if position('branch_recipe_not_ready' in d)=0 or position('verified_pack_conversion' in d)=0
  or position('fnb_product_branch_menu_scopes' in d)=0 then
  raise exception 'INTERNAL_RECEIVING_VARIANT_PREREQUISITE_CHANGED'; end if;
 a:='with recursive dependencies(product_id,path) as (';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVING_VARIANT_GRAPH_CHANGED'; end if;
 d:=replace(d,a,'-- receiving_variant_recipes_20261021'||E'\n '||a);
 a:='join bom_items bi on bi.bom_id=get_active_bom_for_branch(p.id,p_destination,null)';
 b:='join lateral public._internal_receiving_recipe_boms_20261021(p_tenant,p.id,p_destination) rb on true join bom_items bi on bi.bom_id=rb.bom_id';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVING_VARIANT_ROOT_CHANGED'; end if;
 d:=replace(d,a,b);
 a:='join bom_items bi on bi.bom_id=get_active_bom_for_branch(d.product_id,p_destination,null)';
 b:='join lateral public._internal_receiving_recipe_boms_20261021(p_tenant,d.product_id,p_destination) rb on true join bom_items bi on bi.bom_id=rb.bom_id';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVING_VARIANT_RECURSION_CHANGED'; end if;
 d:=replace(d,a,b);
 a:='from bom_items bi where bi.bom_id=get_active_bom_for_branch(dependencies.product_id,p_destination,null)';
 b:='from public._internal_receiving_recipe_boms_20261021(p_tenant,dependencies.product_id,p_destination) rb join bom_items bi on bi.bom_id=rb.bom_id where true';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVING_VARIANT_CYCLE_CHANGED'; end if;
 execute replace(d,a,b);
end;
$patch$;
commit;
notify pgrst,'reload schema';
