begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public._staff_cash_row_visible(p_branch uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.user_branch_permission_overrides
    where user_id=auth.uid() and permission_code='finance.view_cash_book'
  ) or (p_branch is not null and public._staff_my_cash_book_view(p_branch))
$$;
revoke all on function public._staff_cash_row_visible(uuid) from public, anon, authenticated;

do $migration$
declare
  source text;
  patched text;
  anchor text;
begin
  source := pg_get_functiondef('public.get_document_payment_history_scoped(text,uuid,integer,integer)'::regprocedure);
  anchor := 'public.user_has_permission(v_actor,''finance.view_cash_book'')';
  if position(anchor in source) = 0 then
    raise exception 'STAFF_PAYMENT_HISTORY_CASH_SCOPE_CHANGED';
  end if;
  -- Other existing paths (invoice, POS, supplier) keep their own rules.
  execute replace(source, anchor, 'public._staff_my_cash_book_view(v_branch)');

  source := pg_get_functiondef('public.get_cod_settlement_trace_v1(uuid)'::regprocedure);
  anchor := 'public.user_has_permission(actor,''finance.view_cash_book'')';
  if position(anchor in source) = 0
    or position('if not found or branch is null' in source) = 0
    or position('not coalesce(public.user_has_branch_access(actor,i.branch_id),false)' in source) = 0 then
    raise exception 'STAFF_COD_TRACE_SCOPE_CHANGED';
  end if;
  patched := replace(source, anchor, 'public._staff_my_cash_book_view(null::uuid)');
  patched := replace(patched, 'if not found or branch is null',
    'if not found or branch is null or not public._staff_my_cash_book_view(branch)');
  patched := replace(patched,
    'not coalesce(public.user_has_branch_access(actor,i.branch_id),false)',
    '(not public._staff_my_cash_book_view(i.branch_id) or not coalesce(public.user_has_branch_access(actor,i.branch_id),false))');
  execute patched;

  source := pg_get_functiondef('public.get_cod_settlement_workspace_v1(uuid,date,date,integer,integer,text,text,boolean,boolean)'::regprocedure);
  anchor := 'public.user_has_permission(actor,''finance.view_cash_book'')';
  if position(anchor in source) = 0
    or position('where h.tenant_id=t and (p_branch_id is null or h.branch_id=p_branch_id)' in source) = 0
    or position('where p_search is null or btrim(p_search)=''''' in source) = 0
    or position('not coalesce(public.user_has_branch_access(actor,i.branch_id),false)' in source) = 0 then
    raise exception 'STAFF_COD_WORKSPACE_SCOPE_CHANGED';
  end if;
  patched := replace(source, anchor, 'public._staff_my_cash_book_view(p_branch_id)');
  -- Preflight applies only to visible settlements. Any mixed-branch settlement
  -- with an unauthorized invoice is rejected before exposing shipment details.
  patched := replace(patched,
    'where h.tenant_id=t and (p_branch_id is null or h.branch_id=p_branch_id)',
    'where h.tenant_id=t and public._staff_cash_row_visible(h.branch_id) and (p_branch_id is null or h.branch_id=p_branch_id)');
  patched := replace(patched,
    'not coalesce(public.user_has_branch_access(actor,i.branch_id),false)',
    '(not public._staff_my_cash_book_view(i.branch_id) or not coalesce(public.user_has_branch_access(actor,i.branch_id),false))');
  patched := replace(patched, 'where p_search is null or btrim(p_search)=''''',
    'where public._staff_cash_row_visible(nullif(r->>''branchId'','''')::uuid) and (p_search is null or btrim(p_search)=''''');
  -- Close the search predicate before the source CTE.
  anchor := 'lower(btrim(p_search)))>0';
  if position(anchor in patched) = 0 then
    raise exception 'STAFF_COD_SEARCH_SCOPE_CHANGED';
  end if;
  patched := replace(patched, anchor, 'lower(btrim(p_search)))>0)');
  execute patched;
end
$migration$;

commit;
