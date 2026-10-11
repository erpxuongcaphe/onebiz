begin;
-- New private storage only. No existing ERP, stock or finance rows are changed.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('operations-evidence','operations-evidence',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='operations-evidence' and public) then raise exception 'OPS_BUCKET_CONFIG_CONFLICT'; end if;
end $$;

create table public.ops_evidence (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id), entity_id uuid not null,
 entity_kind text not null check(entity_kind in ('run','todo')),
 path text not null unique, file_name text not null, mime_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 5242880),
 uploaded_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','ready'))
);
create index ops_evidence_entity on public.ops_evidence(tenant_id,entity_id,created_at desc);
alter table public.ops_evidence enable row level security;
revoke all on public.ops_evidence from public,anon,authenticated;

create function public.ops_evidence_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ops_evidence e join public.profiles p on p.id=auth.uid() and p.is_active and p.tenant_id=e.tenant_id
 where e.id=p_id and (public.ops_can(e.branch_id,'view') or (e.entity_kind='todo' and public.ops_todo_visible(e.entity_id))));
$$;
revoke all on function public.ops_evidence_visible(uuid) from public,anon;
grant execute on function public.ops_evidence_visible(uuid) to authenticated;

create function public.ops_evidence_reserve(p_kind text,p_entity uuid,p_name text,p_mime text,p_size bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; b uuid; e public.ops_evidence; allowed boolean:=false; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED'; end if;
 if not public.ops_has_permission('ops.view') then raise exception 'OPS_FORBIDDEN'; end if;
 if p_kind='run' then
  select branch_id,(assignee_id=p.id and public.ops_can(branch_id,'work')) or public.ops_can(branch_id,'verify') into b,allowed
   from public.ops_runs where id=p_entity and tenant_id=p.tenant_id;
 elsif p_kind='todo' then
  select branch_id,(assignee_id=p.id and public.ops_can(branch_id,'work')) or p.id=any(collaborators) or public.ops_can(branch_id,'verify') into b,allowed
   from public.ops_todos where id=p_entity and tenant_id=p.tenant_id;
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

create function public.ops_evidence_finish(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ops_evidence; begin
 select * into e from public.ops_evidence where id=p_id and uploaded_by=auth.uid() for update;
 if e.id is null or not public.ops_evidence_visible(e.id) then raise exception 'OPS_FORBIDDEN'; end if;
 if not exists(select 1 from storage.objects o where bucket_id='operations-evidence' and name=e.path and (o.metadata->>'size')::bigint=e.size_bytes and o.metadata->>'mimetype'=e.mime_type) then raise exception 'OPS_INVALID_FILE'; end if;
 if e.state='pending' then
  update public.ops_evidence set state='ready' where id=e.id returning * into e;
  insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,after_data) values(e.tenant_id,e.branch_id,e.entity_id,'evidence',auth.uid(),jsonb_build_object('title',e.file_name,'evidenceId',e.id));
 end if;
 return jsonb_build_object('id',e.id,'file_name',e.file_name,'created_at',e.created_at);
end $$;

create function public.ops_evidence_read(p_entity uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'file_name',e.file_name,'created_at',e.created_at,'path',e.path) order by e.created_at desc),'[]')
 from public.ops_evidence e where e.entity_id=p_entity and e.state='ready' and public.ops_evidence_visible(e.id);
$$;
revoke all on function public.ops_evidence_reserve(text,uuid,text,text,bigint),public.ops_evidence_finish(uuid),public.ops_evidence_read(uuid) from public,anon;
grant execute on function public.ops_evidence_reserve(text,uuid,text,text,bigint),public.ops_evidence_finish(uuid),public.ops_evidence_read(uuid) to authenticated;

create policy ops_evidence_upload on storage.objects for insert to authenticated with check (
 bucket_id='operations-evidence' and exists(select 1 from public.ops_evidence e where e.path=name and e.uploaded_by=auth.uid() and e.state='pending' and public.ops_evidence_visible(e.id))
);
-- Policy subqueries require read access; RLS still enforces tenant and entity scope.
grant select on public.ops_evidence to authenticated;
create policy ops_evidence_read on public.ops_evidence for select to authenticated using(public.ops_evidence_visible(id));
create policy ops_evidence_download on storage.objects for select to authenticated using (
 bucket_id='operations-evidence' and exists(select 1 from public.ops_evidence e where e.path=name and e.state='ready' and public.ops_evidence_visible(e.id))
);
-- Existing broad storage policies must not bypass this bucket's tenant scope.
create policy ops_evidence_read_guard on storage.objects as restrictive for select to authenticated using (
 bucket_id<>'operations-evidence' or exists(select 1 from public.ops_evidence e where e.path=name and e.state='ready' and public.ops_evidence_visible(e.id))
);
create policy ops_evidence_anon_read_guard on storage.objects as restrictive for select to anon using (bucket_id<>'operations-evidence');
create policy ops_evidence_insert_guard on storage.objects as restrictive for insert to authenticated with check (
 bucket_id<>'operations-evidence' or exists(select 1 from public.ops_evidence e where e.path=name and e.uploaded_by=auth.uid() and e.state='pending' and public.ops_evidence_visible(e.id))
);
create policy ops_evidence_update_guard on storage.objects as restrictive for update to anon,authenticated using (bucket_id<>'operations-evidence') with check(bucket_id<>'operations-evidence');
create policy ops_evidence_delete_guard on storage.objects as restrictive for delete to anon,authenticated using (bucket_id<>'operations-evidence');
commit;
