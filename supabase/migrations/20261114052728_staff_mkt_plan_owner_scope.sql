-- Keep assigned owners' existing access and scope manager access to all linked campaigns.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare r record; body text; patched text; gate text;begin
 gate:='v_plan.owner_id = v_actor or public.user_has_permission(v_actor, ''mkt.manage_campaigns'')';
 for r in select * from (values
  ('public.mkt_delete_plan_progress_report(uuid,text)','c6ab49e6471fe47c9e61f15401af7168'),
  ('public.mkt_open_plan_change_request(uuid,text)','1b24dd34f3c575ab6d3a0e9ebee01f0f'),
  ('public.mkt_save_plan_items(uuid,jsonb,jsonb,integer,jsonb)','5936ca79536ff3d08af726796efa4b88'),
  ('public.mkt_save_plan_strategy(uuid,text,numeric,jsonb,integer)','67e7961004c38565b78dfa68d8b4c70f'),
  ('public.mkt_submit_plan(uuid,integer)','4252dfe39f6c4cec2c7071324e6a1c84'),
  ('public.mkt_submit_plan_progress(uuid,text,text,text,text,jsonb)','2967b51251f31e21912531efb85f726b')
 ) as x(sig, expected_hash) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(r.sig) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=r.expected_hash) then raise exception 'MKT_PLAN_OWNER_BASELINE_CHANGED: %',r.sig;end if;
  select replace(pg_get_functiondef(to_regprocedure(r.sig)),chr(13),'') into body;
  patched:=replace(body,'  if not (' || gate || ')', '  perform 1 from public.mkt_channel_work_packages where id = v_plan.work_package_id for update;' || chr(10) || '  perform 1 from public.mkt_campaigns where id in (v_plan.campaign_id, (select campaign_id from public.mkt_channel_work_packages where id = v_plan.work_package_id)) order by id for update;' || chr(10) || '  if not (' || gate || ')');
  if patched=body then raise exception 'MKT_PLAN_OWNER_LOCK_CHANGED: %',r.sig;end if;
  body:=patched;
  patched:=replace(body,gate,'coalesce(v_plan.owner_id = v_actor, false) or public._staff_mkt_linked_permission(v_actor, ''mkt.manage_campaigns'', null, null, null, v_plan.id)');
  if patched=body then raise exception 'MKT_PLAN_OWNER_SCOPE_CHANGED: %',r.sig;end if;
  execute patched;
 end loop;
end$$;
commit;
