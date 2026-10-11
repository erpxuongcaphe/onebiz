begin;

create index ops_todos_scope_due_idx on public.ops_todos
 (tenant_id,branch_id,(state in ('done','canceled')),due_at,id);

-- Read-only paging. Scope and collaborator access are enforced before pagination.
create function public.ops_todo_page(p_branch uuid,p_search text default '',p_only_mine boolean default false,
 p_cursor_closed boolean default null,p_cursor_due timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; items jsonb; tail jsonb; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED' using errcode='42501'; end if;
 if not public.ops_has_permission('ops.view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_branch is not null and not public.ops_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if length(coalesce(p_search,''))>200 or p_only_mine is null
  or num_nonnulls(p_cursor_closed,p_cursor_due,p_cursor_id) not in (0,3) then raise exception 'OPS_INVALID_RANGE'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by (x.state in ('done','canceled')),x.due_at,x.id),'[]') into items from (
  select t.* from public.ops_todos t where t.tenant_id=p.tenant_id
   and ((t.branch_id=p_branch and public.ops_can(t.branch_id,'view')) or p.id=any(t.collaborators))
   and (not p_only_mine or t.assignee_id=p.id or p.id=any(t.collaborators))
   and position(lower(coalesce(p_search,'')) in lower(t.title))>0
   and (p_cursor_id is null or ((t.state in ('done','canceled')),t.due_at,t.id)>(p_cursor_closed,p_cursor_due,p_cursor_id))
  order by (t.state in ('done','canceled')),t.due_at,t.id limit 51
 ) x;
 if jsonb_array_length(items)>50 then tail:=items->49; items:=items-50; end if;
 return jsonb_build_object('rows',items,'next',case when tail is not null then
  jsonb_build_object('closed',tail->>'state' in ('done','canceled'),'due',tail->>'due_at','id',tail->>'id') else null end);
end $$;
revoke all on function public.ops_todo_page(uuid,text,boolean,boolean,timestamptz,uuid) from public,anon;
grant execute on function public.ops_todo_page(uuid,text,boolean,boolean,timestamptz,uuid) to authenticated;
commit;
