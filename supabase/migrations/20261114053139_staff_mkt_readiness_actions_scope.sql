-- Scope readiness waiver and reminder to their campaign.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare r record;body text;patched text;begin
 for r in select * from (values
  ('public.mkt_waive_readiness_item(uuid,uuid,text)','528f506262fa7b8fcdf2680ac4853d30'),
  ('public.mkt_remind_readiness_item(uuid,uuid)','82ce051b6fc1bfd083c416995bd3f5c4')
 ) as x(sig,expected_hash) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(r.sig) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=r.expected_hash) then raise exception 'MKT_READINESS_ACTION_BASELINE_CHANGED: %',r.sig;end if;
  select replace(pg_get_functiondef(to_regprocedure(r.sig)),chr(13),'') into body;
  patched:=replace(body,'if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;','');
  if patched=body then patched:=replace(body,'if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;','');end if;
  if patched=body then raise exception 'MKT_READINESS_ACTION_GATE_CHANGED: %',r.sig;end if;body:=patched;
  patched:=replace(body,'if not found or v_item.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;',
   'if not found or v_item.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;' || chr(10) ||
   '  perform 1 from public.mkt_campaigns where id = p_campaign_id for update;' || chr(10) ||
   '  if not public._staff_mkt_campaign_permission(v_actor,''mkt.manage_campaigns'',p_campaign_id) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');
  if patched=body then patched:=replace(body,'if not found or v_item.tenant_id <> public.get_user_tenant_id() then' || chr(10) || '    raise exception ''NOT_FOUND'' using errcode = ''P0001'';' || chr(10) || '  end if;', 'if not found or v_item.tenant_id <> public.get_user_tenant_id() then' || chr(10) || '    raise exception ''NOT_FOUND'' using errcode = ''P0001'';' || chr(10) || '  end if;' || chr(10) || '  perform 1 from public.mkt_campaigns where id = p_campaign_id for update;' || chr(10) || '  if not public._staff_mkt_campaign_permission(v_actor,''mkt.manage_campaigns'',p_campaign_id) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');end if;
  if patched=body then raise exception 'MKT_READINESS_ACTION_SCOPE_CHANGED: %',r.sig;end if;execute patched;
 end loop;
end$$;
commit;
