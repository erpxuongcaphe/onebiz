-- Restrict plan actions without changing the existing owner exception.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare r record; body text; patched text; gate text;begin
 gate:='  if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;';
 for r in select * from (values
  ('public.mkt_campaign_plan_delete(uuid)','05909a31840958ac7295826c03bb1843','v_plan.campaign_id'),
  ('public.mkt_work_package_set_campaign_plan(uuid,uuid)','bf2b4287804fecd7ae47beff6aeca222','v_wp.campaign_id')
 ) as x(sig, expected_hash, campaign) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(r.sig) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=r.expected_hash) then raise exception 'MKT_PLAN_ACTION_BASELINE_CHANGED: %',r.sig;end if;
  select replace(pg_get_functiondef(to_regprocedure(r.sig)),chr(13),'') into body;
  patched:=replace(body,gate,'');
  if patched=body then raise exception 'MKT_PLAN_ACTION_GATE_CHANGED: %',r.sig;end if;
  body:=patched;
  patched:=replace(body, 'if not found then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;', 'if not found then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;' || chr(10) || '  perform 1 from public.mkt_campaigns where id = ' || r.campaign || ' for update;' || chr(10) || '  if not ' || case when r.campaign='v_wp.campaign_id' then 'public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',null,v_wp.id,null,null)' else 'public._staff_mkt_campaign_permission(v_actor,''mkt.manage_campaigns'',' || r.campaign || ')' end || ' then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');
  if patched=body then raise exception 'MKT_PLAN_ACTION_SCOPE_CHANGED: %',r.sig;end if;
  execute patched;
 end loop;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_owner_add_subplan(uuid,text,text)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='2aa79c9efcb838a945bf4ac96cd184d4') then raise exception 'MKT_SUBPLAN_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_owner_add_subplan(uuid,text,text)'::regprocedure),chr(13),'') into body;
 patched:=replace(body,'  -- Quyền: người ĐƯỢC GIAO mảng này (owner của nút) HOẶC Leader/người chia việc.', '  perform 1 from public.mkt_campaigns where id = v_node.campaign_id for update;' || chr(10) || '  -- Quyền: người ĐƯỢC GIAO mảng này (owner của nút) HOẶC Leader/người chia việc.');
 if patched=body then raise exception 'MKT_SUBPLAN_LOCK_CHANGED';end if;
 body:=patched;
 patched:=replace(replace(replace(body,'public.user_has_permission(v_actor, ''mkt.manage_campaigns'')','public._staff_mkt_campaign_permission(v_actor, ''mkt.manage_campaigns'', v_node.campaign_id)'),'public.user_has_permission(v_actor, ''mkt.split_work_packages'')','public._staff_mkt_campaign_permission(v_actor, ''mkt.split_work_packages'', v_node.campaign_id)'),'v_node.owner_id = v_actor','coalesce(v_node.owner_id = v_actor, false)');
 if patched=body then raise exception 'MKT_SUBPLAN_SCOPE_CHANGED';end if;
 execute patched;
end$$;
commit;
