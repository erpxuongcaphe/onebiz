begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Keep legacy company readers unchanged until the owner configures an exception.
-- An all-company aggregate cannot include a branch explicitly denied for this code.
create function public._staff_report_permission(p_user uuid,p_code text,p_branch uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare tenant uuid;
begin
 select tenant_id into tenant from public.profiles where id=p_user and is_active;
 if tenant is null then return false; end if;
 if p_branch is null then
  return public.user_has_permission(p_user,p_code) and not exists(
   select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant
    and o.user_id=p_user and o.permission_code=p_code and o.override_type='revoke');
 end if;
 return public._staff_permission_at_scope(p_user,p_code,p_branch);
end $$;
revoke all on function public._staff_report_permission(uuid,text,uuid) from public,anon,authenticated;

do $patch$
declare item record; source text; patched text; target oid; count_targets integer;
begin
 source:=pg_get_functiondef('public.assert_report_access(text,uuid)'::regprocedure);
 patched:=regexp_replace(source,'user_has_permission\(v_actor,\s*p_permission_code\)',
  '_staff_report_permission(v_actor,p_permission_code,p_branch_id)','g');
 if patched=source then raise exception 'STAFF_REPORT_GUARD_CHANGED'; end if;
 execute patched;
 for item in select * from (values
  ('get_delivery_invoice_management_v1','p_branch_id'),
  ('get_operational_sales_dashboard','p_branch_id'),
  ('get_store_direct_bank_cash_links','null::uuid'),
  ('get_store_finance_reporting_source','p_branch'),
  ('get_company_cash_receipt_audit_v1','p_branch'),
  ('get_fnb_day_sales_summary','p_branch_id'),
  ('get_invoice_list_summary','p_branch_id'),
  ('get_invoice_list_summary_fnb_choices_20261023','p_branch_id'),
  ('get_invoice_list_summary_fnb_context_20261023','p_branch_id'),
  ('get_store_sales_day_collections','p_branch_id'),
  ('report_cogs_by_bom','p_branch_id')
 ) as entries(name,scope) loop
  select count(*),min(p.oid::bigint)::oid into count_targets,target from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if count_targets<>1 then raise exception 'STAFF_REPORT_CONSUMER_AMBIGUOUS: %',item.name;end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''(reports\.(dashboard|analytics|fnb|view_profit|view_detail|export|export_detail)|pos_fnb\.view_sales_summary)''\)',
   '_staff_report_permission(\1,''\2'','||item.scope||')','g');
  if item.name='get_operational_sales_dashboard' then
   if position('public.user_has_permission(actor,case when branch_kind=''store'' then ''pos_fnb.view_sales_summary'' else ''reports.dashboard'' end)' in source)=0
    or position('if p_from is null or' in source)=0 then raise exception 'STAFF_DASHBOARD_CONSUMER_CHANGED'; end if;
   patched:=replace(patched,
    'public.user_has_permission(actor,case when branch_kind=''store'' then ''pos_fnb.view_sales_summary'' else ''reports.dashboard'' end)',
    'public._staff_report_permission(actor,case when branch_kind=''store'' then ''pos_fnb.view_sales_summary'' else ''reports.dashboard'' end,p_branch_id)');
   -- The legacy store dashboard uses sales-summary permission. Preserve that
   -- path, but an explicit dashboard exception must not be ignored there.
   patched:=replace(patched,'if p_from is null or',
    'if exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant and o.user_id=actor and o.branch_id=p_branch_id and o.permission_code=''reports.dashboard'') and not public.user_has_permission_at_branch(actor,''reports.dashboard'',p_branch_id) then raise exception ''REPORT_PERMISSION_DENIED'' using errcode=''42501''; end if; if p_from is null or');
  end if;
  if patched=source then raise exception 'STAFF_REPORT_CONSUMER_CHANGED: %',item.name;end if;
  execute patched;
 end loop;
end $patch$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values
 ('reports.dashboard',1),('reports.analytics',1),('reports.fnb',1),
 ('reports.view_profit',1),('reports.view_detail',1),('reports.export',1),('reports.export_detail',1),('pos_fnb.view_sales_summary',1);
commit;
