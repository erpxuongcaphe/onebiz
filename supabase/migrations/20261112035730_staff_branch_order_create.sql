-- Resolve each order mutation to a persisted branch, or the target branch for
-- a new order. Catalog activation awaits direct-write and full-path review.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target oid; n integer; source text; patched text; anchor text;
begin
 for item in select * from (values
   ('attach_invoice_shipment_atomic','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
   ('close_sales_order_processing','(select i.branch_id from public.invoices i where i.id=p_order_id and i.tenant_id=public.get_user_tenant_id())'),
   ('complete_legacy_sales_order_atomic','(select s.branch_id from public.sales_orders s where s.id=p_order_id and s.tenant_id=public.get_user_tenant_id())'),
   ('create_child_sale_from_order','(select i.branch_id from public.invoices i where i.id=p_order_id and i.tenant_id=public.get_user_tenant_id())'),
   ('duplicate_invoice_to_order_atomic','p_target_branch_id'),
   ('mark_order_processed','(select i.branch_id from public.invoices i where i.id=p_order_id and i.tenant_id=public.get_user_tenant_id())'),
   ('reopen_sales_order_processing','(select i.branch_id from public.invoices i where i.id=p_order_id and i.tenant_id=public.get_user_tenant_id())'),
   ('save_sales_order_atomic','coalesce((select i.branch_id from public.invoices i where i.id=p_order_id and i.tenant_id=public.get_user_tenant_id()),p_branch_id)'),
   ('update_draft_invoice_atomic','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())')
 ) as t(name,branch_expression) loop
   select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name;
   if n<>1 then raise exception 'STAFF_ORDER_CREATE_CONSUMER_AMBIGUOUS: %',item.name;end if;
   source:=pg_get_functiondef(target);
   patched:=regexp_replace(source,'user_has_permission\(v_actor,\s*''orders\.create''\)',
     '_staff_permission_at_scope(v_actor,''orders.create'','||item.branch_expression||')','g');
   if patched=source then raise exception 'STAFF_ORDER_CREATE_CONSUMER_CHANGED: %',item.name;end if;
   if item.name='duplicate_invoice_to_order_atomic' then
     anchor:='if v_source.source=''internal'' and v_source.source_order_id is not null then';
     if position(anchor in patched)=0 then raise exception 'STAFF_ORDER_DUPLICATE_SOURCE_CHANGED';end if;
     patched:=replace(patched,anchor,
       'if not coalesce(public.can_read_branch_document_00567(v_tenant_id,v_source.branch_id),false) then raise exception ''SOURCE_INVOICE_BRANCH_DENIED'' using errcode=''42501''; end if; '||anchor);
   end if;
   execute patched;
 end loop;
 source:=pg_get_functiondef('public.close_sales_orders_processing(uuid[],text,boolean)'::regprocedure);
 patched:=regexp_replace(source,'user_has_permission\(v_actor,\s*''orders\.create''\)',
   '_staff_permission_any_branch(v_actor,''orders.create'')','g');
 anchor:='if not public.user_has_branch_access(v_actor,v_row.branch_id) then';
 if patched=source or position(anchor in patched)=0 then raise exception 'STAFF_ORDER_CREATE_BATCH_CHANGED';end if;
 patched:=replace(patched,anchor,
   'if not public._staff_permission_at_scope(v_actor,''orders.create'',v_row.branch_id) or not public.user_has_branch_access(v_actor,v_row.branch_id) then');
 execute patched;
 source:=pg_get_functiondef('public.update_shipping_order_status_atomic(uuid,text,text)'::regprocedure);
 anchor:='else public.user_has_permission(v_actor,v_required_permission) end)';
 if position(anchor in source)=0 then raise exception 'STAFF_SHIPPING_CREATE_CONSUMER_CHANGED';end if;
 execute replace(source,anchor,
   'when v_required_permission=''orders.create'' then public._staff_permission_at_scope(v_actor,v_required_permission,v_order.branch_id) else public.user_has_permission(v_actor,v_required_permission) end)');
end $migration$;
commit;
