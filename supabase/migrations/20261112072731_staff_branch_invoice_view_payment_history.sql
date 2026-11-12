-- Payment history also admits independently authorised finance and POS paths.
-- Scope only the invoice-view alternative to the persisted document branch.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare source text; patched text; anchor text:='public.user_has_permission(v_actor,''invoices.view'')';
begin
 source:=pg_get_functiondef('public.get_document_payment_history_scoped(text,uuid,integer,integer)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'STAFF_INVOICE_PAYMENT_HISTORY_VIEW_CHANGED';end if;
 patched:=replace(source,anchor,'public._staff_permission_at_scope(v_actor,''invoices.view'',v_branch)');
 execute patched;
end $migration$;
commit;
