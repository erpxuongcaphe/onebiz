-- Preserve existing authorization and lock order; check the already-locked row.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare source text; anchor text:='if v_order.status = ''cancelled'' then';
begin
 source:=pg_get_functiondef('public.cancel_legacy_sales_order_atomic(uuid,text)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1
    or position('for update' in lower(source))=0 then
  raise exception 'STAFF_LEGACY_ORDER_CANCEL_CHANGED';
 end if;
 execute replace(source,anchor,
  'if not public._staff_order_owner_unrestricted() and not coalesce(v_order.created_by=v_actor,false) and not coalesce(v_order.branch_id=any(public._staff_order_independent_branches()),false) then raise exception ''STAFF_OWN_ORDER_ACTION_DENIED'' using errcode=''42501''; end if; '||anchor);
end $patch$;
commit;
