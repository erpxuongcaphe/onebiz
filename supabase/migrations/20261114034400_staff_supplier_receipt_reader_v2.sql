-- Versioned supplier receipt report: all-branch totals include only branches
-- where all three independent report/purchase capabilities are permitted.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare source text; patched text; start_pos integer; end_pos integer;
 sig constant text:='public.get_supplier_receipt_workspace_v1(uuid,date,date,integer,integer,uuid,text,text,text,text,boolean)';
 begin_anchor constant text:=' perform public.assert_report_access(''reports.analytics'',p_branch_id);';
 validation_anchor constant text:=' if p_from is null or p_to is null';
 branch_check constant text:=' if exists(select 1 from public.stock_movements sm';
 source_anchor constant text:=' with source as materialized (';
begin
 if to_regprocedure(sig) is null or not exists(select 1 from pg_proc where oid=to_regprocedure(sig)
   and prosecdef and md5(replace(prosrc,chr(13),''))='f733eaee5fbfea2117e77fc6b8c01b89')
   or to_regprocedure('public._supplier_receipt_rows_v1(uuid,uuid,timestamptz,timestamptz)') is null then
  raise exception 'SUPPLIER_RECEIPT_V2_BASELINE_CHANGED';
 end if;
 if to_regprocedure('public.get_supplier_receipt_workspace_v2(uuid,date,date,integer,integer,uuid,text,text,text,text,boolean)') is not null then
  raise exception 'SUPPLIER_RECEIPT_V2_ALREADY_EXISTS';
 end if;
 source:=pg_get_functiondef(to_regprocedure(sig));
 if position('start_at timestamptz;end_at timestamptz;' in source)=0
   or position('public._supplier_receipt_rows_v1(t,p_branch_id,start_at,end_at) r' in source)=0
   or position('''basis'',''historical_goods_value_before_document_discount_tax_and_fees''' in source)=0 then
  raise exception 'SUPPLIER_RECEIPT_V2_ANCHOR_CHANGED';
 end if;
 patched:=replace(source,'public.get_supplier_receipt_workspace_v1(','public.get_supplier_receipt_workspace_v2(');
 patched:=replace(patched,'start_at timestamptz;end_at timestamptz;',
  'start_at timestamptz;end_at timestamptz;allowed_ids uuid[];scope_complete boolean;');
 start_pos:=position(begin_anchor in patched);end_pos:=position(validation_anchor in patched);
 if start_pos=0 or end_pos<=start_pos then raise exception 'SUPPLIER_RECEIPT_V2_AUTH_ANCHOR_CHANGED';end if;
 patched:=left(patched,start_pos-1)||$auth$
 if p_branch_id is not null then
  perform public.assert_report_access('reports.analytics',p_branch_id);
  perform public.assert_report_access('reports.view_detail',p_branch_id);
  perform public.assert_report_access('suppliers.view_purchases',p_branch_id);
  if not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=t)
    or not coalesce(public.user_has_branch_access(actor,p_branch_id),false) then
   raise exception 'SUPPLIER_RECEIPT_BRANCH_DENIED' using errcode='42501';end if;
  allowed_ids:=array[p_branch_id];scope_complete:=true;
 else
  if not coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false) then
   raise exception 'SUPPLIER_RECEIPT_ALL_BRANCHES_DENIED' using errcode='42501';end if;
  select coalesce(array_agg(b.id order by b.id),'{}'::uuid[]) into allowed_ids
   from public.branches b where b.tenant_id=t and public.user_has_branch_access(actor,b.id)
    and public._staff_permission_at_scope(actor,'reports.analytics',b.id)
    and public._staff_permission_at_scope(actor,'reports.view_detail',b.id)
    and public._staff_permission_at_scope(actor,'suppliers.view_purchases',b.id);
  if cardinality(allowed_ids)=0 then raise exception 'SUPPLIER_RECEIPT_DENIED' using errcode='42501';end if;
  scope_complete:=not exists(select 1 from public.branches b where b.tenant_id=t and not (b.id=any(allowed_ids)));
 end if;
 $auth$||substr(patched,end_pos);
 start_pos:=position(branch_check in patched);end_pos:=position(source_anchor in patched);
 if start_pos=0 or end_pos<=start_pos then raise exception 'SUPPLIER_RECEIPT_V2_SCOPE_ANCHOR_CHANGED';end if;
 patched:=left(patched,start_pos-1)||substr(patched,end_pos);
 patched:=replace(patched,'public._supplier_receipt_rows_v1(t,p_branch_id,start_at,end_at) r',
  'unnest(allowed_ids) permitted(branch_id) cross join lateral public._supplier_receipt_rows_v1(t,permitted.branch_id,start_at,end_at) r');
 patched:=replace(patched,'''basis'',''historical_goods_value_before_document_discount_tax_and_fees''',
  '''authorizedBranchIds'',to_jsonb(allowed_ids),''scopeComplete'',scope_complete,''basis'',''historical_goods_value_before_document_discount_tax_and_fees''');
 if position('''authorizedBranchIds'',to_jsonb(allowed_ids)' in patched)=0
   or position('public._supplier_receipt_rows_v1(t,p_branch_id,start_at,end_at) r' in patched)>0 then
  raise exception 'SUPPLIER_RECEIPT_V2_REWRITE_FAILED';end if;
 execute patched;
end$$;
revoke all on function public.get_supplier_receipt_workspace_v2(uuid,date,date,integer,integer,uuid,text,text,text,text,boolean) from public,anon;
grant execute on function public.get_supplier_receipt_workspace_v2(uuid,date,date,integer,integer,uuid,text,text,text,text,boolean) to authenticated,service_role;
commit;
