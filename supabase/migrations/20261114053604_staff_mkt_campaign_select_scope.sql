-- Preserve assigned-user visibility while scoping campaign-manager visibility.
-- Preparation only: branch overrides for MKT remain disabled in the catalogue.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public._staff_mkt_read_campaign(uuid)') is not null or not exists (
  select 1 from pg_policy p where p.polrelid='public.mkt_campaigns'::regclass and p.polname='mkt_campaigns_select' and md5(pg_get_expr(p.polqual,p.polrelid))='02c21183d4edf52c7a0262a808f5bd33'
 ) then raise exception 'MKT_CAMPAIGN_READ_BASELINE_CHANGED';end if;
end$$;
create function public._staff_mkt_read_campaign(p_campaign uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and (
  public._staff_mkt_campaign_permission(auth.uid(),'mkt.manage_campaigns',p_campaign)
  or public.user_has_permission(auth.uid(),'mkt.manage_team')
 ),false)
$$;
revoke all on function public._staff_mkt_read_campaign(uuid) from public,anon;
grant execute on function public._staff_mkt_read_campaign(uuid) to authenticated;
do $$declare expression text;patched text;begin
 select pg_get_expr(polqual,polrelid) into expression from pg_policy where polrelid='public.mkt_campaigns'::regclass and polname='mkt_campaigns_select';
 patched:=replace(expression,'( SELECT mkt_is_lead() AS mkt_is_lead)','public._staff_mkt_read_campaign(mkt_campaigns.id)');
 if patched=expression then raise exception 'MKT_CAMPAIGN_READ_PATCH_CHANGED';end if;
 execute 'alter policy mkt_campaigns_select on public.mkt_campaigns using (' || patched || ')';
end$$;
commit;
