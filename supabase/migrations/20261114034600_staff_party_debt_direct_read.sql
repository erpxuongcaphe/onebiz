-- Protect direct reads by the caller's own debt permission at each branch.
-- Existing membership, independent cash-book and import permissions remain.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.staff_my_party_debt_view(uuid,text)') is not null then
  raise exception 'PARTY_DEBT_POLICY_HELPER_ALREADY_EXISTS';end if;
end$$;
create function public.staff_my_party_debt_view(p_branch uuid,p_mode text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_branch is not null and p_mode in ('customer','supplier')
   and exists(select 1 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
     where p.id=auth.uid() and coalesce(p.is_active,true) and b.id=p_branch)
   and coalesce(public.user_has_branch_access(auth.uid(),p_branch),false)
   and coalesce(public._staff_permission_at_scope(auth.uid(),case p_mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end,p_branch),false)
$$;
revoke all on function public.staff_my_party_debt_view(uuid,text) from public,anon;
grant execute on function public.staff_my_party_debt_view(uuid,text) to authenticated,service_role;
do $$
declare item record; oldqual text; newqual text; needle text; replacement text;
begin
 for item in select * from (values
  ('customer_advance_allocations','customer_advance_allocations_select','2140effe0eb5b760b7f285138144eeb7','customer'),
  ('customer_advances','customer_advances_select','2140effe0eb5b760b7f285138144eeb7','customer'),
  ('supplier_advance_allocations','supplier_advance_allocations_select','4ae5e48ae5b75866c1d0b402985cbfe4','supplier'),
  ('supplier_advances','supplier_advances_select','4ae5e48ae5b75866c1d0b402985cbfe4','supplier')
 ) x(tab,pol,hash,mode) loop
  select qual into oldqual from pg_policies where schemaname='public' and tablename=item.tab and policyname=item.pol and cmd='SELECT';
  if oldqual is null or md5(oldqual)<>item.hash then raise exception 'PARTY_DEBT_POLICY_BASELINE_CHANGED: %',item.pol;end if;
  needle:=format('user_has_permission(( SELECT auth.uid() AS uid), %L::text)',case item.mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end);
  replacement:=format('public.staff_my_party_debt_view(branch_id,%L)',item.mode);
  if position(needle in oldqual)=0 then raise exception 'PARTY_DEBT_POLICY_ANCHOR_CHANGED: %',item.pol;end if;
  newqual:=replace(oldqual,needle,replacement);
  execute format('alter policy %I on public.%I using (%s)',item.pol,item.tab,newqual);
 end loop;
 select qual into oldqual from pg_policies where schemaname='public' and tablename='party_advance_refunds' and policyname='party_advance_refund_read' and cmd='SELECT';
 if oldqual is null or md5(oldqual)<>'4e35d7ff470917f227d13a1c7ee43505' then raise exception 'PARTY_DEBT_REFUND_POLICY_CHANGED';end if;
 -- Replace the entire CASE permission expression while preserving the cash-book guard.
 needle:=substring(oldqual from 'user_has_permission\(\( SELECT auth.uid\(\) AS uid\),[\s\S]*END\)');
 if needle is null or position('suppliers.view_debt' in needle)=0 then raise exception 'PARTY_DEBT_REFUND_POLICY_ANCHOR_CHANGED';end if;
 newqual:=replace(oldqual,needle,'public.staff_my_party_debt_view(branch_id,mode)');
 execute format('alter policy %I on public.%I using (%s)','party_advance_refund_read','party_advance_refunds',newqual);
 select qual into oldqual from pg_policies where schemaname='public' and tablename='debt_opening_balances' and policyname='staff_debt_opening_permission_read' and cmd='SELECT' and permissive='RESTRICTIVE';
 if oldqual is null or md5(oldqual)<>'4f8acb810a984ed28cc29e7e2f98c273' then raise exception 'PARTY_DEBT_OPENING_POLICY_CHANGED';end if;
 newqual:=replace(oldqual,'( SELECT user_has_permission(( SELECT auth.uid() AS uid), ''customers.view_debt''::text) AS user_has_permission)','public.staff_my_party_debt_view(branch_id,''customer'')');
 newqual:=replace(newqual,'( SELECT user_has_permission(( SELECT auth.uid() AS uid), ''suppliers.view_debt''::text) AS user_has_permission)','public.staff_my_party_debt_view(branch_id,''supplier'')');
 if newqual=oldqual or position('customers.view_debt' in newqual)>0 or position('suppliers.view_debt' in newqual)>0 then raise exception 'PARTY_DEBT_OPENING_POLICY_ANCHOR_CHANGED';end if;
 execute format('alter policy %I on public.%I using (%s)','staff_debt_opening_permission_read','debt_opening_balances',newqual);
end$$;
commit;
