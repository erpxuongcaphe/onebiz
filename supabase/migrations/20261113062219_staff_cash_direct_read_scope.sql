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
 -- This marker is only a compatibility signal, never an authorization grant.
 -- A client predating branch exceptions could silently show partial totals.
 if exists(select 1 from public.user_branch_permission_overrides o
   where o.tenant_id=tenant and o.user_id=actor and o.permission_code='finance.view_cash_book')
  and coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-client-info','') <> 'onebiz-cash-scope/1' then
  raise exception 'Báo cáo đã cập nhật. Vui lòng tải lại trang để xem số liệu.' using errcode='P0001';
 end if;
 select coalesce(array_agg(b.id),'{}'::uuid[]) into result from public.branches b
 where b.tenant_id=tenant and public._staff_my_cash_book_view(b.id);
 -- A stale report-only client used to read this table directly. Silently
 -- returning no rows would turn its totals into misleading zeroes. Current
 -- reports use the scoped summary RPC; the old page already displays errors.
 if cardinality(result)=0 and (
  public._staff_permission_any_branch(actor,'reports.dashboard')
  or public._staff_permission_any_branch(actor,'reports.analytics')
 ) then
  raise exception 'Báo cáo đã cập nhật. Vui lòng tải lại trang để xem số liệu.' using errcode='P0001';
 end if;
 return result;
end $$;
revoke all on function public._staff_cash_direct_allowed_branches() from public,anon;
grant execute on function public._staff_cash_direct_allowed_branches() to authenticated;

create policy staff_cash_direct_read_scope on public.cash_transactions as restrictive
 for select to authenticated using (
  coalesce(branch_id=any((select public._staff_cash_direct_allowed_branches())::uuid[]),false)
 );
commit;
