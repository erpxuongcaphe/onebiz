-- Only list branches where the signed-in user may create a campaign.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if to_regprocedure('public.mkt_campaign_create_branches()') is not null then raise exception 'MKT_CREATE_OPTIONS_BASELINE_CHANGED';end if;end$$;
create function public.mkt_campaign_create_branches()
returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select b.id,b.name from public.branches b join public.profiles p on p.tenant_id=b.tenant_id
 where p.id=auth.uid() and p.is_active and coalesce(b.is_active,true)
  and public.user_has_branch_access(p.id,b.id)
  and public._staff_permission_at_scope(p.id,'mkt.manage_campaigns',b.id)
 order by b.name,b.id
$$;
revoke all on function public.mkt_campaign_create_branches() from public,anon;
grant execute on function public.mkt_campaign_create_branches() to authenticated;
commit;
