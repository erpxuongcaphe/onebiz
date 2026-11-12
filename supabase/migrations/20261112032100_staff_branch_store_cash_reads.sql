begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare
  source text;
  patched text;
  permission_anchor constant text := 'public.user_has_permission(v_actor, ''finance.view_cash_book'')';
  row_anchor constant text := 'where p_mode in (''journal'', ''fund'') and h.tenant_id = v_tenant';
begin
  source := pg_get_functiondef('public.get_store_direct_bank_cash_links(uuid[],boolean)'::regprocedure);
  if position(permission_anchor in source) = 0 then
    raise exception 'STAFF_STORE_BANK_CASH_SCOPE_CHANGED';
  end if;
  -- This company-wide report requires a company-wide grant. A branch denial
  -- blocks the aggregate until its rows can be safely scoped.
  execute replace(source, permission_anchor,
    'public._staff_report_permission(v_actor,''finance.view_cash_book'',null::uuid)');

  source := pg_get_functiondef('public.get_store_finance_reporting_source(text,date,date,uuid,text,boolean)'::regprocedure);
  if position(permission_anchor in source) = 0 or position(row_anchor in source) = 0 then
    raise exception 'STAFF_STORE_FINANCE_CASH_SCOPE_CHANGED';
  end if;
  patched := replace(source, permission_anchor, 'public._staff_my_cash_book_view(p_branch)');
  patched := replace(patched, row_anchor,
    row_anchor || ' and (p_mode <> ''fund'' or public._staff_cash_row_visible(h.receiving_branch_id))');
  execute patched;
end
$migration$;

commit;
