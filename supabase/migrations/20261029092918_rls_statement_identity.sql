-- Per-statement identity only. Roles, policy command, tenant/branch/permission predicates stay intact.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='bom' and policyname='bom_scope_00477' and qual is not distinct from '((branch_id IS NULL) OR _can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: bom.bom_scope_00477'; end if;
end $guard$;
ALTER POLICY "bom_scope_00477" ON public."bom" USING (((branch_id IS NULL) OR _can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='branch_stock' and policyname='branch_stock_scope_00476' and qual is not distinct from '_can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id)' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: branch_stock.branch_stock_scope_00476'; end if;
end $guard$;
ALTER POLICY "branch_stock_scope_00476" ON public."branch_stock" USING (_can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, branch_id));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='cash_amendments' and policyname='cash_amendment_read' and qual is not distinct from '(EXISTS ( SELECT 1
   FROM (cash_transactions c
     JOIN profiles p ON (((p.id = auth.uid()) AND COALESCE(p.is_active, true))))
  WHERE ((c.id = cash_amendments.original_cash_id) AND (c.tenant_id = cash_amendments.tenant_id) AND (p.tenant_id = c.tenant_id) AND user_has_branch_access(auth.uid(), c.branch_id) AND user_has_permission(auth.uid(), ''finance.view_cash_book''::text))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: cash_amendments.cash_amendment_read'; end if;
end $guard$;
ALTER POLICY "cash_amendment_read" ON public."cash_amendments" USING ((EXISTS ( SELECT 1
   FROM (cash_transactions c
     JOIN profiles p ON (((p.id = (SELECT auth.uid())) AND COALESCE(p.is_active, true))))
  WHERE ((c.id = cash_amendments.original_cash_id) AND (c.tenant_id = cash_amendments.tenant_id) AND (p.tenant_id = c.tenant_id) AND user_has_branch_access((SELECT auth.uid()), c.branch_id) AND user_has_permission((SELECT auth.uid()), 'finance.view_cash_book'::text)))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='customer_advance_allocations' and policyname='customer_advance_allocations_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_branch_access(auth.uid(), branch_id) AND user_has_permission(auth.uid(), ''customers.view_debt''::text))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: customer_advance_allocations.customer_advance_allocations_select'; end if;
end $guard$;
ALTER POLICY "customer_advance_allocations_select" ON public."customer_advance_allocations" USING (((tenant_id = get_user_tenant_id()) AND user_has_branch_access((SELECT auth.uid()), branch_id) AND user_has_permission((SELECT auth.uid()), 'customers.view_debt'::text)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='customer_advances' and policyname='customer_advances_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_branch_access(auth.uid(), branch_id) AND user_has_permission(auth.uid(), ''customers.view_debt''::text))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: customer_advances.customer_advances_select'; end if;
end $guard$;
ALTER POLICY "customer_advances_select" ON public."customer_advances" USING (((tenant_id = get_user_tenant_id()) AND user_has_branch_access((SELECT auth.uid()), branch_id) AND user_has_permission((SELECT auth.uid()), 'customers.view_debt'::text)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='customer_saved_views' and policyname='csv_delete_own' and qual is not distinct from '(user_id = auth.uid())' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: customer_saved_views.csv_delete_own'; end if;
end $guard$;
ALTER POLICY "csv_delete_own" ON public."customer_saved_views" USING ((user_id = (SELECT auth.uid())));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='customer_saved_views' and policyname='csv_insert_own' and qual is not distinct from NULL and with_check is not distinct from '((user_id = auth.uid()) AND (tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))))') then
 raise exception 'POLICY_DRIFT: customer_saved_views.csv_insert_own'; end if;
end $guard$;
ALTER POLICY "csv_insert_own" ON public."customer_saved_views" WITH CHECK (((user_id = (SELECT auth.uid())) AND (tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = (SELECT auth.uid()))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='customer_saved_views' and policyname='csv_select_own_or_shared' and qual is not distinct from '((user_id = auth.uid()) OR ((is_shared = true) AND (tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: customer_saved_views.csv_select_own_or_shared'; end if;
end $guard$;
ALTER POLICY "csv_select_own_or_shared" ON public."customer_saved_views" USING (((user_id = (SELECT auth.uid())) OR ((is_shared = true) AND (tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = (SELECT auth.uid())))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='customer_saved_views' and policyname='csv_update_own' and qual is not distinct from '(user_id = auth.uid())' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: customer_saved_views.csv_update_own'; end if;
end $guard$;
ALTER POLICY "csv_update_own" ON public."customer_saved_views" USING ((user_id = (SELECT auth.uid())));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='dashboard_live_signals' and policyname='dashboard_live_signals_read' and qual is not distinct from '((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.tenant_id = dashboard_live_signals.tenant_id) AND p.is_active))) AND user_has_permission(auth.uid(), ''reports.dashboard''::text) AND (user_has_branch_access(auth.uid(), branch_id) OR ((branch_id IS NULL) AND user_has_permission(auth.uid(), ''reports.view_all_branches''::text))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: dashboard_live_signals.dashboard_live_signals_read'; end if;
end $guard$;
ALTER POLICY "dashboard_live_signals_read" ON public."dashboard_live_signals" USING (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.tenant_id = dashboard_live_signals.tenant_id) AND p.is_active))) AND user_has_permission((SELECT auth.uid()), 'reports.dashboard'::text) AND (user_has_branch_access((SELECT auth.uid()), branch_id) OR ((branch_id IS NULL) AND user_has_permission((SELECT auth.uid()), 'reports.view_all_branches'::text)))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='debt_opening_balances' and policyname='debt_opening_balances_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (((branch_id IS NOT NULL) AND user_has_branch_access(auth.uid(), branch_id)) OR ((branch_id IS NULL) AND user_has_permission(auth.uid(), ''finance.view_reports''::text))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: debt_opening_balances.debt_opening_balances_select'; end if;
end $guard$;
ALTER POLICY "debt_opening_balances_select" ON public."debt_opening_balances" USING (((tenant_id = get_user_tenant_id()) AND (((branch_id IS NOT NULL) AND user_has_branch_access((SELECT auth.uid()), branch_id)) OR ((branch_id IS NULL) AND user_has_permission((SELECT auth.uid()), 'finance.view_reports'::text)))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='favorites' and policyname='favorites_delete' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: favorites.favorites_delete'; end if;
end $guard$;
ALTER POLICY "favorites_delete" ON public."favorites" USING (((tenant_id = get_user_tenant_id()) AND (user_id = (SELECT auth.uid()))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='favorites' and policyname='favorites_insert' and qual is not distinct from NULL and with_check is not distinct from '((tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()))') then
 raise exception 'POLICY_DRIFT: favorites.favorites_insert'; end if;
end $guard$;
ALTER POLICY "favorites_insert" ON public."favorites" WITH CHECK (((tenant_id = get_user_tenant_id()) AND (user_id = (SELECT auth.uid()))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_branch_product_cost_balances' and policyname='fnb_branch_product_cost_balances_read' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''products.view''::text) AND user_has_branch_access(auth.uid(), branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_branch_product_cost_balances.fnb_branch_product_cost_balances_read'; end if;
end $guard$;
ALTER POLICY "fnb_branch_product_cost_balances_read" ON public."fnb_branch_product_cost_balances" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'products.view'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_branch_product_cost_balances' and policyname='fnb_cost_balances_permission_00476' and qual is not distinct from '(user_has_permission(auth.uid(), ''products.view_cost''::text) AND _can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_branch_product_cost_balances.fnb_cost_balances_permission_00476'; end if;
end $guard$;
ALTER POLICY "fnb_cost_balances_permission_00476" ON public."fnb_branch_product_cost_balances" USING ((user_has_permission((SELECT auth.uid()), 'products.view_cost'::text) AND _can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_branch_product_cost_events' and policyname='fnb_branch_product_cost_events_read' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''products.view''::text) AND user_has_branch_access(auth.uid(), branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_branch_product_cost_events.fnb_branch_product_cost_events_read'; end if;
end $guard$;
ALTER POLICY "fnb_branch_product_cost_events_read" ON public."fnb_branch_product_cost_events" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'products.view'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_branch_product_cost_events' and policyname='fnb_cost_events_permission_00476' and qual is not distinct from '(user_has_permission(auth.uid(), ''products.view_cost''::text) AND _can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_branch_product_cost_events.fnb_cost_events_permission_00476'; end if;
end $guard$;
ALTER POLICY "fnb_cost_events_permission_00476" ON public."fnb_branch_product_cost_events" USING ((user_has_permission((SELECT auth.uid()), 'products.view_cost'::text) AND _can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_purchase_sales_order_links' and policyname='fnb_order_link_read' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND ((EXISTS ( SELECT 1
   FROM purchase_orders p
  WHERE ((p.id = fnb_purchase_sales_order_links.purchase_order_id) AND user_has_branch_access(auth.uid(), p.branch_id) AND user_has_permission(auth.uid(), ''inventory.view''::text)))) OR (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = fnb_purchase_sales_order_links.sales_order_id) AND user_has_branch_access(auth.uid(), i.branch_id) AND user_has_permission(auth.uid(), ''orders.view''::text))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_purchase_sales_order_links.fnb_order_link_read'; end if;
end $guard$;
ALTER POLICY "fnb_order_link_read" ON public."fnb_purchase_sales_order_links" USING (((tenant_id = get_user_tenant_id()) AND ((EXISTS ( SELECT 1
   FROM purchase_orders p
  WHERE ((p.id = fnb_purchase_sales_order_links.purchase_order_id) AND user_has_branch_access((SELECT auth.uid()), p.branch_id) AND user_has_permission((SELECT auth.uid()), 'inventory.view'::text)))) OR (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = fnb_purchase_sales_order_links.sales_order_id) AND user_has_branch_access((SELECT auth.uid()), i.branch_id) AND user_has_permission((SELECT auth.uid()), 'orders.view'::text)))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_sale_cost_shortfalls_00473' and policyname='read_branch_shortfalls' and qual is not distinct from '((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND COALESCE(profiles.is_active, true)))) AND user_has_branch_access(auth.uid(), branch_id) AND (user_has_permission(auth.uid(), ''products.view''::text) OR user_has_permission(auth.uid(), ''system.view_audit''::text)))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_sale_cost_shortfalls_00473.read_branch_shortfalls'; end if;
end $guard$;
ALTER POLICY "read_branch_shortfalls" ON public."fnb_sale_cost_shortfalls_00473" USING (((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND COALESCE(profiles.is_active, true)))) AND user_has_branch_access((SELECT auth.uid()), branch_id) AND (user_has_permission((SELECT auth.uid()), 'products.view'::text) OR user_has_permission((SELECT auth.uid()), 'system.view_audit'::text))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_supply_branch_scope_audit' and policyname='fnb_supply_branch_scope_audit_read' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''products.edit''::text) AND user_has_permission(auth.uid(), ''system.manage_branches''::text) AND user_has_branch_access(auth.uid(), branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_supply_branch_scope_audit.fnb_supply_branch_scope_audit_read'; end if;
end $guard$;
ALTER POLICY "fnb_supply_branch_scope_audit_read" ON public."fnb_supply_branch_scope_audit" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'products.edit'::text) AND user_has_permission((SELECT auth.uid()), 'system.manage_branches'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_supply_branch_scopes' and policyname='fnb_supply_branch_scopes_read' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''products.view''::text) AND user_has_branch_access(auth.uid(), branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_supply_branch_scopes.fnb_supply_branch_scopes_read'; end if;
end $guard$;
ALTER POLICY "fnb_supply_branch_scopes_read" ON public."fnb_supply_branch_scopes" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'products.view'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_supply_catalog' and policyname='fnb_supply_catalog_read' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''products.view''::text) AND user_has_branch_access(auth.uid(), branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_supply_catalog.fnb_supply_catalog_read'; end if;
end $guard$;
ALTER POLICY "fnb_supply_catalog_read" ON public."fnb_supply_catalog" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'products.view'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='fnb_supply_catalog_audit' and policyname='fnb_supply_catalog_audit_read' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''products.edit''::text) AND user_has_permission(auth.uid(), ''system.manage_branches''::text) AND user_has_branch_access(auth.uid(), branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: fnb_supply_catalog_audit.fnb_supply_catalog_audit_read'; end if;
end $guard$;
ALTER POLICY "fnb_supply_catalog_audit_read" ON public."fnb_supply_catalog_audit" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'products.edit'::text) AND user_has_permission((SELECT auth.uid()), 'system.manage_branches'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='internal_sale_receipts' and policyname='receipts_read_scope' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''inventory.view''::text) AND user_has_branch_access(auth.uid(), branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: internal_sale_receipts.receipts_read_scope'; end if;
end $guard$;
ALTER POLICY "receipts_read_scope" ON public."internal_sale_receipts" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'inventory.view'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='internal_sales' and policyname='internal_sales_scope_00476' and qual is not distinct from '(_can_read_branch_inventory_00476(auth.uid(), tenant_id, from_branch_id) OR _can_read_branch_inventory_00476(auth.uid(), tenant_id, to_branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: internal_sales.internal_sales_scope_00476'; end if;
end $guard$;
ALTER POLICY "internal_sales_scope_00476" ON public."internal_sales" USING ((_can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, from_branch_id) OR _can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, to_branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='inventory_checks' and policyname='inventory_checks_scope_00477' and qual is not distinct from '_can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id)' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: inventory_checks.inventory_checks_scope_00477'; end if;
end $guard$;
ALTER POLICY "inventory_checks_scope_00477" ON public."inventory_checks" USING (_can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, branch_id));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='inventory_opening_batches' and policyname='inventory_opening_batches_read' and qual is not distinct from '((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND COALESCE(profiles.is_active, true)))) AND user_has_branch_access(auth.uid(), branch_id) AND user_has_permission(auth.uid(), ''inventory.adjust''::text))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: inventory_opening_batches.inventory_opening_batches_read'; end if;
end $guard$;
ALTER POLICY "inventory_opening_batches_read" ON public."inventory_opening_batches" USING (((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND COALESCE(profiles.is_active, true)))) AND user_has_branch_access((SELECT auth.uid()), branch_id) AND user_has_permission((SELECT auth.uid()), 'inventory.adjust'::text)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='kitchen_stations' and policyname='kitchen_stations_delete_00372' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''system.manage_branches''::text) AND user_has_branch_access(auth.uid(), branch_id))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: kitchen_stations.kitchen_stations_delete_00372'; end if;
end $guard$;
ALTER POLICY "kitchen_stations_delete_00372" ON public."kitchen_stations" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'system.manage_branches'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='kitchen_stations' and policyname='kitchen_stations_insert_00372' and qual is not distinct from NULL and with_check is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''system.manage_branches''::text) AND user_has_branch_access(auth.uid(), branch_id))') then
 raise exception 'POLICY_DRIFT: kitchen_stations.kitchen_stations_insert_00372'; end if;
end $guard$;
ALTER POLICY "kitchen_stations_insert_00372" ON public."kitchen_stations" WITH CHECK (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'system.manage_branches'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='kitchen_stations' and policyname='kitchen_stations_update_00372' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''system.manage_branches''::text) AND user_has_branch_access(auth.uid(), branch_id))' and with_check is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''system.manage_branches''::text) AND user_has_branch_access(auth.uid(), branch_id))') then
 raise exception 'POLICY_DRIFT: kitchen_stations.kitchen_stations_update_00372'; end if;
end $guard$;
ALTER POLICY "kitchen_stations_update_00372" ON public."kitchen_stations" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'system.manage_branches'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id))) WITH CHECK (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'system.manage_branches'::text) AND user_has_branch_access((SELECT auth.uid()), branch_id)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_audit_actors' and policyname='mkt_audit_actors_select' and qual is not distinct from '(EXISTS ( SELECT 1
   FROM mkt_audit_sandboxes s
  WHERE ((s.id = mkt_audit_actors.sandbox_id) AND (s.owner_tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''mkt.audit_runner''::text))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_audit_actors.mkt_audit_actors_select'; end if;
end $guard$;
ALTER POLICY "mkt_audit_actors_select" ON public."mkt_audit_actors" USING ((EXISTS ( SELECT 1
   FROM mkt_audit_sandboxes s
  WHERE ((s.id = mkt_audit_actors.sandbox_id) AND (s.owner_tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'mkt.audit_runner'::text)))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_audit_results' and policyname='mkt_audit_results_select' and qual is not distinct from '(EXISTS ( SELECT 1
   FROM mkt_audit_runs r
  WHERE ((r.id = mkt_audit_results.run_id) AND (r.owner_tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''mkt.audit_runner''::text))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_audit_results.mkt_audit_results_select'; end if;
end $guard$;
ALTER POLICY "mkt_audit_results_select" ON public."mkt_audit_results" USING ((EXISTS ( SELECT 1
   FROM mkt_audit_runs r
  WHERE ((r.id = mkt_audit_results.run_id) AND (r.owner_tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'mkt.audit_runner'::text)))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_audit_runs' and policyname='mkt_audit_runs_select' and qual is not distinct from '((owner_tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''mkt.audit_runner''::text))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_audit_runs.mkt_audit_runs_select'; end if;
end $guard$;
ALTER POLICY "mkt_audit_runs_select" ON public."mkt_audit_runs" USING (((owner_tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'mkt.audit_runner'::text)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_audit_sandboxes' and policyname='mkt_audit_sandboxes_select' and qual is not distinct from '((owner_tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''mkt.audit_runner''::text))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_audit_sandboxes.mkt_audit_sandboxes_select'; end if;
end $guard$;
ALTER POLICY "mkt_audit_sandboxes_select" ON public."mkt_audit_sandboxes" USING (((owner_tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'mkt.audit_runner'::text)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_campaign_plans' and policyname='mkt_campaign_plans_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''mkt.view''::text))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_campaign_plans.mkt_campaign_plans_select'; end if;
end $guard$;
ALTER POLICY "mkt_campaign_plans_select" ON public."mkt_campaign_plans" USING (((tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'mkt.view'::text)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_campaign_readiness_items' and policyname='mkt_readiness_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (( SELECT mkt_is_lead() AS mkt_is_lead) OR ( SELECT user_has_permission(auth.uid(), ''mkt.override_campaign''::text) AS user_has_permission) OR mkt_matches_readiness_role(required_role, required_branch_id)))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_campaign_readiness_items.mkt_readiness_select'; end if;
end $guard$;
ALTER POLICY "mkt_readiness_select" ON public."mkt_campaign_readiness_items" USING (((tenant_id = get_user_tenant_id()) AND (( SELECT mkt_is_lead() AS mkt_is_lead) OR ( SELECT user_has_permission((SELECT auth.uid()), 'mkt.override_campaign'::text) AS user_has_permission) OR mkt_matches_readiness_role(required_role, required_branch_id))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_campaigns' and policyname='mkt_campaigns_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (( SELECT mkt_is_lead() AS mkt_is_lead) OR (owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.campaign_id = mkt_campaigns.id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = auth.uid()) OR (t.reviewer_id = auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM mkt_campaign_readiness_items ri
  WHERE ((ri.campaign_id = mkt_campaigns.id) AND (ri.tenant_id = mkt_campaigns.tenant_id) AND (ri.deleted_at IS NULL) AND mkt_matches_readiness_role(ri.required_role, ri.required_branch_id))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_campaigns.mkt_campaigns_select'; end if;
end $guard$;
ALTER POLICY "mkt_campaigns_select" ON public."mkt_campaigns" USING (((tenant_id = get_user_tenant_id()) AND (( SELECT mkt_is_lead() AS mkt_is_lead) OR (owner_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.campaign_id = mkt_campaigns.id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = (SELECT auth.uid())) OR (t.reviewer_id = (SELECT auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM mkt_campaign_readiness_items ri
  WHERE ((ri.campaign_id = mkt_campaigns.id) AND (ri.tenant_id = mkt_campaigns.tenant_id) AND (ri.deleted_at IS NULL) AND mkt_matches_readiness_role(ri.required_role, ri.required_branch_id)))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_channel_work_packages' and policyname='mkt_work_packages_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (( SELECT mkt_is_lead() AS mkt_is_lead) OR ( SELECT user_has_permission(auth.uid(), ''mkt.split_work_packages''::text) AS user_has_permission) OR (owner_id = auth.uid()) OR (reviewer_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.work_package_id = mkt_channel_work_packages.id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = auth.uid()) OR (t.reviewer_id = auth.uid())))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_channel_work_packages.mkt_work_packages_select'; end if;
end $guard$;
ALTER POLICY "mkt_work_packages_select" ON public."mkt_channel_work_packages" USING (((tenant_id = get_user_tenant_id()) AND (( SELECT mkt_is_lead() AS mkt_is_lead) OR ( SELECT user_has_permission((SELECT auth.uid()), 'mkt.split_work_packages'::text) AS user_has_permission) OR (owner_id = (SELECT auth.uid())) OR (reviewer_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.work_package_id = mkt_channel_work_packages.id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = (SELECT auth.uid())) OR (t.reviewer_id = (SELECT auth.uid())))))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_content_items' and policyname='mkt_content_items_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (( SELECT mkt_can_review() AS mkt_can_review) OR (created_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.content_item_id = mkt_content_items.id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = auth.uid()) OR (t.reviewer_id = auth.uid())))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_content_items.mkt_content_items_select'; end if;
end $guard$;
ALTER POLICY "mkt_content_items_select" ON public."mkt_content_items" USING (((tenant_id = get_user_tenant_id()) AND (( SELECT mkt_can_review() AS mkt_can_review) OR (created_by = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.content_item_id = mkt_content_items.id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = (SELECT auth.uid())) OR (t.reviewer_id = (SELECT auth.uid())))))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_content_pillar_angles' and policyname='mkt_pillar_angles_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission(auth.uid(), ''mkt.view''::text) AS user_has_permission))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_content_pillar_angles.mkt_pillar_angles_select'; end if;
end $guard$;
ALTER POLICY "mkt_pillar_angles_select" ON public."mkt_content_pillar_angles" USING (((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission((SELECT auth.uid()), 'mkt.view'::text) AS user_has_permission)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_content_pillars' and policyname='mkt_pillars_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission(auth.uid(), ''mkt.view''::text) AS user_has_permission))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_content_pillars.mkt_pillars_select'; end if;
end $guard$;
ALTER POLICY "mkt_pillars_select" ON public."mkt_content_pillars" USING (((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission((SELECT auth.uid()), 'mkt.view'::text) AS user_has_permission)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_content_reviews' and policyname='mkt_content_reviews_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND ((reviewer_id = auth.uid()) OR ( SELECT mkt_can_review() AS mkt_can_review) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.content_item_id = mkt_content_reviews.content_item_id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = auth.uid()) OR (t.reviewer_id = auth.uid())))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_content_reviews.mkt_content_reviews_select'; end if;
end $guard$;
ALTER POLICY "mkt_content_reviews_select" ON public."mkt_content_reviews" USING (((tenant_id = get_user_tenant_id()) AND ((reviewer_id = (SELECT auth.uid())) OR ( SELECT mkt_can_review() AS mkt_can_review) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.content_item_id = mkt_content_reviews.content_item_id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = (SELECT auth.uid())) OR (t.reviewer_id = (SELECT auth.uid())))))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_content_versions' and policyname='mkt_content_versions_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND ((submitted_by = auth.uid()) OR ( SELECT mkt_can_review() AS mkt_can_review) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.content_item_id = mkt_content_versions.content_item_id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = auth.uid()) OR (t.reviewer_id = auth.uid())))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_content_versions.mkt_content_versions_select'; end if;
end $guard$;
ALTER POLICY "mkt_content_versions_select" ON public."mkt_content_versions" USING (((tenant_id = get_user_tenant_id()) AND ((submitted_by = (SELECT auth.uid())) OR ( SELECT mkt_can_review() AS mkt_can_review) OR (EXISTS ( SELECT 1
   FROM mkt_tasks t
  WHERE ((t.content_item_id = mkt_content_versions.content_item_id) AND (t.deleted_at IS NULL) AND ((t.assignee_id = (SELECT auth.uid())) OR (t.reviewer_id = (SELECT auth.uid())))))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_documents' and policyname='mkt_documents_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission(auth.uid(), ''mkt.view''::text) AS user_has_permission))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_documents.mkt_documents_select'; end if;
end $guard$;
ALTER POLICY "mkt_documents_select" ON public."mkt_documents" USING (((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission((SELECT auth.uid()), 'mkt.view'::text) AS user_has_permission)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_media_assets' and policyname='mkt_media_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission(auth.uid(), ''mkt.view''::text) AS user_has_permission))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_media_assets.mkt_media_select'; end if;
end $guard$;
ALTER POLICY "mkt_media_select" ON public."mkt_media_assets" USING (((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission((SELECT auth.uid()), 'mkt.view'::text) AS user_has_permission)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_outbox_events' and policyname='mkt_outbox_events_select_recipient' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (recipient_user_id = auth.uid()))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_outbox_events.mkt_outbox_events_select_recipient'; end if;
end $guard$;
ALTER POLICY "mkt_outbox_events_select_recipient" ON public."mkt_outbox_events" USING (((tenant_id = get_user_tenant_id()) AND (recipient_user_id = (SELECT auth.uid()))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_security_events' and policyname='mkt_security_events_select' and qual is not distinct from '(EXISTS ( SELECT 1
   FROM mkt_audit_sandboxes s
  WHERE ((s.sandbox_tenant_id = mkt_security_events.tenant_id) AND (s.owner_tenant_id = get_user_tenant_id()) AND user_has_permission(auth.uid(), ''mkt.audit_runner''::text))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_security_events.mkt_security_events_select'; end if;
end $guard$;
ALTER POLICY "mkt_security_events_select" ON public."mkt_security_events" USING ((EXISTS ( SELECT 1
   FROM mkt_audit_sandboxes s
  WHERE ((s.sandbox_tenant_id = mkt_security_events.tenant_id) AND (s.owner_tenant_id = get_user_tenant_id()) AND user_has_permission((SELECT auth.uid()), 'mkt.audit_runner'::text)))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_tasks' and policyname='mkt_tasks_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND ((assignee_id = auth.uid()) OR (reviewer_id = auth.uid()) OR ( SELECT mkt_is_lead() AS mkt_is_lead)))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_tasks.mkt_tasks_select'; end if;
end $guard$;
ALTER POLICY "mkt_tasks_select" ON public."mkt_tasks" USING (((tenant_id = get_user_tenant_id()) AND ((assignee_id = (SELECT auth.uid())) OR (reviewer_id = (SELECT auth.uid())) OR ( SELECT mkt_is_lead() AS mkt_is_lead))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_telegram_accounts' and policyname='mkt_telegram_accounts_select_own' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_telegram_accounts.mkt_telegram_accounts_select_own'; end if;
end $guard$;
ALTER POLICY "mkt_telegram_accounts_select_own" ON public."mkt_telegram_accounts" USING (((tenant_id = get_user_tenant_id()) AND (user_id = (SELECT auth.uid()))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_telegram_link_tokens' and policyname='mkt_telegram_link_tokens_select_own' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_telegram_link_tokens.mkt_telegram_link_tokens_select_own'; end if;
end $guard$;
ALTER POLICY "mkt_telegram_link_tokens_select_own" ON public."mkt_telegram_link_tokens" USING (((tenant_id = get_user_tenant_id()) AND (user_id = (SELECT auth.uid()))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='mkt_workflow_templates' and policyname='mkt_templates_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission(auth.uid(), ''mkt.view''::text) AS user_has_permission))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: mkt_workflow_templates.mkt_templates_select'; end if;
end $guard$;
ALTER POLICY "mkt_templates_select" ON public."mkt_workflow_templates" USING (((tenant_id = get_user_tenant_id()) AND ( SELECT user_has_permission((SELECT auth.uid()), 'mkt.view'::text) AS user_has_permission)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='money_accounts' and policyname='money_account_read' and qual is not distinct from '((tenant_id = ( SELECT p.tenant_id
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND COALESCE(p.is_active, true)))) AND user_has_branch_access(auth.uid(), branch_id) AND (user_has_permission(auth.uid(), ''finance.view_cash_book''::text) OR user_has_permission(auth.uid(), ''finance.create_transaction''::text)))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: money_accounts.money_account_read'; end if;
end $guard$;
ALTER POLICY "money_account_read" ON public."money_accounts" USING (((tenant_id = ( SELECT p.tenant_id
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND COALESCE(p.is_active, true)))) AND user_has_branch_access((SELECT auth.uid()), branch_id) AND (user_has_permission((SELECT auth.uid()), 'finance.view_cash_book'::text) OR user_has_permission((SELECT auth.uid()), 'finance.create_transaction'::text))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='notifications_delete_20261021' and qual is not distinct from '((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_active AND (p.tenant_id = notifications.tenant_id)))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: notifications.notifications_delete_20261021'; end if;
end $guard$;
ALTER POLICY "notifications_delete_20261021" ON public."notifications" USING (((user_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND p.is_active AND (p.tenant_id = notifications.tenant_id))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='notifications_select' and qual is not distinct from '((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_active AND (p.tenant_id = notifications.tenant_id)))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: notifications.notifications_select'; end if;
end $guard$;
ALTER POLICY "notifications_select" ON public."notifications" USING (((user_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND p.is_active AND (p.tenant_id = notifications.tenant_id))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='notifications_update' and qual is not distinct from '((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_active AND (p.tenant_id = notifications.tenant_id)))))' and with_check is not distinct from '((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_active AND (p.tenant_id = notifications.tenant_id)))))') then
 raise exception 'POLICY_DRIFT: notifications.notifications_update'; end if;
end $guard$;
ALTER POLICY "notifications_update" ON public."notifications" USING (((user_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND p.is_active AND (p.tenant_id = notifications.tenant_id)))))) WITH CHECK (((user_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND p.is_active AND (p.tenant_id = notifications.tenant_id))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='operational_uom_requests' and policyname='operational_uom_read' and qual is not distinct from '(user_has_permission(auth.uid(), ''inventory.view''::text) AND (_can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id) OR ((reference_type = ''transfer''::text) AND _can_read_branch_inventory_00476(auth.uid(), tenant_id, to_branch_id))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: operational_uom_requests.operational_uom_read'; end if;
end $guard$;
ALTER POLICY "operational_uom_read" ON public."operational_uom_requests" USING ((user_has_permission((SELECT auth.uid()), 'inventory.view'::text) AND (_can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, branch_id) OR ((reference_type = 'transfer'::text) AND _can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, to_branch_id)))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='party_advance_refunds' and policyname='party_advance_refund_read' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_branch_access(auth.uid(), branch_id) AND user_has_permission(auth.uid(), ''finance.view_cash_book''::text) AND user_has_permission(auth.uid(),
CASE mode
    WHEN ''customer''::text THEN ''customers.view_debt''::text
    ELSE ''suppliers.view_debt''::text
END))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: party_advance_refunds.party_advance_refund_read'; end if;
end $guard$;
ALTER POLICY "party_advance_refund_read" ON public."party_advance_refunds" USING (((tenant_id = get_user_tenant_id()) AND user_has_branch_access((SELECT auth.uid()), branch_id) AND user_has_permission((SELECT auth.uid()), 'finance.view_cash_book'::text) AND user_has_permission((SELECT auth.uid()),
CASE mode
    WHEN 'customer'::text THEN 'customers.view_debt'::text
    ELSE 'suppliers.view_debt'::text
END)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='product_lots' and policyname='product_lots_scope_00477' and qual is not distinct from '_can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id)' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: product_lots.product_lots_scope_00477'; end if;
end $guard$;
ALTER POLICY "product_lots_scope_00477" ON public."product_lots" USING (_can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, branch_id));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='product_platform_prices' and policyname='ppp_write_admin_only' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (user_has_permission(auth.uid(), ''products.manage_prices''::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ''owner''::text))))))' and with_check is not distinct from '((tenant_id = get_user_tenant_id()) AND (user_has_permission(auth.uid(), ''products.manage_prices''::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ''owner''::text))))))') then
 raise exception 'POLICY_DRIFT: product_platform_prices.ppp_write_admin_only'; end if;
end $guard$;
ALTER POLICY "ppp_write_admin_only" ON public."product_platform_prices" USING (((tenant_id = get_user_tenant_id()) AND (user_has_permission((SELECT auth.uid()), 'products.manage_prices'::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'owner'::text))))))) WITH CHECK (((tenant_id = get_user_tenant_id()) AND (user_has_permission((SELECT auth.uid()), 'products.manage_prices'::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'owner'::text)))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='production_orders' and policyname='production_orders_scope_00477' and qual is not distinct from '_can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id)' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: production_orders.production_orders_scope_00477'; end if;
end $guard$;
ALTER POLICY "production_orders_scope_00477" ON public."production_orders" USING (_can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, branch_id));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='production_used_adjustments' and policyname='production_used_adjustments_read' and qual is not distinct from '((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.tenant_id = production_used_adjustments.tenant_id) AND COALESCE(p.is_active, true)))) AND user_has_branch_access(auth.uid(), branch_id) AND user_has_permission(auth.uid(), ''production.view''::text))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: production_used_adjustments.production_used_adjustments_read'; end if;
end $guard$;
ALTER POLICY "production_used_adjustments_read" ON public."production_used_adjustments" USING (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.tenant_id = production_used_adjustments.tenant_id) AND COALESCE(p.is_active, true)))) AND user_has_branch_access((SELECT auth.uid()), branch_id) AND user_has_permission((SELECT auth.uid()), 'production.view'::text)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='foundation_profile_read' and qual is not distinct from '((id = auth.uid()) OR (tenant_id = get_user_tenant_id()))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: profiles.foundation_profile_read'; end if;
end $guard$;
ALTER POLICY "foundation_profile_read" ON public."profiles" USING (((id = (SELECT auth.uid())) OR (tenant_id = get_user_tenant_id())));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='foundation_profile_scope' and qual is not distinct from '((id = auth.uid()) OR ((tenant_id = get_user_tenant_id()) AND foundation_actor_active()))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: profiles.foundation_profile_scope'; end if;
end $guard$;
ALTER POLICY "foundation_profile_scope" ON public."profiles" USING (((id = (SELECT auth.uid())) OR ((tenant_id = get_user_tenant_id()) AND foundation_actor_active())));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_update_own' and qual is not distinct from '(id = auth.uid())' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: profiles.profiles_update_own'; end if;
end $guard$;
ALTER POLICY "profiles_update_own" ON public."profiles" USING ((id = (SELECT auth.uid())));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='promotions' and policyname='promotions_manage_delete_00458' and qual is not distinct from 'user_has_permission(auth.uid(), ''products.manage_prices''::text)' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: promotions.promotions_manage_delete_00458'; end if;
end $guard$;
ALTER POLICY "promotions_manage_delete_00458" ON public."promotions" USING (user_has_permission((SELECT auth.uid()), 'products.manage_prices'::text));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='promotions' and policyname='promotions_manage_insert_00458' and qual is not distinct from NULL and with_check is not distinct from 'user_has_permission(auth.uid(), ''products.manage_prices''::text)') then
 raise exception 'POLICY_DRIFT: promotions.promotions_manage_insert_00458'; end if;
end $guard$;
ALTER POLICY "promotions_manage_insert_00458" ON public."promotions" WITH CHECK (user_has_permission((SELECT auth.uid()), 'products.manage_prices'::text));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='promotions' and policyname='promotions_manage_update_00458' and qual is not distinct from 'user_has_permission(auth.uid(), ''products.manage_prices''::text)' and with_check is not distinct from 'user_has_permission(auth.uid(), ''products.manage_prices''::text)') then
 raise exception 'POLICY_DRIFT: promotions.promotions_manage_update_00458'; end if;
end $guard$;
ALTER POLICY "promotions_manage_update_00458" ON public."promotions" USING (user_has_permission((SELECT auth.uid()), 'products.manage_prices'::text)) WITH CHECK (user_has_permission((SELECT auth.uid()), 'products.manage_prices'::text));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='role_permissions' and policyname='role_permissions_delete_admin_only' and qual is not distinct from '((EXISTS ( SELECT 1
   FROM roles
  WHERE ((roles.id = role_permissions.role_id) AND (roles.tenant_id = get_user_tenant_id())))) AND (user_has_permission(auth.uid(), ''system.manage_roles''::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ''owner''::text))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: role_permissions.role_permissions_delete_admin_only'; end if;
end $guard$;
ALTER POLICY "role_permissions_delete_admin_only" ON public."role_permissions" USING (((EXISTS ( SELECT 1
   FROM roles
  WHERE ((roles.id = role_permissions.role_id) AND (roles.tenant_id = get_user_tenant_id())))) AND (user_has_permission((SELECT auth.uid()), 'system.manage_roles'::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'owner'::text)))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='role_permissions' and policyname='role_permissions_insert_admin_only' and qual is not distinct from NULL and with_check is not distinct from '((EXISTS ( SELECT 1
   FROM roles
  WHERE ((roles.id = role_permissions.role_id) AND (roles.tenant_id = get_user_tenant_id())))) AND (user_has_permission(auth.uid(), ''system.manage_roles''::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ''owner''::text))))))') then
 raise exception 'POLICY_DRIFT: role_permissions.role_permissions_insert_admin_only'; end if;
end $guard$;
ALTER POLICY "role_permissions_insert_admin_only" ON public."role_permissions" WITH CHECK (((EXISTS ( SELECT 1
   FROM roles
  WHERE ((roles.id = role_permissions.role_id) AND (roles.tenant_id = get_user_tenant_id())))) AND (user_has_permission((SELECT auth.uid()), 'system.manage_roles'::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'owner'::text)))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='role_permissions' and policyname='role_permissions_update_admin_only' and qual is not distinct from '((EXISTS ( SELECT 1
   FROM roles
  WHERE ((roles.id = role_permissions.role_id) AND (roles.tenant_id = get_user_tenant_id())))) AND (user_has_permission(auth.uid(), ''system.manage_roles''::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ''owner''::text))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: role_permissions.role_permissions_update_admin_only'; end if;
end $guard$;
ALTER POLICY "role_permissions_update_admin_only" ON public."role_permissions" USING (((EXISTS ( SELECT 1
   FROM roles
  WHERE ((roles.id = role_permissions.role_id) AND (roles.tenant_id = get_user_tenant_id())))) AND (user_has_permission((SELECT auth.uid()), 'system.manage_roles'::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'owner'::text)))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='roles' and policyname='roles_delete_admin_only' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (user_has_permission(auth.uid(), ''system.manage_roles''::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ''owner''::text))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: roles.roles_delete_admin_only'; end if;
end $guard$;
ALTER POLICY "roles_delete_admin_only" ON public."roles" USING (((tenant_id = get_user_tenant_id()) AND (user_has_permission((SELECT auth.uid()), 'system.manage_roles'::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'owner'::text)))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='roles' and policyname='roles_insert_admin_only' and qual is not distinct from NULL and with_check is not distinct from '((tenant_id = get_user_tenant_id()) AND (user_has_permission(auth.uid(), ''system.manage_roles''::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ''owner''::text))))))') then
 raise exception 'POLICY_DRIFT: roles.roles_insert_admin_only'; end if;
end $guard$;
ALTER POLICY "roles_insert_admin_only" ON public."roles" WITH CHECK (((tenant_id = get_user_tenant_id()) AND (user_has_permission((SELECT auth.uid()), 'system.manage_roles'::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'owner'::text)))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='roles' and policyname='roles_update_admin_only' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND (user_has_permission(auth.uid(), ''system.manage_roles''::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ''owner''::text))))))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: roles.roles_update_admin_only'; end if;
end $guard$;
ALTER POLICY "roles_update_admin_only" ON public."roles" USING (((tenant_id = get_user_tenant_id()) AND (user_has_permission((SELECT auth.uid()), 'system.manage_roles'::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'owner'::text)))))));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='stock_movements' and policyname='stock_movements_scope_00476' and qual is not distinct from '_can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id)' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: stock_movements.stock_movements_scope_00476'; end if;
end $guard$;
ALTER POLICY "stock_movements_scope_00476" ON public."stock_movements" USING (_can_read_branch_inventory_00476((SELECT auth.uid()), tenant_id, branch_id));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_advance_allocations' and policyname='supplier_advance_allocations_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_branch_access(auth.uid(), branch_id) AND user_has_permission(auth.uid(), ''suppliers.view_debt''::text))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: supplier_advance_allocations.supplier_advance_allocations_select'; end if;
end $guard$;
ALTER POLICY "supplier_advance_allocations_select" ON public."supplier_advance_allocations" USING (((tenant_id = get_user_tenant_id()) AND user_has_branch_access((SELECT auth.uid()), branch_id) AND user_has_permission((SELECT auth.uid()), 'suppliers.view_debt'::text)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_advances' and policyname='supplier_advances_select' and qual is not distinct from '((tenant_id = get_user_tenant_id()) AND user_has_branch_access(auth.uid(), branch_id) AND user_has_permission(auth.uid(), ''suppliers.view_debt''::text))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: supplier_advances.supplier_advances_select'; end if;
end $guard$;
ALTER POLICY "supplier_advances_select" ON public."supplier_advances" USING (((tenant_id = get_user_tenant_id()) AND user_has_branch_access((SELECT auth.uid()), branch_id) AND user_has_permission((SELECT auth.uid()), 'suppliers.view_debt'::text)));
do $guard$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='user_system_role_changes' and policyname='system_role_history_owner' and qual is not distinct from '(EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.tenant_id = user_system_role_changes.tenant_id) AND (p.role = ''owner''::text) AND p.is_active)))' and with_check is not distinct from NULL) then
 raise exception 'POLICY_DRIFT: user_system_role_changes.system_role_history_owner'; end if;
end $guard$;
ALTER POLICY "system_role_history_owner" ON public."user_system_role_changes" USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.tenant_id = user_system_role_changes.tenant_id) AND (p.role = 'owner'::text) AND p.is_active))));
commit;
