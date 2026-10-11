begin;
-- Links do not synchronize completion, revenue, or stock between the two modules.
create table public.ops_mkt_links (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),todo_id uuid not null references public.ops_todos(id),
 task_id uuid not null references public.mkt_tasks(id),created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),unique(todo_id,task_id)
);
create index ops_mkt_links_task on public.ops_mkt_links(task_id,todo_id);
alter table public.ops_mkt_links enable row level security;
revoke all on public.ops_mkt_links from public,anon,authenticated;

create function public.ops_mkt_links_read(p_todo uuid default null,p_task uuid default null,p_search text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; todo public.ops_todos; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED'; end if;
 if (p_todo is null)=(p_task is null) or length(coalesce(p_search,''))>200 then raise exception 'OPS_INVALID_RESULT'; end if;
 if p_todo is not null then
  select * into todo from public.ops_todos where id=p_todo and tenant_id=p.tenant_id;
  if todo.id is null or not public.ops_todo_visible(todo.id) then raise exception 'OPS_FORBIDDEN'; end if;
 elsif not exists(select 1 from public.mkt_tasks where id=p_task and tenant_id=p.tenant_id and deleted_at is null and (assignee_id=p.id or reviewer_id=p.id or public.mkt_is_lead())) then raise exception 'OPS_FORBIDDEN'; end if;
 return jsonb_build_object('links',coalesce((select jsonb_agg(to_jsonb(x)) from (
  select l.id,l.task_id,l.todo_id,l.branch_id,t.title as task_title,t.task_status as task_state,o.title as todo_title,o.state as todo_state
  from public.ops_mkt_links l join public.mkt_tasks t on t.id=l.task_id and t.tenant_id=p.tenant_id and t.deleted_at is null
  join public.ops_todos o on o.id=l.todo_id and o.tenant_id=p.tenant_id
  where l.tenant_id=p.tenant_id and (p_todo is null or l.todo_id=p_todo) and (p_task is null or l.task_id=p_task)
  and public.ops_todo_visible(o.id) and (t.assignee_id=p.id or t.reviewer_id=p.id or public.mkt_is_lead()) order by l.created_at desc,l.id desc limit 100) x),'[]'),
 'candidates',case when p_todo is not null then coalesce((select jsonb_agg(to_jsonb(x)) from (
  select id,title,task_status from public.mkt_tasks t where tenant_id=p.tenant_id and deleted_at is null and task_status not in ('done','canceled')
  and (assignee_id=p.id or reviewer_id=p.id or public.mkt_is_lead())
  and (coalesce(p_search,'')='' or strpos(lower(title),lower(p_search))>0)
  order by due_at nulls last,id limit 50) x),'[]') else '[]'::jsonb end);
end $$;

create function public.ops_mkt_link(p_todo uuid,p_task uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; todo public.ops_todos; linked public.ops_mkt_links; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 select * into todo from public.ops_todos where id=p_todo and tenant_id=p.tenant_id;
 if todo.id is null or todo.state in ('done','canceled') or not public.ops_todo_visible(todo.id)
  or (todo.assignee_id<>p.id and not public.ops_can(todo.branch_id,'approve_policy')) then raise exception 'OPS_FORBIDDEN'; end if;
 if not exists(select 1 from public.mkt_tasks where id=p_task and tenant_id=p.tenant_id and deleted_at is null and task_status not in ('done','canceled')
  and (assignee_id=p.id or reviewer_id=p.id or public.mkt_is_lead())) then raise exception 'OPS_FORBIDDEN'; end if;
 insert into public.ops_mkt_links(tenant_id,branch_id,todo_id,task_id,created_by) values(p.tenant_id,todo.branch_id,p_todo,p_task,p.id)
  on conflict(todo_id,task_id) do nothing returning * into linked;
 if linked.id is null then select * into linked from public.ops_mkt_links where todo_id=p_todo and task_id=p_task; return to_jsonb(linked); end if;
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,after_data) values(p.tenant_id,todo.branch_id,todo.id,'mkt_link',p.id,to_jsonb(linked));
 insert into public.ops_notifications(tenant_id,branch_id,user_id,entity_id,title,due_at,kind,day)
 select p.tenant_id,todo.branch_id,u.id,todo.id,'To-do có liên kết phối hợp văn phòng',todo.due_at,'todo',(now() at time zone 'Asia/Ho_Chi_Minh')::date
 from public.profiles u where u.tenant_id=p.tenant_id and u.is_active and (u.id=todo.assignee_id or u.id=any(todo.collaborators)) on conflict do nothing;
 return to_jsonb(linked);
end $$;
revoke all on function public.ops_mkt_links_read(uuid,uuid,text),public.ops_mkt_link(uuid,uuid) from public,anon;
grant execute on function public.ops_mkt_links_read(uuid,uuid,text),public.ops_mkt_link(uuid,uuid) to authenticated;

create function public.ops_mkt_link_changed() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.ops_notifications(tenant_id,branch_id,user_id,entity_id,title,due_at,kind,day)
 select l.tenant_id,l.branch_id,p.id,o.id,'Công việc văn phòng liên kết To-do đã cập nhật',o.due_at,'todo',(now() at time zone 'Asia/Ho_Chi_Minh')::date
 from public.ops_mkt_links l join public.ops_todos o on o.id=l.todo_id and o.tenant_id=new.tenant_id and o.state not in ('done','canceled')
 join public.profiles p on p.tenant_id=new.tenant_id and p.is_active and (p.id=o.assignee_id or p.id=any(o.collaborators))
 where l.task_id=new.id and l.tenant_id=new.tenant_id
 on conflict(user_id,entity_id,kind,day) do update set title=excluded.title,created_at=now(),read_at=null;
 return new;
end $$;
revoke all on function public.ops_mkt_link_changed() from public,anon,authenticated;
create trigger operations_mkt_link_changed after update of task_status,deleted_at on public.mkt_tasks for each row
 when(old.task_status is distinct from new.task_status or old.deleted_at is distinct from new.deleted_at) execute function public.ops_mkt_link_changed();
commit;
