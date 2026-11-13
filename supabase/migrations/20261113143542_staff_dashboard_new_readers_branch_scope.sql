begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- These readers were added after the original report-guard audit.  Preserve
-- their existing company-wide and membership checks while applying branch
-- exceptions to every report/debt permission that controls their results.
do $patch$
declare source text; patched text; pair record; replaced integer;
begin
 source:=pg_get_functiondef('public.get_sales_day_invoice_receivable(uuid,date)'::regprocedure);
 patched:=source;
 for pair in select * from (values
   ('customers.view_debt',1), ('reports.dashboard',1), ('pos_fnb.view_sales_summary',1)
 ) v(code, expected) loop
  replaced:=(length(patched)-length(replace(patched,format('public.user_has_permission(actor,%L)',pair.code),''))) /
            length(format('public.user_has_permission(actor,%L)',pair.code));
  if replaced<>pair.expected then raise exception 'STAFF_DASHBOARD_DEBT_READER_CHANGED: % (%)',pair.code,replaced; end if;
  patched:=replace(patched,format('public.user_has_permission(actor,%L)',pair.code),
    format('public._staff_report_permission(actor,%L,p_branch_id)',pair.code));
 end loop;
 if position('public.user_has_permission(actor,case when branch_kind=''store'' then ''pos_fnb.view_sales_summary'' else ''reports.dashboard'' end)' in patched)=0 then
  raise exception 'STAFF_DASHBOARD_DEBT_BRANCH_READER_CHANGED';
 end if;
 patched:=replace(patched,
  'public.user_has_permission(actor,case when branch_kind=''store'' then ''pos_fnb.view_sales_summary'' else ''reports.dashboard'' end)',
  'public._staff_report_permission(actor,case when branch_kind=''store'' then ''pos_fnb.view_sales_summary'' else ''reports.dashboard'' end,p_branch_id)');
 if position('select jsonb_build_object(' in patched)=0 then raise exception 'STAFF_DASHBOARD_DEBT_RESULT_CHANGED'; end if;
 patched:=replace(patched,'select jsonb_build_object(',
  'if p_branch_id is not null and exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant and o.user_id=actor and o.branch_id=p_branch_id and o.permission_code=''reports.dashboard'') and not public.user_has_permission_at_branch(actor,''reports.dashboard'',p_branch_id) then raise exception ''DASHBOARD_SALES_PERMISSION_DENIED'' using errcode=''42501''; end if; select jsonb_build_object(');
 execute patched;

 source:=pg_get_functiondef('public.get_dashboard_internal_sales(date)'::regprocedure);
 patched:=source;
 for pair in select * from (values ('reports.dashboard',1), ('pos_fnb.view_sales_summary',1)) v(code, expected) loop
  replaced:=(length(patched)-length(replace(patched,format('public.user_has_permission(actor, %L)',pair.code),''))) /
            length(format('public.user_has_permission(actor, %L)',pair.code));
  if replaced<>pair.expected then raise exception 'STAFF_DASHBOARD_INTERNAL_READER_CHANGED: % (%)',pair.code,replaced; end if;
  patched:=replace(patched,format('public.user_has_permission(actor, %L)',pair.code),
    format('public._staff_report_permission(actor,%L,null::uuid)',pair.code));
 end loop;
 execute patched;
end $patch$;
commit;
