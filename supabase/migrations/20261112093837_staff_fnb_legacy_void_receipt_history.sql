-- The cancellation preview uses the secured payment-history RPC. Preserve
-- the legacy F&B void alias only where no explicit paid-void denial exists.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare source text; anchor text:='public._staff_permission_at_scope(v_actor,''pos_fnb.void_paid_bill'',v_branch)';
begin
 source:=pg_get_functiondef('public.get_document_payment_history_scoped(text,uuid,integer,integer)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'STAFF_LEGACY_VOID_HISTORY_CHANGED';end if;
 execute replace(source,anchor,'('||anchor||' or public._staff_legacy_paid_void_permission(v_actor,v_branch))');
end $migration$;
commit;
