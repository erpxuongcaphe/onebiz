-- "Only my orders" limits order-source invoices unless a separate, effective
-- operational/report permission independently requires access. Existing owner
-- access and independently granted work permissions are preserved.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_order_owner_unrestricted()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.tenant_id=public.get_user_tenant_id()
  and coalesce(p.is_active,false) and (p.role='owner' or not public.user_has_permission(p.id,'orders.view_own_only')))
$$;
create function public._staff_order_independent_branches()
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();tenant uuid;b record;code text;allowed boolean;result uuid[]:='{}'::uuid[];
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,false);
 if tenant is null then return result; end if;
 for b in select x.id from public.branches x where x.tenant_id=tenant and public.can_read_branch_document_00567(tenant,x.id) loop
  allowed:=false;
  foreach code in array array['invoices.view','inventory.view','pos_retail.checkout','pos_retail.void',
   'finance.view_cash_book','reports.dashboard'] loop
   if public._staff_permission_at_scope(actor,code,b.id) then allowed:=true;exit;end if;
  end loop;
  if not allowed and public._staff_permission_at_scope(actor,'reports.analytics',b.id)
   and public._staff_permission_at_scope(actor,'reports.view_detail',b.id) then allowed:=true;end if;
  if allowed then result:=array_append(result,b.id);end if;
 end loop;
 return result;
end $$;
revoke all on function public._staff_order_owner_unrestricted(),public._staff_order_independent_branches() from public,anon;
grant execute on function public._staff_order_owner_unrestricted(),public._staff_order_independent_branches() to authenticated;
-- Return preparation has its own capability: a permitted F&B worker may
-- prepare a return for a non-F&B invoice without receiving a general-purpose
-- grant to read all Retail invoice lines. Mirror the return writer's source,
-- active profile and persisted-branch checks and retain the own-order limit.
create or replace function public.staff_returnable_invoice_items(p_invoice_id uuid)
returns table(id uuid,product_id uuid,product_name text,unit text,quantity numeric,
 unit_price numeric,total numeric,returned_qty numeric)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; doc record;
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,false);
 if tenant is null then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 select i.branch_id,i.source,i.status,i.created_by into doc from public.invoices i
  where i.id=p_invoice_id and i.tenant_id=tenant;
 if not found or doc.branch_id is null or not coalesce(public.user_has_branch_access(actor,doc.branch_id),false)
  then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 if doc.status<>'completed' or doc.status is null then raise exception 'INVOICE_NOT_COMPLETED' using errcode='22023'; end if;
 if doc.source='fnb' then
  if not coalesce(public._staff_permission_at_scope(actor,'pos_fnb.checkout',doc.branch_id),false)
   then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 elsif not coalesce(public._staff_permission_at_scope(actor,'pos_retail.checkout',doc.branch_id),false)
   and not coalesce(public._staff_permission_at_scope(actor,'pos_fnb.view_orders',doc.branch_id),false)
  then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 if doc.source='order' and not public._staff_order_owner_unrestricted()
  and doc.created_by is distinct from actor
  and not coalesce(doc.branch_id=any(public._staff_order_independent_branches()),false)
  then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 return query select ii.id,ii.product_id,ii.product_name,ii.unit,ii.quantity,ii.unit_price,ii.total,ii.returned_qty
  from public.invoice_items ii where ii.invoice_id=p_invoice_id order by ii.id;
end $$;
revoke all on function public.staff_returnable_invoice_items(uuid) from public,anon;
grant execute on function public.staff_returnable_invoice_items(uuid) to authenticated;
create policy staff_own_order_read on public.invoices as restrictive for select to authenticated
 using (source is distinct from 'order' or (select public._staff_order_owner_unrestricted())
  or created_by=(select auth.uid()) or coalesce(branch_id=any((select public._staff_order_independent_branches())::uuid[]),false));
-- This view runs as its owner and does not inherit invoice RLS; apply the same
-- independent-branch and own-record boundary explicitly to its parent row.
do $migration$
declare definition text;changed text;old_acl text;old_owner oid;old_options text[];
 anchor constant text:='o.id = t.invoice_id AND';
begin
 select pg_get_viewdef(c.oid,true),c.relacl::text,c.relowner,c.reloptions into strict definition,old_acl,old_owner,old_options
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='invoice_items_scoped' and c.relkind='v';
 if not coalesce('security_barrier=true'=any(old_options),false) or position('_staff_invoice_item_allowed_scopes' in definition)=0
  or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_OWN_ORDER_VIEW_CHANGED';end if;
 changed:=replace(definition,anchor,'o.id = t.invoice_id AND (o.source IS DISTINCT FROM ''order'' OR (SELECT public._staff_order_owner_unrestricted()) OR o.created_by=(SELECT auth.uid()) OR coalesce(o.branch_id=any((SELECT public._staff_order_independent_branches())::uuid[]),false)) AND');
 execute format('create or replace view public.invoice_items_scoped %s as %s',
  case when old_options is null then '' else 'with ('||array_to_string(old_options,',')||')' end,changed);
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  and c.relname='invoice_items_scoped' and (c.relacl::text is distinct from old_acl or c.relowner<>old_owner or c.reloptions is distinct from old_options)) then
  raise exception 'STAFF_OWN_ORDER_VIEW_METADATA_CHANGED';end if;
end $migration$;
notify pgrst,'reload schema';
commit;
