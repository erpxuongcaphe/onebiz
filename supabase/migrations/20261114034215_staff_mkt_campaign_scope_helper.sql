-- Preparation only. This private resolver does not expose MKT permissions in
-- the branch catalogue and does not alter any policy or existing campaign.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regclass('public.mkt_campaigns') is null
  or to_regprocedure('public._staff_permission_at_scope(uuid,text,uuid)') is null
  or to_regprocedure('public._staff_mkt_campaign_permission(uuid,text,uuid)') is not null then
  raise exception 'MKT_SCOPE_BASELINE_CHANGED';end if;
end$$;
create function public._staff_mkt_campaign_permission(p_user uuid,p_code text,p_campaign uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.mkt_campaigns c on c.tenant_id=p.tenant_id
  where p.id=p_user and p.is_active and c.id=p_campaign and
   case when c.branch_id is null then public.user_has_permission(p.id,p_code)
        else public._staff_permission_at_scope(p.id,p_code,c.branch_id) end);
$$;
revoke all on function public._staff_mkt_campaign_permission(uuid,text,uuid) from public,anon,authenticated;
commit;
