-- Expose only the signed-in user's effective controls for one campaign.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if to_regprocedure('public.mkt_campaign_ui_permissions(uuid)') is not null then raise exception 'MKT_CAMPAIGN_UI_BASELINE_CHANGED';end if;end$$;
create function public.mkt_campaign_ui_permissions(p_campaign_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'canManage',coalesce(public._staff_mkt_campaign_permission(auth.uid(),'mkt.manage_campaigns',p_campaign_id),false),
  'canSplit',coalesce(public._staff_mkt_campaign_permission(auth.uid(),'mkt.split_work_packages',p_campaign_id),false)
   or coalesce(public._staff_mkt_campaign_permission(auth.uid(),'mkt.manage_campaigns',p_campaign_id),false)
 )
$$;
revoke all on function public.mkt_campaign_ui_permissions(uuid) from public,anon;
grant execute on function public.mkt_campaign_ui_permissions(uuid) to authenticated;
commit;
