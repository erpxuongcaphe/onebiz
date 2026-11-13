-- Legacy OTPs do not have a linked approval request. When a manager has a
-- branch exception, recheck the issuing manager and the recorded OTP branch
-- before consuming the code. Keep other legacy actions and users unchanged.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $migration$
declare source text; anchor text := 'update public.manager_otp_codes'; required text;
begin
  source:=pg_get_functiondef('public._verify_and_use_manager_otp_before_00566(text,text,jsonb)'::regprocedure);
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
    raise exception 'STAFF_LEGACY_OTP_CONSUMER_CHANGED';
  end if;
  required:='(case p_action_code when ''fnb.cancel_unpaid_bill'' then ''pos_fnb.cancel_unpaid_order'' when ''fnb.cancel_unpaid_item'' then ''pos_fnb.cancel_unpaid_order'' when ''fnb.discount_override'' then ''pos_fnb.discount'' when ''fnb.void_paid_bill'' then ''pos_fnb.void_paid_bill'' when ''fnb.edit_sent_order'' then ''pos_fnb.edit_sent_order'' when ''pos_retail.discount_override'' then ''pos_retail.discount'' else null end)';
  source:=replace(source,anchor,format(
    'if exists(select 1 from public.user_branch_permission_overrides s where s.user_id=v_otp.issued_by and s.permission_code=%s) and (not coalesce(public._staff_permission_at_scope(v_otp.issued_by,%s,v_otp.branch_id),false) or not coalesce(public.user_has_branch_access(v_otp.issued_by,v_otp.branch_id),false)) then raise exception ''APPROVAL_APPROVER_SCOPE_DENIED'' using errcode=''42501''; end if; %s',required,required,anchor));
  execute source;
  if public._manager_approval_permission_00566('pos_retail.discount_override') is distinct from 'pos_retail.discount'
    or position('_staff_permission_at_scope' in pg_get_functiondef('public.issue_manager_approval_otp_00566(uuid)'::regprocedure))=0
    or position('_staff_permission_at_scope' in pg_get_functiondef('public.verify_otp_authorization(uuid,text,uuid,uuid)'::regprocedure))=0 then
    raise exception 'STAFF_RETAIL_DISCOUNT_APPROVAL_SCOPE_MISSING';
  end if;
end $migration$;
insert into public.staff_branch_permission_catalog values ('pos_retail.discount',1);
commit;
