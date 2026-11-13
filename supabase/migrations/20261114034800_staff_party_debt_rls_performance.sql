-- Compute permitted branches once per statement rather than once per row.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.staff_my_party_debt_branches(text)') is not null then raise exception 'PARTY_DEBT_BRANCH_CACHE_EXISTS';end if;
end$$;
create function public.staff_my_party_debt_branches(p_mode text)
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(b.id order by b.id),'{}'::uuid[])
 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
 where p.id=auth.uid() and coalesce(p.is_active,true) and p_mode in ('customer','supplier')
   and public.user_has_branch_access(auth.uid(),b.id)
   and public._staff_permission_at_scope(auth.uid(),case p_mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end,b.id)
$$;
revoke all on function public.staff_my_party_debt_branches(text) from public,anon;
grant execute on function public.staff_my_party_debt_branches(text) to authenticated,service_role;
do $$
declare item record; q text; changed text; customer_expr text; supplier_expr text;
begin
 customer_expr:='(branch_id = any ((select public.staff_my_party_debt_branches(''customer''))::uuid[]))';
 supplier_expr:='(branch_id = any ((select public.staff_my_party_debt_branches(''supplier''))::uuid[]))';
 for item in select * from (values
  ('customer_advance_allocations','customer_advance_allocations_select','37a970c97c787d83c83d0f6c9b124d9b'),
  ('customer_advances','customer_advances_select','37a970c97c787d83c83d0f6c9b124d9b'),
  ('supplier_advance_allocations','supplier_advance_allocations_select','90bde5310398d698d65dc6944a1330d8'),
  ('supplier_advances','supplier_advances_select','90bde5310398d698d65dc6944a1330d8'),
  ('party_advance_refunds','party_advance_refund_read','a1d99ef9a9996bbe97e88ae6f9c034bd'),
  ('debt_opening_balances','staff_debt_opening_permission_read','bebdaffd53c28380ed50115f5203674b')
 ) x(tab,pol,hash) loop
  select qual into q from pg_policies where schemaname='public' and tablename=item.tab and policyname=item.pol and cmd='SELECT';
  if q is null or md5(q)<>item.hash then raise exception 'PARTY_DEBT_FAST_POLICY_BASELINE_CHANGED: %',item.pol;end if;
  changed:=replace(q,'staff_my_party_debt_view(branch_id, ''customer''::text)',customer_expr);
  changed:=replace(changed,'staff_my_party_debt_view(branch_id, ''supplier''::text)',supplier_expr);
  changed:=replace(changed,'staff_my_party_debt_view(branch_id, mode)',format('((mode=''customer'' and %s) or (mode=''supplier'' and %s))',customer_expr,supplier_expr));
  if changed=q or position('staff_my_party_debt_view' in changed)>0 then raise exception 'PARTY_DEBT_FAST_POLICY_ANCHOR_CHANGED: %',item.pol;end if;
  execute format('alter policy %I on public.%I using (%s)',item.pol,item.tab,changed);
 end loop;
end$$;
commit;
