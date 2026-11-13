-- Guard every direct REST read with the effective cash-book right for its branch.
-- Roll out only after aggregate readers and compatible web clients are live.
-- Older report clients read this table directly and would otherwise show partial data.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public._staff_cash_direct_allowed_branches()
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; result uuid[];
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,false);
 if tenant is null then return '{}'::uuid[]; end if;
 select coalesce(array_agg(b.id),'{}'::uuid[]) into result from public.branches b
 where b.tenant_id=tenant and public._staff_my_cash_book_view(b.id);
 return result;
end $$;
revoke all on function public._staff_cash_direct_allowed_branches() from public,anon;
grant execute on function public._staff_cash_direct_allowed_branches() to authenticated;

create policy staff_cash_direct_read_scope on public.cash_transactions as restrictive
 for select to authenticated using (
  coalesce(branch_id=any((select public._staff_cash_direct_allowed_branches())::uuid[]),false)
 );
commit;
