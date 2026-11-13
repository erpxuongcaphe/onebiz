-- A user without inventory.view (or with a global revoke) must not use the
-- legacy fast path to read balances for every branch. Preserve the historical
-- all-branch display only when the global grant is genuinely present and has
-- no branch exceptions; otherwise the existing per-branch guard applies.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare source text; anchor text := 'select exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant
  and o.user_id=actor and o.permission_code=''inventory.view'') into has_exception;';
begin
 source:=pg_get_functiondef('public.get_inventory_product_breakdown_scoped(uuid)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_STOCK_BREAKDOWN_VIEW_GUARD_CHANGED';end if;
 execute replace(source,anchor,'has_exception:=not coalesce(public._staff_stock_has_no_view_exception(),false);');
end $migration$;
-- POS and BOM stock projections have independent checkout permissions; a
 -- missing/revoked inventory-view grant must run those checks, not bypass all
 -- authorization. Trusted service-role BOM calls keep their existing early exit.
do $pos_guard$
declare source text; anchor text;
begin
 source:=pg_get_functiondef('public.get_pos_stock_snapshot_scoped(uuid,uuid[])'::regprocedure);
 anchor:='if has_exception then';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_POS_STOCK_VIEW_GUARD_CHANGED';end if;
 execute replace(source,anchor,'if not coalesce(public._staff_stock_has_no_view_exception(),false) then');
 source:=pg_get_functiondef('public._staff_bom_availability_guard(uuid,uuid)'::regprocedure);
 anchor:='if exception_exists then';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_BOM_STOCK_VIEW_GUARD_CHANGED';end if;
 execute replace(source,anchor,'if not coalesce(public._staff_stock_has_no_view_exception(),false) then');
end $pos_guard$;
commit;
