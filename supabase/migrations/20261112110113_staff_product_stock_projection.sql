-- Product master data is shared, but its owner-backed stock aggregate must
-- not bypass the viewer's branch stock scope. NULL means no visible stock
-- scope; it is deliberately distinct from a confirmed quantity of zero.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Resolve scope and missing branch balances together in one snapshot so a
-- hidden row cannot be mistaken for a permitted branch with zero stock.
create function public.get_product_list_branch_stock(p_branch uuid,p_product_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();tenant uuid;allowed boolean;
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,true);
 if tenant is null then raise exception 'PRODUCT_STOCK_AUTH_REQUIRED' using errcode='42501';end if;
 if p_branch is null or p_product_ids is null or cardinality(p_product_ids)>1000 or array_position(p_product_ids,null) is not null then
  raise exception 'PRODUCT_STOCK_INVALID_REQUEST' using errcode='22023';end if;
 if not exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=tenant) then
  raise exception 'PRODUCT_STOCK_BRANCH_DENIED' using errcode='42501';end if;
 allowed:=public._can_read_branch_inventory_00476(actor,tenant,p_branch)
   and (public._staff_stock_has_no_view_exception() or p_branch=any(public._staff_stock_readable_branches()));
 if not coalesce(allowed,false) then return jsonb_build_object('allowed',false,'rows','[]'::jsonb);end if;
 return jsonb_build_object('allowed',true,'rows',coalesce((select jsonb_agg(to_jsonb(x)) from (
  select s.product_id,sum(s.quantity)::numeric quantity from public.branch_stock s
   where s.tenant_id=tenant and s.branch_id=p_branch and s.variant_id is null and s.product_id=any(p_product_ids)
   group by s.product_id
 ) x),'[]'::jsonb));
end $$;
revoke all on function public.get_product_list_branch_stock(uuid,uuid[]) from public,anon;
grant execute on function public.get_product_list_branch_stock(uuid,uuid[]) to authenticated;
do $migration$
declare source text; patched text; start_at integer; end_at integer; old_acl text; old_owner oid; old_options text[];
 replacement text:=$expression$
  case when (select public._staff_stock_has_no_view_exception()) or (select exists (
   select 1 from public.branches visible_branch where visible_branch.tenant_id=public.get_user_tenant_id()
    and visible_branch.id=any((select public._staff_stock_readable_branches())::uuid[])
    and public._can_read_branch_inventory_00476(auth.uid(),p.tenant_id,visible_branch.id)
    and (public.user_has_permission(auth.uid(),'reports.view_all_branches')
      or public.user_has_permission(auth.uid(),'inventory.view_assigned_totals')
      or visible_branch.id=(select profile.branch_id from public.profiles profile where profile.id=auth.uid()))
  )) then coalesce((select sum(bs.quantity) from public.branch_stock bs
    where bs.tenant_id=p.tenant_id and bs.product_id=p.id
     and public._can_read_branch_inventory_00476(auth.uid(),bs.tenant_id,bs.branch_id)
     and (public.user_has_permission(auth.uid(),'reports.view_all_branches')
      or public.user_has_permission(auth.uid(),'inventory.view_assigned_totals')
      or bs.branch_id=(select profile.branch_id from public.profiles profile where profile.id=auth.uid()))
     and ((select public._staff_stock_has_no_view_exception())
      or bs.branch_id=any((select public._staff_stock_readable_branches())::uuid[]))
  ),0::numeric) else null::numeric end
 $expression$;
begin
 select pg_get_viewdef(c.oid,true),c.relacl::text,c.relowner,c.reloptions into source,old_acl,old_owner,old_options
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='products_scoped' and c.relkind='v';
 start_at:=position('COALESCE(( SELECT sum(bs.quantity) AS sum' in source);
 end_at:=position(' AS stock,' in source);
 if not coalesce('security_barrier=true'=any(old_options),false)
  or start_at=0 or end_at<=start_at or position('FROM products p' in source)=0 then
  raise exception 'STAFF_PRODUCT_STOCK_VIEW_CHANGED';end if;
 patched:=substring(source from 1 for start_at-1)||replacement||substring(source from end_at);
 execute format('create or replace view public.products_scoped with (%s) as %s',array_to_string(old_options,','),patched);
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='products_scoped'
   and (c.relacl::text is distinct from old_acl or c.relowner<>old_owner or c.reloptions is distinct from old_options)) then
  raise exception 'STAFF_PRODUCT_VIEW_METADATA_CHANGED';end if;
end $migration$;
commit;
