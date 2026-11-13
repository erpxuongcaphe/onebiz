-- Keep the existing tenant, branch and independent order paths while resolving
-- the permission against the actual branch of each linked record.
-- Inventory/order view exceptions remain unavailable until all paths are audited.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; source text;
begin
 for item in select * from (values
  ('internal_sale_receipts','receipts_read_scope','inventory.view','user_has_branch_access'),
  ('operational_uom_requests','operational_uom_read','inventory.view','_can_read_branch_inventory_00476'),
  ('fnb_purchase_sales_order_links','fnb_order_link_read','inventory.view','orders.view'),
  ('warehouse_order_quantity_adjustments','warehouse_order_adjustments_read','orders.view','user_has_branch_access')
 ) expected(table_name,policy_name,anchor_a,anchor_b) loop
  select p.qual into source from pg_catalog.pg_policies p where p.schemaname='public'
   and p.tablename=item.table_name and p.policyname=item.policy_name and p.cmd='SELECT';
  if source is null or position(item.anchor_a in source)=0 or position(item.anchor_b in source)=0 then
   raise exception 'STAFF_LINKED_POLICY_CHANGED: %.%',item.table_name,item.policy_name;
  end if;
 end loop;
end $migration$;

alter policy receipts_read_scope on public.internal_sale_receipts using (
 tenant_id=public.get_user_tenant_id() and public._staff_my_inventory_view(branch_id)
 and public.user_has_branch_access((select auth.uid()),branch_id)
);
alter policy operational_uom_read on public.operational_uom_requests using (
 (public._staff_my_inventory_view(branch_id)
  and public._can_read_branch_inventory_00476((select auth.uid()),tenant_id,branch_id))
 or (reference_type='transfer' and public._staff_my_inventory_view(to_branch_id)
  and public._can_read_branch_inventory_00476((select auth.uid()),tenant_id,to_branch_id))
);
alter policy fnb_order_link_read on public.fnb_purchase_sales_order_links using (
 tenant_id=public.get_user_tenant_id() and (
  exists(select 1 from public.purchase_orders p where p.id=fnb_purchase_sales_order_links.purchase_order_id
   and public.user_has_branch_access((select auth.uid()),p.branch_id) and public._staff_my_inventory_view(p.branch_id))
  or exists(select 1 from public.invoices i where i.id=fnb_purchase_sales_order_links.sales_order_id
   and public.user_has_branch_access((select auth.uid()),i.branch_id) and public._staff_my_document_view('orders.view',i.branch_id))
 )
);
alter policy warehouse_order_adjustments_read on public.warehouse_order_quantity_adjustments using (
 exists(select 1 from public.invoices i where i.id=warehouse_order_quantity_adjustments.order_id
  and i.tenant_id=public.get_user_tenant_id() and public.user_has_branch_access((select auth.uid()),i.branch_id)
  and public._staff_my_document_view('orders.view',i.branch_id))
);
commit;
