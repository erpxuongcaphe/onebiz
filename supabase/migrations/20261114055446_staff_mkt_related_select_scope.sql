-- Scope campaign plan nodes, readiness and content history; retain direct assignments.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if to_regprocedure('public._staff_mkt_view_campaign(uuid)') is not null then raise exception 'MKT_VIEW_CAMPAIGN_HELPER_EXISTS';end if;end$$;
create function public._staff_mkt_view_campaign(p_campaign uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public._staff_mkt_campaign_permission(auth.uid(),'mkt.view',p_campaign),false)
$$;
revoke all on function public._staff_mkt_view_campaign(uuid) from public,anon;
grant execute on function public._staff_mkt_view_campaign(uuid) to authenticated;
do $$declare r record;expression text;patched text;begin
 for r in select * from (values
  ('public.mkt_campaign_plans','mkt_campaign_plans_select','dc5fff51118425e46b64856b5d949252','user_has_permission(( SELECT auth.uid() AS uid), ''mkt.view''::text)','public._staff_mkt_view_campaign(mkt_campaign_plans.campaign_id)'),
  ('public.mkt_campaign_readiness_items','mkt_readiness_select','783fe6d542f1da5f8c262d2389fef7dc','( SELECT mkt_is_lead() AS mkt_is_lead)','public._staff_mkt_read_campaign(mkt_campaign_readiness_items.campaign_id)'),
  ('public.mkt_content_reviews','mkt_content_reviews_select','8e3e4fb1711de14be805b2e0b2303583','( SELECT mkt_can_review() AS mkt_can_review)','public._staff_mkt_read_workflow(''content'',mkt_content_reviews.content_item_id)'),
  ('public.mkt_content_versions','mkt_content_versions_select','6022086cbba35ebca1944c4674e9657a','( SELECT mkt_can_review() AS mkt_can_review)','public._staff_mkt_read_workflow(''content'',mkt_content_versions.content_item_id)')
 ) as x(tbl,policy,expected_hash,old_expr,new_expr) loop
  select pg_get_expr(polqual,polrelid) into expression from pg_policy where polrelid=to_regclass(r.tbl) and polname=r.policy;
  if expression is null or md5(expression)<>r.expected_hash then raise exception 'MKT_RELATED_READ_BASELINE_CHANGED: %',r.policy;end if;
  patched:=replace(expression,r.old_expr,r.new_expr);
  if patched=expression then raise exception 'MKT_RELATED_READ_SCOPE_CHANGED: %',r.policy;end if;
  execute format('alter policy %I on %s using (%s)',r.policy,r.tbl,patched);
 end loop;
end$$;
commit;
