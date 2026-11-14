-- One bounded lookup for per-campaign controls on the planning screen.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if to_regprocedure('public.mkt_manageable_campaign_ids(uuid[])') is not null then raise exception 'MKT_MANAGEABLE_CAMPAIGNS_BASELINE_CHANGED';end if;end$$;
create function public.mkt_manageable_campaign_ids(p_campaign_ids uuid[])
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(c.id order by c.id),'{}'::uuid[])
 from public.mkt_campaigns c join public.profiles p on p.tenant_id=c.tenant_id
 where p.id=auth.uid() and p.is_active and c.deleted_at is null
  and cardinality(p_campaign_ids)<=500 and c.id=any(p_campaign_ids)
  and public._staff_mkt_campaign_permission(p.id,'mkt.manage_campaigns',c.id)
$$;
revoke all on function public.mkt_manageable_campaign_ids(uuid[]) from public,anon;
grant execute on function public.mkt_manageable_campaign_ids(uuid[]) to authenticated;
commit;
