-- Guard direct REST reads once an administrator has configured cash-book
-- branch exceptions. Existing users without exceptions keep their old access.
-- Cash-book branch editing stays disabled until the remaining readers are audited.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public._staff_cash_direct_allowed_branches()
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; result uuid[];
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,false);
 if tenant is null then return '{}'::uuid[]; end if;
 -- NULL is the legacy compatibility sentinel, not an unrestricted grant:
 -- all existing tenant and branch policies remain in force.
 if not exists(select 1 from public.user_branch_permission_overrides o
  where o.tenant_id=tenant and o.user_id=actor and o.permission_code='finance.view_cash_book') then return null; end if;
 select coalesce(array_agg(b.id),'{}'::uuid[]) into result from public.branches b
 where b.tenant_id=tenant and (
  public._staff_my_cash_book_view(b.id)
  or public._staff_permission_at_scope(actor,'reports.dashboard',b.id)
  -- Existing cash-flow summaries are built from direct rows for users with
  -- analytics access even without the separate report-detail permission.
  or public._staff_permission_at_scope(actor,'reports.analytics',b.id)
 );
 return result;
end $$;
revoke all on function public._staff_cash_direct_allowed_branches() from public,anon;
grant execute on function public._staff_cash_direct_allowed_branches() to authenticated;

create policy staff_cash_direct_read_scope on public.cash_transactions as restrictive
 for select to authenticated using (
  (select public._staff_cash_direct_allowed_branches()) is null
  or coalesce(branch_id=any((select public._staff_cash_direct_allowed_branches())::uuid[]),false)
 );
commit;
