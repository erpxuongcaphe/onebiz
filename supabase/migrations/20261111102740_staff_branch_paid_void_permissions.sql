begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_legacy_paid_void_permission(p_user uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.user_has_permission(p_user,'pos_fnb.void') and not exists(
  select 1 from public.user_permission_overrides o where o.user_id=p_user
   and o.permission_code='pos_fnb.void_paid_bill' and o.override_type='revoke') and not exists(
  select 1 from public.user_branch_permission_overrides o where o.user_id=p_user
   and o.branch_id=p_branch and o.permission_code='pos_fnb.void_paid_bill')
$$;
revoke all on function public._staff_legacy_paid_void_permission(uuid,uuid) from public,anon,authenticated;
do $patch$
declare item record; target oid; n integer; source text; patched text; scope text;
begin
 for item in select * from (values
  ('_fnb_void_invoice_impl_00165','invoice'),
  ('_void_completed_invoice_atomic_v2_impl_00250','v_invoice.branch_id'),
  ('get_document_payment_history_scoped','v_branch')
 ) as entries(name,branch_expression) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_PAID_VOID_CONSUMER_AMBIGUOUS: %',item.name;end if;
  scope:=case when item.branch_expression='invoice' then
   '(select staff_void_scope.branch_id from public.invoices staff_void_scope where staff_void_scope.id=p_invoice_id and staff_void_scope.tenant_id=public.get_user_tenant_id())'
   else item.branch_expression end;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''pos_fnb\.void_paid_bill''\)',
   '_staff_permission_at_scope(\1,''pos_fnb.void_paid_bill'','||scope||')','g');
  patched:=regexp_replace(patched,'user_has_permission\(([^,]+),\s*''pos_fnb\.void''\)',
   '_staff_legacy_paid_void_permission(\1,'||scope||')','g');
  if patched=source then raise exception 'STAFF_PAID_VOID_CONSUMER_CHANGED: %',item.name;end if;execute patched;
 end loop;
 source:=pg_get_functiondef('public.get_my_auth_bootstrap()'::regprocedure);
 patched:=replace(source,'o.permission_code=''pos_fnb.cancel_unpaid_order'' and o.override_type=''revoke''',
  'o.permission_code in (''pos_fnb.cancel_unpaid_order'',''pos_fnb.void_paid_bill'') and o.override_type=''revoke''');
 if patched=source then raise exception 'STAFF_PAID_VOID_BOOTSTRAP_CHANGED';end if;execute patched;
end $patch$;
insert into public.staff_branch_permission_catalog values('pos_fnb.void_paid_bill',1);
commit;
