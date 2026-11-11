begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Preserve legacy void roles only when no granular branch exception exists.
-- An explicit local cancel denial must not be bypassed through the old alias.
create function public._staff_legacy_cancel_permission(p_user uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.user_has_permission(p_user,'pos_fnb.void') and not exists(
  select 1 from public.user_branch_permission_overrides o
  where o.user_id=p_user and o.branch_id=p_branch
   and o.permission_code='pos_fnb.cancel_unpaid_order')
$$;
revoke all on function public._staff_legacy_cancel_permission(uuid,uuid) from public,anon,authenticated;
do $patch$
declare item record; source text; patched text; target oid; n integer; scope text;
begin
 for item in select * from (values
  ('_fnb_cancel_unpaid_order_impl_00066','order'),
  ('fnb_execute_cancel_request_00455','r.branch_id'),
  ('fnb_request_cancel_00455','k.branch_id'),
  ('fnb_cancel_status_20261019','r.branch_id'),
  ('fnb_issue_cancel_otp_00455','r.branch_id'),
  ('fnb_reject_cancel_request_00462','request')
 ) as entries(name,branch_expression) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_CANCEL_CONSUMER_AMBIGUOUS: %',item.name;end if;
  scope:=case item.branch_expression
   when 'order' then '(select staff_cancel_scope.branch_id from public.kitchen_orders staff_cancel_scope where staff_cancel_scope.id=p_order_id and staff_cancel_scope.tenant_id=public.get_user_tenant_id())'
   when 'request' then '(select staff_cancel_scope.branch_id from public.fnb_cancel_requests staff_cancel_scope where staff_cancel_scope.id=p_request_id and staff_cancel_scope.tenant_id=public.get_user_tenant_id())'
   else item.branch_expression end;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''pos_fnb\.cancel_unpaid_order''\)',
   '_staff_permission_at_scope(\1,''pos_fnb.cancel_unpaid_order'','||scope||')','g');
  patched:=regexp_replace(patched,'user_has_permission\(([^,]+),\s*''pos_fnb\.void''\)',
   '_staff_legacy_cancel_permission(\1,'||scope||')','g');
  if patched=source then raise exception 'STAFF_CANCEL_CONSUMER_CHANGED: %',item.name;end if;
  execute patched;
 end loop;
 source:=pg_get_functiondef('public.fnb_pending_cancel_requests_00455()'::regprocedure);
 patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''pos_fnb\.cancel_unpaid_order''\)',
  '_staff_permission_any_branch(\1,''pos_fnb.cancel_unpaid_order'')','g');
 if patched=source or position('user_has_branch_access(a,r.branch_id)' in source)=0 then raise exception 'STAFF_CANCEL_LIST_CHANGED';end if;
 patched:=replace(patched,'user_has_branch_access(a,r.branch_id)',
  '(user_has_branch_access(a,r.branch_id) and public._staff_permission_at_scope(a,''pos_fnb.cancel_unpaid_order'',r.branch_id))');
 execute patched;
 source:=pg_get_functiondef('public.issue_manager_otp(text,jsonb,uuid,text,text)'::regprocedure);
 patched:=replace(source,'user_has_permission(a,_manager_approval_permission_00566(r.action_code))',
  '_staff_permission_at_scope(a,_manager_approval_permission_00566(r.action_code),r.branch_id)');
 if patched=source then raise exception 'STAFF_CANCEL_OTP_WRAPPER_CHANGED';end if;
 source:=patched;
 patched:=replace(source,'user_has_permission(a,''pos_fnb.cancel_unpaid_order'')',
  '_staff_permission_at_scope(a,''pos_fnb.cancel_unpaid_order'',c.branch_id)');
 if patched=source then raise exception 'STAFF_CANCEL_OTP_REQUEST_CHANGED';end if;execute patched;
 select count(*) into n from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='_issue_manager_otp_before_00566';
 if n<>2 then raise exception 'STAFF_CANCEL_OTP_LEGACY_AMBIGUOUS';end if;
 for target in select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='_issue_manager_otp_before_00566' loop
  source:=pg_get_functiondef(target);
  patched:=replace(source,'user_has_permission(v_actor, v_required_perm)',
   '_staff_permission_at_scope(v_actor,v_required_perm,coalesce(p_branch_id,v_profile.branch_id))');
  if patched=source then raise exception 'STAFF_CANCEL_OTP_LEGACY_CHANGED';end if;execute patched;
 end loop;
end $patch$;
insert into public.staff_branch_permission_catalog values('pos_fnb.cancel_unpaid_order',1);
commit;
