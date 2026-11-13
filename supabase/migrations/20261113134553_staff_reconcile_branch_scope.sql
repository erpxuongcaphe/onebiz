-- Reconciliation permission is scoped to each assigned branch. Cashiers keep
-- their existing independent ability to operate their own shift; the separate
-- company reconciliation permission remains unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; source text; patched text; pattern text;
begin
 for item in select * from (values
  ('public.close_shift_atomic(uuid,numeric,text)','v_shift.branch_id'),
  ('public.reconcile_pending_shift(uuid,numeric,text,text)','v_shift.branch_id'),
  ('public.get_shift_context_scoped(uuid)','v_shift.branch_id'),
  ('public.get_open_shift_status_scoped(uuid)','p_branch_id'),
  ('public.get_shift_records_scoped(text,uuid,integer,integer)',null),
  ('public.get_reconciled_shifts_scoped(uuid,timestamptz,timestamptz,text,integer,integer)',null)
 ) x(fn,branch_expr) loop
  source:=pg_get_functiondef(to_regprocedure(item.fn));
  pattern:='public\.user_has_permission\(v_actor,\s*''shifts\.reconcile_own_branch''\)';
  if source is null or source !~ pattern then raise exception 'STAFF_SHIFT_PERMISSION_CHANGED: %',item.fn;end if;
  if item.branch_expr is null then
   patched:=regexp_replace(source,pattern,'(case when p_branch_id is null then public._staff_permission_any_branch(v_actor,''shifts.reconcile_own_branch'') else public._staff_permission_at_scope(v_actor,''shifts.reconcile_own_branch'',p_branch_id) end)','g');
  else
   patched:=regexp_replace(source,pattern,format('public._staff_permission_at_scope(v_actor,''shifts.reconcile_own_branch'',%s)',item.branch_expr),'g');
  end if;
  if item.fn like 'public.get_shift_records_scoped%' then
   if position('and (v_reconcile or s.cashier_id=v_actor)' in patched)=0 then raise exception 'STAFF_SHIFT_RECORD_FILTER_CHANGED';end if;
   patched:=replace(patched,'and (v_reconcile or s.cashier_id=v_actor)',
    'and ((v_reconcile and (public.user_has_permission(v_actor,''shifts.reconcile_any'') or public._staff_permission_at_scope(v_actor,''shifts.reconcile_own_branch'',s.branch_id))) or (p_kind<>''pending'' and s.cashier_id=v_actor))');
  elsif item.fn like 'public.get_reconciled_shifts_scoped%' then
   if position('and public.can_read_branch_document_00567(s.tenant_id,s.branch_id)' in patched)=0 then raise exception 'STAFF_SHIFT_LIST_FILTER_CHANGED';end if;
   patched:=replace(patched,'and public.can_read_branch_document_00567(s.tenant_id,s.branch_id)',
    'and public.can_read_branch_document_00567(s.tenant_id,s.branch_id) and (public.user_has_permission(v_actor,''shifts.reconcile_any'') or public._staff_permission_at_scope(v_actor,''shifts.reconcile_own_branch'',s.branch_id))');
  end if;
  execute patched;
 end loop;
end
$migration$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('shifts.reconcile_own_branch',1);
commit;
