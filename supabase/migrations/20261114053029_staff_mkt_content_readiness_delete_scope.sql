-- Scope deletion of individual content and readiness items; preserve workflow guards.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;gate text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_delete_content_item(uuid)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='cb5c69c36ceaf69e9a66b13afb8f218f') then raise exception 'MKT_CONTENT_DELETE_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_delete_content_item(uuid)'::regprocedure),chr(13),'') into body;
 gate:='  if not (' || chr(10) || '    public.user_has_permission(v_actor, ''mkt.manage_campaigns'')' || chr(10) || '    or public.user_has_permission(v_actor, ''mkt.split_work_packages'')' || chr(10) || '  ) then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;';
 patched:=replace(body,gate,'');if patched=body then raise exception 'MKT_CONTENT_DELETE_GATE_CHANGED';end if;body:=patched;
 patched:=replace(body,'  if v_content.content_status in (',
  '  perform 1 from public.mkt_channel_work_packages where id = (select work_package_id from public.mkt_content_items where id = p_content_id) for update;' || chr(10) ||
  '  perform 1 from public.mkt_campaigns where id in (select c.campaign_id from public.mkt_content_items c where c.id=p_content_id union select w.campaign_id from public.mkt_content_items c join public.mkt_channel_work_packages w on w.id=c.work_package_id and w.tenant_id=c.tenant_id where c.id=p_content_id) order by id for update;' || chr(10) ||
  '  if not (public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',null,null,p_content_id,null) or public._staff_mkt_linked_permission(v_actor,''mkt.split_work_packages'',null,null,p_content_id,null)) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  if v_content.content_status in (');
 if patched=body then raise exception 'MKT_CONTENT_DELETE_SCOPE_CHANGED';end if;execute patched;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_delete_readiness_item(uuid)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='bd931ac918272b792aebda6f1ecee25d') then raise exception 'MKT_READINESS_DELETE_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_delete_readiness_item(uuid)'::regprocedure),chr(13),'') into body;
 gate:='  if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;';
 patched:=replace(body,gate,'');if patched=body then raise exception 'MKT_READINESS_DELETE_GATE_CHANGED';end if;body:=patched;
 patched:=replace(body,'  update public.mkt_campaign_readiness_items',
  '  perform 1 from public.mkt_campaigns where id=v_item.campaign_id for update;' || chr(10) ||
  '  if not public._staff_mkt_campaign_permission(v_actor,''mkt.manage_campaigns'',v_item.campaign_id) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  update public.mkt_campaign_readiness_items');
 if patched=body then raise exception 'MKT_READINESS_DELETE_SCOPE_CHANGED';end if;execute patched;
end$$;
commit;
