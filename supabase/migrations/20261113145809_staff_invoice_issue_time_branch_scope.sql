begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Only the optional manual invoice time is gated here. Ordinary checkout,
-- its existing branch checks, payment, inventory and printing stay unchanged.
do $patch$
declare item record; target oid; matches integer; source text; patched text;
begin
 for item in select * from (values
  ('complete_draft_atomic_v6','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=v_tenant and i.deleted_at is null)'),
  ('pos_complete_checkout_atomic_v4','p_branch_id')
 ) v(name,branch_expression) loop
  select count(*),min(p.oid::bigint)::oid into matches,target from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if matches<>1 then raise exception 'STAFF_INVOICE_TIME_READER_AMBIGUOUS: %',item.name; end if;
  source:=pg_get_functiondef(target);
  if (length(source)-length(replace(source,'public.user_has_permission(v_actor, ''invoices.adjust_issued_at'')',''))) /
     length('public.user_has_permission(v_actor, ''invoices.adjust_issued_at'')') <> 1 then
    raise exception 'STAFF_INVOICE_TIME_READER_CHANGED: %',item.name;
  end if;
  patched:=replace(source,'public.user_has_permission(v_actor, ''invoices.adjust_issued_at'')',
   'public._staff_permission_at_scope(v_actor, ''invoices.adjust_issued_at'', '||item.branch_expression||')');
  execute patched;
 end loop;
end $patch$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values ('invoices.adjust_issued_at',1);
commit;
