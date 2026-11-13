-- Permit sales-summary staff to observe branch invalidations, without giving
-- them direct access to cash transactions. Existing dashboard policies remain.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_fnb_history_signal_access(p_tenant uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_branch is not null and exists(
  select 1 from public.profiles p where p.id=auth.uid() and coalesce(p.is_active,false)
   and p.tenant_id=p_tenant
   and public.user_has_permission_at_branch(p.id,'pos_fnb.view_sales_summary',p_branch)
 )
$$;
revoke all on function public._staff_fnb_history_signal_access(uuid,uuid) from public,anon;
grant execute on function public._staff_fnb_history_signal_access(uuid,uuid) to authenticated;
create policy staff_fnb_history_signal_read on public.dashboard_live_signals
 for select to authenticated using (public._staff_fnb_history_signal_access(tenant_id,branch_id));
commit;
