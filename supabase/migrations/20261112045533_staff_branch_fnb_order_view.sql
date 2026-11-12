-- Preserve the existing separate view prerequisite in the F&B payment chain,
-- but resolve it against the persisted order branch when an exception exists.
-- This does not activate branch-specific view permissions yet.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare source text; patched text;
begin
 source:=pg_get_functiondef('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'::regprocedure);
 patched:=regexp_replace(source,'user_has_permission\(v_actor,\s*''pos_fnb\.view_orders''\)',
   '_staff_permission_at_scope(v_actor,''pos_fnb.view_orders'',(select ko.branch_id from public.kitchen_orders ko where ko.id=p_kitchen_order_id and ko.tenant_id=public.get_user_tenant_id()))','g');
 if patched=source then raise exception 'STAFF_FNB_PAYMENT_VIEW_CONSUMER_CHANGED';end if;
 execute patched;
end $migration$;
commit;
