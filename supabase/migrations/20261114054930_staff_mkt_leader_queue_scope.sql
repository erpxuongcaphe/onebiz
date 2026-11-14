-- The security-definer queue must filter each item, including indirect links.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;gate text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_get_leader_queue(uuid,integer,integer)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='84381d54a608368ad83ec578c6f7f403') then raise exception 'MKT_LEADER_QUEUE_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_get_leader_queue(uuid,integer,integer)'::regprocedure),chr(13),'') into body;
 gate:='if not (public.user_has_permission(v_actor, ''mkt.manage_team'') or public.user_has_permission(v_actor, ''mkt.manage_campaigns'')) then';
 patched:=replace(body,gate,'if not (public.user_has_permission(v_actor, ''mkt.manage_team'') or public.user_has_permission(v_actor, ''mkt.manage_campaigns'') or exists(select 1 from public.user_branch_permission_overrides o where o.user_id=v_actor and o.tenant_id=public.get_user_tenant_id() and o.permission_code=''mkt.manage_campaigns'' and o.override_type=''grant'' and public.user_has_permission_at_branch(v_actor,''mkt.manage_campaigns'',o.branch_id))) then');
 if patched=body then raise exception 'MKT_LEADER_QUEUE_GATE_CHANGED';end if;body:=patched;
 patched:=replace(body,'and (p_branch_id is null or q.branch_id = p_branch_id)', 'and (p_branch_id is null or q.branch_id = p_branch_id)' || chr(10) || '    and (public.user_has_permission(v_actor,''mkt.manage_team'') or public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',q.campaign_id,q.work_package_id,q.content_item_id,null))');
 if patched=body then raise exception 'MKT_LEADER_QUEUE_SCOPE_CHANGED';end if;execute patched;
end$$;
commit;
