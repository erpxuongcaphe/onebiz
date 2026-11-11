begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Re-check the persisted request branch at every approval stage. This also
-- handles rights revoked after issuance, without changing token/hash semantics.
do $patch$
declare item record; target oid; n integer; source text; patched text;
begin
 for item in select * from (values
 ('pending_manager_approvals_00566','a','r'),
 ('manager_approval_history_00566','a','r'),
 ('get_manager_approval_00566','a','r0'),
 ('reject_manager_approval_00566','a','r'),
 ('issue_manager_approval_otp_00566','a','r'),
 ('verify_and_use_manager_otp','o.issued_by','r'),
 ('verify_otp_authorization','o.issued_by','r')
 ) entries(name,actor,request_alias) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_APPROVAL_STAGE_AMBIGUOUS: %',item.name;end if;
  source:=pg_get_functiondef(target);
  patched:=replace(source,
   'user_has_permission('||item.actor||',_manager_approval_permission_00566('||item.request_alias||'.action_code))',
   '_staff_permission_at_scope('||item.actor||',_manager_approval_permission_00566('||item.request_alias||'.action_code),'||item.request_alias||'.branch_id)');
  if patched=source then raise exception 'STAFF_APPROVAL_STAGE_CHANGED: %',item.name;end if;
  execute patched;
 end loop;
end $patch$;
commit;
