-- Return send belongs to the receiving shop; receipt and settlement belong to
-- the warehouse receiving the return. Existing tenant/membership checks and
-- the inventory-view prerequisite are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; source text; old text; replacement text; code text;
begin
 for item in select * from (values
  ('public.send_internal_stock_return(uuid,jsonb,text,uuid)',
   'not public.user_has_permission(a,''inventory.internal_return_send'')',
   'not public._staff_permission_any_branch(a,''inventory.internal_return_send'')',
   'not public.user_has_branch_access(a,s.to_branch_id)',
   '(not public.user_has_branch_access(a,s.to_branch_id) or not coalesce(public._staff_permission_at_scope(a,''inventory.internal_return_send'',s.to_branch_id),false))'),
  ('public.receive_internal_stock_return(uuid,jsonb,text,uuid)',
   'not user_has_permission(a,''inventory.internal_return_receive'')',
   'not public._staff_permission_any_branch(a,''inventory.internal_return_receive'')',
   'not user_has_branch_access(a,r.to_branch_id)',
   '(not user_has_branch_access(a,r.to_branch_id) or not coalesce(public._staff_permission_at_scope(a,''inventory.internal_return_receive'',r.to_branch_id),false))'),
  ('public.settle_internal_return_credit(uuid,text,numeric,uuid,text,uuid)',
   'not coalesce(user_has_permission(a,''inventory.internal_return_settle''),false)',
   'not coalesce(public._staff_permission_any_branch(a,''inventory.internal_return_settle''),false)',
   'not coalesce(user_has_branch_access(a,r.to_branch_id),false)',
   '(not coalesce(user_has_branch_access(a,r.to_branch_id),false) or not coalesce(public._staff_permission_at_scope(a,''inventory.internal_return_settle'',r.to_branch_id),false))')
 ) x(fn,old_auth,new_auth,old_scope,new_scope) loop
  if to_regprocedure(item.fn) is null then raise exception 'STAFF_RETURN_FUNCTION_MISSING: %',item.fn;end if;
  source:=pg_get_functiondef(to_regprocedure(item.fn));
  if position(item.old_auth in source)=0 or position(item.old_scope in source)=0 then
   raise exception 'STAFF_RETURN_FUNCTION_CHANGED: %',item.fn;
  end if;
  execute replace(replace(source,item.old_auth,item.new_auth),item.old_scope,item.new_scope);
 end loop;
 source:=pg_get_functiondef('public.get_internal_return_finance(uuid)'::regprocedure);
 old:='user_has_permission(a,''inventory.internal_return_settle'')';
 if position(old in source)=0 then raise exception 'STAFF_RETURN_FINANCE_CHANGED';end if;
 execute replace(source,old,'public._staff_permission_at_scope(a,''inventory.internal_return_settle'',r.to_branch_id)');
 source:=pg_get_functiondef('public.get_internal_stock_returns(uuid,uuid)'::regprocedure);
 foreach code in array array['inventory.internal_return_view','inventory.internal_return_send','inventory.internal_return_receive'] loop
  old:=format('public.user_has_permission(actor,%L)',code);
  replacement:=format('public._staff_permission_at_scope(actor,%L,p_branch_id)',code);
  if position(old in source)=0 then raise exception 'STAFF_RETURN_LIST_CHANGED: %',code;end if;
  source:=replace(source,old,replacement);
 end loop;
 execute source;
end
$migration$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values
 ('inventory.internal_return_view',1),('inventory.internal_return_send',1),
 ('inventory.internal_return_receive',1),('inventory.internal_return_settle',1);
commit;
