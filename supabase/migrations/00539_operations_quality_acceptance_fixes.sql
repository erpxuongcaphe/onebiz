-- Published originally as 00537; metadata is reconciled to 00539 only.
-- Never replay this migration on an environment where these fixes are installed.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Change mechanisms only. Existing observations, corrections and stock/finance
-- records are never rewritten. Abort rather than patch an unknown definition.
do $patch$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  definition := pg_get_functiondef('public.ops_quality_execute_core(text,jsonb,uuid)'::regprocedure);
  old_fragment := '   old_data:=to_jsonb(line);';
  new_fragment := $replacement$   old_data:=to_jsonb(line);
   if p_action='qc_correct' then
    select coalesce((select c.after_data from public.ops_q_corrections c
      where c.line_id=line.id order by c.created_at desc,c.id desc limit 1),old_data)
      into old_data;
   end if;$replacement$;
  if strpos(definition, old_fragment)=0 then raise exception 'Hub execute baseline changed; abort release'; end if;
  definition := replace(definition, old_fragment, new_fragment);
  old_fragment := '   nextstage:=issue.stage;';
  new_fragment := $replacement$   nextstage:=issue.stage;
   if p_payload ? 'departmentId' or p_payload ? 'operatorId' or p_payload ? 'collaborators' then
    if not (p_payload ?& array['departmentId','operatorId','collaborators'])
       or jsonb_typeof(p_payload->'collaborators') is distinct from 'array'
       then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
    if p_payload->>'departmentId' is not null and not exists(
      select 1 from public.ops_q_departments d where d.id=(p_payload->>'departmentId')::uuid
      and d.tenant_id=p.tenant_id and d.branch_id=b and d.active
    ) then raise exception 'OPS_FORBIDDEN'; end if;
    if exists(select 1 from jsonb_array_elements_text(p_payload->'collaborators') u
      where not exists(select 1 from public.profiles pr where pr.id=u::uuid
       and pr.tenant_id=p.tenant_id and pr.is_active
       and public.user_has_permission(pr.id,'ops.view') and public.user_has_permission(pr.id,'ops.work')))
       then raise exception 'OPS_FORBIDDEN'; end if;
    update public.ops_todos set collaborators=array(select distinct u from unnest(
      array(select jsonb_array_elements_text(p_payload->'collaborators')::uuid)
      ||coalesce((select d.members from public.ops_q_departments d where d.id=(p_payload->>'departmentId')::uuid),'{}'::uuid[])
    ) u) where id=t.id;
    if exists(select 1 from public.ops_todos td,unnest(td.collaborators) u
      where td.id=t.id and not exists(select 1 from public.profiles pr where pr.id=u
        and pr.tenant_id=p.tenant_id and pr.is_active
        and public.user_has_permission(pr.id,'ops.view') and public.user_has_permission(pr.id,'ops.work')))
      then raise exception 'OPS_FORBIDDEN'; end if;
    if p_payload->>'operatorId' is not null and not exists(
      select 1 from public.profiles pr join public.ops_todos td on td.id=t.id
      where pr.id=(p_payload->>'operatorId')::uuid and pr.tenant_id=p.tenant_id and pr.is_active
       and public.user_has_permission(pr.id,'ops.view') and public.user_has_permission(pr.id,'ops.work')
       and (pr.id=coalesce((p_payload->>'assigneeId')::uuid,t.assignee_id) or pr.id=any(td.collaborators))
    ) then raise exception 'OPS_FORBIDDEN'; end if;
    update public.ops_q_issues set department_id=(p_payload->>'departmentId')::uuid,
      operator_id=(p_payload->>'operatorId')::uuid where id=eid;
   end if;$replacement$;
  if strpos(definition, old_fragment)=0 then raise exception 'Hub assignment baseline changed; abort release'; end if;
  definition := replace(definition,old_fragment,new_fragment);
  old_fragment := '  eid:=a.id;';
  new_fragment := $replacement$  if p_payload ? 'catalogIds' then
   if jsonb_typeof(p_payload->'catalogIds') is distinct from 'array'
      or jsonb_array_length(p_payload->'catalogIds')=0 then raise exception 'OPS_Q_CATALOG_REQUIRED'; end if;
   if exists(select 1 from jsonb_array_elements_text(p_payload->'catalogIds') u
      where not exists(select 1 from public.ops_q_lines l where l.audit_id=a.id and l.item_id=u::uuid))
      then raise exception 'OPS_FORBIDDEN'; end if;
   delete from public.ops_q_lines l where l.audit_id=a.id
     and not exists(select 1 from jsonb_array_elements_text(p_payload->'catalogIds') u where u::uuid=l.item_id);
  end if;
  eid:=a.id;$replacement$;
  if strpos(definition, old_fragment)=0 then raise exception 'Hub QC scope baseline changed; abort release'; end if;
  definition := replace(definition,old_fragment,new_fragment);
  old_fragment := 'if p_action in (''issue'',''check'',''qc_line'',''issue_update'',''recheck'') then';
  new_fragment := 'if p_action in (''issue'',''check'',''qc_line'',''issue_update'',''recheck'',''issue_assign'') then';
  if strpos(definition, old_fragment)=0 then raise exception 'Hub notification baseline changed; abort release'; end if;
  definition := replace(definition, old_fragment, new_fragment);
  old_fragment := ' if p_action in (''issue'',''check'',''qc_line'',''issue_update'',''recheck'',''issue_assign'') then';
  new_fragment := $replacement$ if p_action='qc_complete' then
  insert into public.ops_notifications(tenant_id,branch_id,user_id,entity_id,title,due_at,kind,day)
  select a.tenant_id,b,member.user_id,a.id,'Đã hoàn tất QC: '||a.title,now(),'todo',
    (now() at time zone 'Asia/Ho_Chi_Minh')::date
  from public.ops_members member join public.profiles pr on pr.id=member.user_id
  where member.branch_id=b and member.tenant_id=p.tenant_id and member.member_role='manager'
    and member.active and pr.is_active
  on conflict(user_id,entity_id,kind,day) do update set title=excluded.title,created_at=now(),read_at=null;
 end if;
 if p_action in ('issue','check','qc_line','issue_update','recheck','issue_assign') then$replacement$;
  if strpos(definition, old_fragment)=0 then raise exception 'Hub event baseline changed; abort release'; end if;
  execute replace(definition,old_fragment,new_fragment);

  definition := pg_get_functiondef('public.ops_quality_read_core(uuid,text,text,jsonb)'::regprocedure);
  old_fragment := 'start_at is null and to_char(r.original_due_at at time zone ''Asia/Ho_Chi_Minh'',''YYYY-MM'')=p_period or start_at is not null and';
  if strpos(definition, old_fragment)=0 then raise exception 'Hub date filter baseline changed; abort release'; end if;
  definition := replace(definition,old_fragment,'start_at is null or start_at is not null and');
  old_fragment := 'or l.result=p_filters->>''result''';
  new_fragment := 'or coalesce((select c.after_data->>''result'' from public.ops_q_corrections c where c.line_id=l.id order by c.created_at desc,c.id desc limit 1),l.result)=p_filters->>''result''';
  if strpos(definition,old_fragment)=0 then raise exception 'Hub QC result baseline changed; abort release'; end if;
  definition := replace(definition,old_fragment,new_fragment);
  execute replace(definition,'to_jsonb(c) order by c.created_at desc','to_jsonb(c) order by c.created_at desc,c.id desc');

  definition := pg_get_functiondef('public.ops_quality_execute(text,jsonb,uuid)'::regprocedure);
  old_fragment := ' result:=public.ops_quality_execute_core(p_action,payload,p_request_id);';
  new_fragment := $replacement$ if p_action='catalog_import' and exists(
   select 1 from jsonb_array_elements(payload->'rows') x
   where jsonb_typeof(x->'accountingRequired') is distinct from 'boolean'
 ) then raise exception 'OPS_Q_ACCOUNTING_CHOICE_REQUIRED'; end if;
 result:=public.ops_quality_execute_core(p_action,payload,p_request_id);$replacement$;
  if strpos(definition, old_fragment)=0 then raise exception 'Hub accounting baseline changed; abort release'; end if;
  execute replace(definition,old_fragment,new_fragment);
end
$patch$;

-- CREATE OR REPLACE preserves the existing denied helper/public RPC ACLs.
notify pgrst, 'reload schema';
commit;
