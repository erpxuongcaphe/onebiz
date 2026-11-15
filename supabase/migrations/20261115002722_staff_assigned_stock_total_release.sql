-- History marker recorded by the management API; the prior migration does the work.
do $$begin
 if not exists(select 1 from public.staff_branch_permission_catalog where permission_code='inventory.view_assigned_totals')
  or to_regprocedure('public._staff_assigned_stock_total_allowed(uuid)') is null then
  raise exception 'ASSIGNED_STOCK_TOTAL_RELEASE_INCOMPLETE';
 end if;
end$$;
