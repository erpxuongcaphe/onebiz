begin;
set local lock_timeout='3s';
-- Reuse the private bucket and upload-validation route. No bucket becomes public.
alter table public.ops_evidence drop constraint ops_evidence_entity_kind_check;
alter table public.ops_evidence add constraint ops_evidence_entity_kind_check check(entity_kind in ('run','todo','qc_line'));

create or replace function public.ops_evidence_reserve(p_kind text,p_entity uuid,p_name text,p_mime text,p_size bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; b uuid; e public.ops_evidence; allowed boolean:=false;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED'; end if;
 if not public.ops_has_permission('ops.view') then raise exception 'OPS_FORBIDDEN'; end if;
 if p_kind='run' then
  select r.branch_id,(public.ops_q_can(r.branch_id,'work') and (p.id=any(coalesce(x.manager_ids,array[r.assignee_id])))) or (r.assignee_id=p.id and public.ops_can(r.branch_id,'work')) or public.ops_can(r.branch_id,'verify') into b,allowed
  from public.ops_runs r left join public.ops_q_assignments x on x.branch_id=r.branch_id and x.tenant_id=r.tenant_id and x.family_id=r.family_id where r.id=p_entity and r.tenant_id=p.tenant_id;
 elsif p_kind='todo' then
  select t.branch_id,public.ops_todo_visible(t.id) and ((public.ops_q_can(t.branch_id,'work') and t.assignee_id=p.id) or (p.id=any(t.collaborators) and public.ops_has_permission('ops.work'))
   or (not exists(select 1 from public.ops_q_issues qi where qi.todo_id=t.id) and ((t.assignee_id=p.id and public.ops_can(t.branch_id,'work')) or p.id=any(t.collaborators) or public.ops_can(t.branch_id,'verify')))) into b,allowed from public.ops_todos t where t.id=p_entity and t.tenant_id=p.tenant_id;
 elsif p_kind='qc_line' then
  select l.branch_id,(public.ops_q_can(l.branch_id,'qc') and a.state='draft' and a.auditor_id=p.id) or public.ops_q_can(l.branch_id,'correct') into b,allowed from public.ops_q_lines l join public.ops_q_audits a on a.id=l.audit_id where l.id=p_entity and l.tenant_id=p.tenant_id;
 end if;
 if b is null or allowed is distinct from true then raise exception 'OPS_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_entity::text,3));
 if (select count(*) from public.ops_evidence where entity_id=p_entity and created_at>=now()-interval '1 day')>=50 then raise exception 'OPS_UPLOAD_LIMIT'; end if;
 if p_size not between 1 and 5242880 or p_mime not in ('image/jpeg','image/png','image/webp','application/pdf') or length(trim(p_name)) not between 1 and 160 then raise exception 'OPS_INVALID_FILE'; end if;
 e.id:=gen_random_uuid();
 insert into public.ops_evidence(id,tenant_id,branch_id,entity_id,entity_kind,path,file_name,mime_type,size_bytes,uploaded_by)
 values(e.id,p.tenant_id,b,p_entity,p_kind,p.tenant_id::text||'/'||e.id::text,p_name,p_mime,p_size,p.id) returning * into e;
 return to_jsonb(e);
end $$;
revoke all on function public.ops_evidence_reserve(text,uuid,text,text,bigint) from public,anon;
grant execute on function public.ops_evidence_reserve(text,uuid,text,text,bigint) to authenticated;
commit;
