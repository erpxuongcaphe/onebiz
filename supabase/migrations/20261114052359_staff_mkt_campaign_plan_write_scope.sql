-- Scope campaign plan writes to the locked campaign. Branch controls remain disabled.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text; patched text; sig text:='public.mkt_campaign_plan_upsert(uuid,uuid,text,text,uuid,date,date,uuid)';begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(sig) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='5010545a810c53cf5b95c3d46ff37972') then raise exception 'MKT_PLAN_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef(to_regprocedure(sig)),chr(13),'') into body;
 patched:=replace(body, '  if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;', '');
 if patched=body then raise exception 'MKT_PLAN_GATE_CHANGED';end if;
 body:=patched;
 patched:=replace(body,'select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null;', 'select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null for update;');
 if patched=body then raise exception 'MKT_PLAN_LOCK_CHANGED';end if;
 body:=patched;
 patched:=replace(body,'if not found or v_campaign.tenant_id <> v_tenant then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;', 'if not found or v_campaign.tenant_id <> v_tenant then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;' || chr(10) || '  if not public._staff_mkt_campaign_permission(v_actor,''mkt.manage_campaigns'',p_campaign_id) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');
 if patched=body then raise exception 'MKT_PLAN_SCOPE_CHANGED';end if;
 execute patched;
end$$;
commit;
