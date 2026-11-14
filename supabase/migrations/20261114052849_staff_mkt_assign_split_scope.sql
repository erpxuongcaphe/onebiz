-- Check assignment and split permission against the package's locked campaign.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare r record;body text;patched text;begin
 for r in select * from (values
  ('public.mkt_assign_channel_planning(uuid,uuid,uuid,jsonb)','bec1e3a941647eaf872efb278370f1f1', 'if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;', 'v_wp', false),
  ('public.mkt_split_work_package(uuid,jsonb,text)','341bc2ecac871675af23d33336d79d03', 'if not (public.user_has_permission(v_actor, ''mkt.split_work_packages'') or public.user_has_permission(v_actor, ''mkt.manage_campaigns'')) then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;', 'v_package', true)
 ) as x(sig,expected_hash,gate,row_name,allow_split) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(r.sig) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=r.expected_hash) then raise exception 'MKT_ASSIGN_SPLIT_BASELINE_CHANGED: %',r.sig;end if;
  select replace(pg_get_functiondef(to_regprocedure(r.sig)),chr(13),'') into body;
  patched:=replace(body,r.gate,'');
  if patched=body then raise exception 'MKT_ASSIGN_SPLIT_GATE_CHANGED: %',r.sig;end if;
  body:=patched;
  patched:=replace(body,'if not found or ' || r.row_name || '.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;',
   'if not found or ' || r.row_name || '.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;' || chr(10) ||
   '  perform 1 from public.mkt_campaigns where id = ' || r.row_name || '.campaign_id for update;' || chr(10) ||
   '  if not (public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',null,' || r.row_name || '.id,null,null)' ||
   case when r.allow_split then ' or public._staff_mkt_linked_permission(v_actor,''mkt.split_work_packages'',null,' || r.row_name || '.id,null,null)' else '' end ||
   ') then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');
  if patched=body then raise exception 'MKT_ASSIGN_SPLIT_SCOPE_CHANGED: %',r.sig;end if;
  execute patched;
 end loop;
end$$;
commit;
