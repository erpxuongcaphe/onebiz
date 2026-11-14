-- Check both campaign and work-package scopes before creating content.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;sig text:='public.mkt_create_content_item(uuid,uuid,text,text,text,uuid)';gate text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(sig) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='a48aec8c39c863f366311b53dcf8d357') then raise exception 'MKT_CREATE_CONTENT_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef(to_regprocedure(sig)),chr(13),'') into body;
 gate:='if not (public.user_has_permission(v_actor, ''mkt.manage_campaigns'') or public.user_has_permission(v_actor, ''mkt.split_work_packages'')) then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;';
 patched:=replace(body,gate,'');
 if patched=body then raise exception 'MKT_CREATE_CONTENT_GATE_CHANGED';end if;
 body:=patched;
 patched:=replace(body,'select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null;', 'select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null for update;');
 if patched=body then raise exception 'MKT_CREATE_CONTENT_LOCK_CHANGED';end if;
 body:=patched;
 patched:=replace(body,'if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;',
  'if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  if p_work_package_id is not null then perform 1 from public.mkt_channel_work_packages where id=p_work_package_id and tenant_id=v_campaign.tenant_id for share; if not found then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if; end if;' || chr(10) ||
  '  if not (public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',p_campaign_id,p_work_package_id,null,null) or public._staff_mkt_linked_permission(v_actor,''mkt.split_work_packages'',p_campaign_id,p_work_package_id,null,null)) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');
 if patched=body then raise exception 'MKT_CREATE_CONTENT_SCOPE_CHANGED';end if;
 execute patched;
end$$;
commit;
