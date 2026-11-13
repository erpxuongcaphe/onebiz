-- Scope invoice-line reads without activating the corresponding branch-view
-- catalog entries until the remaining invoice/order consumers are audited.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Keep the existing view's compatibility hook, but never let the absence of
-- an override substitute for an actual permission.
create function public._staff_invoice_item_legacy_scope()
returns boolean language sql immutable set search_path='' as $$ select false $$;
revoke all on function public._staff_invoice_item_legacy_scope() from public,anon;
grant execute on function public._staff_invoice_item_legacy_scope() to authenticated;
create function public._staff_invoice_item_read(p_tenant uuid,p_branch uuid,p_source text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); member boolean; report_scope boolean; code text;
begin
 if actor is null or p_tenant is distinct from public.get_user_tenant_id()
  or not exists(select 1 from public.profiles p where p.id=actor and p.tenant_id=p_tenant and coalesce(p.is_active,false))
  or not exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant) then return false; end if;
 member:=coalesce(public.user_has_branch_access(actor,p_branch),false);
 report_scope:=member or coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false);
 if not report_scope then return false; end if;
 if member then
  foreach code in array array['inventory.view','invoices.view'] loop
   if public._staff_permission_at_scope(actor,code,p_branch) then return true; end if;
  end loop;
  if p_source='order' and public._staff_permission_at_scope(actor,'orders.view',p_branch) then return true; end if;
  if p_source='fnb' then
   foreach code in array array['pos_fnb.view_orders','pos_fnb.checkout','pos_fnb.send_kitchen','pos_fnb.void_paid_bill'] loop
    if public._staff_permission_at_scope(actor,code,p_branch) then return true; end if;
   end loop;
  elsif p_source in ('pos','order') then
   foreach code in array array['pos_retail.checkout','pos_retail.void','orders.create','orders.cancel'] loop
    if public._staff_permission_at_scope(actor,code,p_branch) then return true; end if;
   end loop;
  elsif p_source='internal' then
   -- Internal sales also create invoice lines. Preserve independently granted
   -- source-branch actions without granting unrelated F&B/order documents.
   foreach code in array array['inventory.internal_export','pos_retail.checkout','pos_retail.void'] loop
    if public._staff_permission_at_scope(actor,code,p_branch) then return true; end if;
   end loop;
  end if;
 end if;
 if report_scope then
  if public._staff_permission_at_scope(actor,'reports.dashboard',p_branch) then return true; end if;
  if public._staff_permission_at_scope(actor,'reports.analytics',p_branch)
   and public._staff_permission_at_scope(actor,'reports.view_detail',p_branch) then return true; end if;
  -- F&B reporting obtains totals through scoped aggregate RPCs; report
  -- access alone must not grant the underlying invoice item rows.
 end if;
 return false;
end $$;
revoke all on function public._staff_invoice_item_read(uuid,uuid,text) from public,anon;
grant execute on function public._staff_invoice_item_read(uuid,uuid,text) to authenticated;
-- A report can contain thousands of lines. Resolve the small set of
-- branch/source pairs once per statement, rather than checking every line.
create function public._staff_invoice_item_allowed_scopes()
returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(q.branch_id::text||':'||q.source),'{}'::text[]) from (
  -- Existing Retail filters treat a missing source as a retail invoice.
  select distinct i.branch_id,coalesce(i.source,'pos') as source from public.invoices i
   where i.tenant_id=(select public.get_user_tenant_id()) and i.branch_id is not null
 ) q where public._staff_invoice_item_read((select public.get_user_tenant_id()),q.branch_id,q.source)
$$;
revoke all on function public._staff_invoice_item_allowed_scopes() from public,anon;
grant execute on function public._staff_invoice_item_allowed_scopes() to authenticated;
create policy staff_invoice_item_view_scope on public.invoice_items as restrictive for select to authenticated
 using ((select public._staff_invoice_item_legacy_scope()) or exists(select 1 from public.invoices i where i.id=invoice_items.invoice_id
  and coalesce((i.branch_id::text||':'||coalesce(i.source,'pos'))=any((select public._staff_invoice_item_allowed_scopes())::text[]),false)));
do $migration$
declare definition text; changed text; old_acl text; old_owner oid; old_options text[];
 anchor constant text := 'o.id = t.invoice_id AND (EXISTS';
begin
 select pg_get_viewdef(c.oid,true),c.relacl::text,c.relowner,c.reloptions into strict definition,old_acl,old_owner,old_options
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='invoice_items_scoped' and c.relkind='v';
 if not coalesce('security_barrier=true'=any(old_options),false)
  or position('products.view_cost' in definition)=0
  or position('_can_read_branch_inventory_00476' in definition)=0 then
  raise exception 'STAFF_INVOICE_ITEM_VIEW_SECURITY_CHANGED'; end if;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_INVOICE_ITEM_VIEW_CHANGED'; end if;
 changed:=replace(definition,anchor,'o.id = t.invoice_id AND ((SELECT public._staff_invoice_item_legacy_scope()) OR coalesce((o.branch_id::text||'':''||coalesce(o.source,''pos''))=any((SELECT public._staff_invoice_item_allowed_scopes())::text[]),false)) AND (EXISTS');
 execute format('create or replace view public.invoice_items_scoped %s as %s',
  case when old_options is null then '' else 'with ('||array_to_string(old_options,',')||')' end,changed);
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='invoice_items_scoped'
   and (c.relacl::text is distinct from old_acl or c.relowner<>old_owner or c.reloptions is distinct from old_options)) then
  raise exception 'STAFF_INVOICE_ITEM_VIEW_METADATA_CHANGED'; end if;
end $migration$;
notify pgrst,'reload schema';
commit;
