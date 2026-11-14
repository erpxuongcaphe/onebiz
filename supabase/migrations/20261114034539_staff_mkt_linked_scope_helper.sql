-- A task, asset or content item may reference a campaign indirectly. Require
-- every linked campaign to be in scope; never treat an indirect link as shared.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public._staff_mkt_campaign_permission(uuid,text,uuid)') is null
  or to_regprocedure('public._staff_mkt_linked_permission(uuid,text,uuid,uuid,uuid,uuid)') is not null then
  raise exception 'MKT_LINKED_SCOPE_BASELINE_CHANGED'; end if;
end$$;
create function public._staff_mkt_linked_permission(p_user uuid,p_code text,p_campaign uuid,p_package uuid,p_content uuid,p_plan uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare tenant uuid; linked uuid[];
begin
 select tenant_id into tenant from public.profiles where id=p_user and is_active;
 if tenant is null then return false;end if;
 if (p_campaign is not null and not exists(select 1 from public.mkt_campaigns where id=p_campaign and tenant_id=tenant))
  or (p_package is not null and not exists(select 1 from public.mkt_channel_work_packages where id=p_package and tenant_id=tenant))
  or (p_content is not null and not exists(select 1 from public.mkt_content_items where id=p_content and tenant_id=tenant))
  or (p_plan is not null and not exists(select 1 from public.mkt_channel_plans where id=p_plan and tenant_id=tenant)) then return false;end if;
 select coalesce(array_agg(distinct id) filter(where id is not null),'{}'::uuid[]) into linked from (
  select p_campaign id
  union select w.campaign_id from public.mkt_channel_work_packages w where w.id=p_package and w.tenant_id=tenant
  union select c.campaign_id from public.mkt_content_items c where c.id=p_content and c.tenant_id=tenant
  union select w.campaign_id from public.mkt_content_items c join public.mkt_channel_work_packages w on w.id=c.work_package_id and w.tenant_id=c.tenant_id where c.id=p_content and c.tenant_id=tenant
  union select cp.campaign_id from public.mkt_channel_plans cp where cp.id=p_plan and cp.tenant_id=tenant
 ) ids;
 if cardinality(linked)=0 then return coalesce(public.user_has_permission(p_user,p_code),false);end if;
 return not exists(select 1 from unnest(linked) id where not public._staff_mkt_campaign_permission(p_user,p_code,id));
end$$;
revoke all on function public._staff_mkt_linked_permission(uuid,text,uuid,uuid,uuid,uuid) from public,anon,authenticated;
commit;
