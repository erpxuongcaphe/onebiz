-- Read-only functions only. No stock, money, account or Hub business rows change.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
create function public.ops_access_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; allowed boolean := false;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is not null and public.ops_has_permission('ops.view') then
  allowed := public.ops_ceo()
   or exists(select 1 from public.branches b where b.tenant_id=p.tenant_id and b.is_active and public.ops_can(b.id,'view'))
   or exists(select 1 from public.ops_todos t join public.branches b on b.id=t.branch_id and b.tenant_id=t.tenant_id
     where t.tenant_id=p.tenant_id and b.is_active and p.id=any(t.collaborators));
 end if;
 return jsonb_build_object('allowed',allowed,'isCeo',p.id is not null and public.ops_ceo());
end $$;
revoke all on function public.ops_access_context() from public,anon;
grant execute on function public.ops_access_context() to authenticated;

create function public.ops_filtered_page(p_kind text,p_branch uuid,p_search text default '',p_only_mine boolean default false,
 p_filters jsonb default '{}',p_cursor_due timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; items jsonb; tail jsonb; f jsonb := coalesce(p_filters,'{}');
 date_field text := coalesce(f->>'dateField','due'); from_at timestamptz; to_at timestamptz;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED' using errcode='42501'; end if;
 if not coalesce((public.ops_access_context()->>'allowed')::boolean,false) then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_branch is not null and not public.ops_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('run','todo') or length(coalesce(p_search,''))>200 or p_only_mine is null
  or jsonb_typeof(f)<>'object' or num_nonnulls(p_cursor_due,p_cursor_id) not in (0,2)
  or date_field not in ('due','created','completed','verified','follow_up')
  or coalesce(f->>'state','') not in ('','pending','done','transferred','in_progress','waiting','canceled')
  or coalesce(f->>'quality','') not in ('','met','unmet','unknown')
  or coalesce(f->>'verification','') not in ('','verified','unverified','pending_review')
  or coalesce(f->>'deadline','') not in ('','overdue','on_time','late','upcoming','follow_up')
  or coalesce(f->>'frequency','') not in ('','daily','weekly','monthly','event')
  or coalesce(f->>'category','') not in ('','operations','hr','maintenance','complaint','food_safety','product','goods','cleaning','space','equipment','other')
  or coalesce(f->>'priority','') not in ('','important_urgent','important','urgent','normal') then raise exception 'OPS_INVALID_RANGE'; end if;
 if p_kind='run' and (date_field in ('created','follow_up') or coalesce(f->>'category','')<>'' or coalesce(f->>'priority','')<>'' or nullif(f->>'collaborator','') is not null or f->>'deadline'='follow_up' or f->>'state' in ('in_progress','waiting','canceled'))
  or p_kind='todo' and (date_field='verified' or coalesce(f->>'quality','')<>'' or coalesce(f->>'verification','')<>'' or coalesce(f->>'frequency','')<>'' or nullif(f->>'standard','') is not null or f->>'state'='transferred') then raise exception 'OPS_INVALID_RANGE'; end if;
 from_at := nullif(f->>'from','')::timestamptz; to_at := nullif(f->>'to','')::timestamptz;
 if num_nonnulls(from_at,to_at) not in (0,2) or from_at>=to_at then raise exception 'OPS_INVALID_RANGE'; end if;

 with visible as (
  select to_jsonb(r) data,r.id,r.original_due_at due,r.original_due_at original_due,r.title search_text,r.assignee_id,
   r.state,r.quality,r.met_at completed,r.verified_at verified,null::timestamptz follow_up,
   null::timestamptz created,array[]::uuid[] collaborators,''::text category,''::text priority,r.standard_id,s.frequency
  from public.ops_runs r join public.ops_standards s on s.id=r.standard_id and s.tenant_id=r.tenant_id
  where p_kind='run' and r.tenant_id=p.tenant_id and (p_branch is null or r.branch_id=p_branch) and public.ops_can(r.branch_id,'view')
  union all
  select to_jsonb(t),t.id,t.due_at,t.original_due_at,t.title||' '||coalesce(t.description,''),t.assignee_id,
   t.state,''::text,t.completed_at,null::timestamptz,t.follow_up_at,t.created_at,t.collaborators,t.category,t.priority,null::uuid,''::text
  from public.ops_todos t join public.branches b on b.id=t.branch_id and b.tenant_id=t.tenant_id and b.is_active
  where p_kind='todo' and t.tenant_id=p.tenant_id and (p_branch is null or t.branch_id=p_branch)
   and (public.ops_can(t.branch_id,'view') or p.id=any(t.collaborators))
 ), filtered as (
  select * from visible v where (not p_only_mine or v.assignee_id=p.id or p.id=any(v.collaborators))
   and position(lower(coalesce(p_search,'')) in lower(v.search_text))>0
   and (coalesce(f->>'state','')='' or v.state=f->>'state')
   and (nullif(f->>'assignee','') is null or v.assignee_id=(f->>'assignee')::uuid)
   and (nullif(f->>'collaborator','') is null or (f->>'collaborator')::uuid=any(v.collaborators))
   and (nullif(f->>'standard','') is null or v.standard_id=(f->>'standard')::uuid)
   and (coalesce(f->>'frequency','')='' or v.frequency=f->>'frequency')
   and (coalesce(f->>'category','')='' or v.category=f->>'category')
   and (coalesce(f->>'priority','')='' or v.priority=f->>'priority')
   and (coalesce(f->>'quality','')='' or v.quality=f->>'quality')
   and (coalesce(f->>'verification','')='' or (f->>'verification'='verified' and v.verified is not null)
    or (f->>'verification'='unverified' and v.verified is null)
    or (f->>'verification'='pending_review' and v.verified is null and (v.quality<>'unknown' or v.due<=now())))
   and (coalesce(f->>'deadline','')='' or (f->>'deadline'='overdue' and v.state not in ('done','canceled') and v.completed is null and v.due<now())
    or (f->>'deadline'='upcoming' and v.state not in ('done','canceled') and v.completed is null and v.due>=now())
    or (f->>'deadline'='on_time' and v.completed<=v.original_due) or (f->>'deadline'='late' and v.completed>v.original_due)
    or (f->>'deadline'='follow_up' and v.state='waiting' and v.follow_up<=now()))
   and (from_at is null or (case date_field when 'created' then v.created when 'completed' then v.completed when 'verified' then v.verified when 'follow_up' then v.follow_up else v.due end >=from_at
    and case date_field when 'created' then v.created when 'completed' then v.completed when 'verified' then v.verified when 'follow_up' then v.follow_up else v.due end <to_at))
   and (p_cursor_id is null or (v.due,v.id)>(p_cursor_due,p_cursor_id))
  order by v.due,v.id limit 51
 ) select coalesce(jsonb_agg(data order by due,id),'[]') into items from filtered;
 if jsonb_array_length(items)>50 then tail:=items->49; items:=items-50; end if;
 return jsonb_build_object('rows',items,'next',case when tail is not null then
  jsonb_build_object('due',case p_kind when 'run' then tail->>'original_due_at' else tail->>'due_at' end,'id',tail->>'id') else null end);
end $$;
revoke all on function public.ops_filtered_page(text,uuid,text,boolean,jsonb,timestamptz,uuid) from public,anon;
grant execute on function public.ops_filtered_page(text,uuid,text,boolean,jsonb,timestamptz,uuid) to authenticated;
commit;
