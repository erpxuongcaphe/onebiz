begin;
create table public.ops_notifications (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),branch_id uuid not null references public.branches(id),
 user_id uuid not null references public.profiles(id),entity_id uuid not null,title text not null,
 due_at timestamptz not null,kind text not null check(kind in ('run','todo')),day date not null,
 created_at timestamptz not null default now(),read_at timestamptz,
 unique(user_id,entity_id,kind,day)
);
create index ops_notifications_user on public.ops_notifications(user_id,created_at desc,id desc);
alter table public.ops_notifications enable row level security;
revoke all on public.ops_notifications from public,anon,authenticated;
create table public.ops_scheduler_state(name text primary key,cursor uuid);
alter table public.ops_scheduler_state enable row level security;
revoke all on public.ops_scheduler_state from public,anon,authenticated;

-- Only the cron service role can dispatch a bounded batch; no user impersonation.
create function public.ops_tick() returns jsonb language plpgsql security definer set search_path='' as $$
declare b record; last_id uuid; n integer:=0; generated integer:=0; errors jsonb:='[]'; d date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 if not pg_try_advisory_xact_lock(67303001) then return jsonb_build_object('busy',true); end if;
 insert into public.ops_scheduler_state(name) values('daily') on conflict do nothing;
 select cursor into last_id from public.ops_scheduler_state where name='daily' for update;
 if not exists(select 1 from public.branches where is_active and (last_id is null or id>last_id)) then last_id:=null; end if;
 for b in select id,tenant_id from public.branches where is_active and (last_id is null or id>last_id) order by id limit 100 loop
  begin
   generated:=generated+public.ops_generate_internal(b.id,d);
   insert into public.ops_notifications(tenant_id,branch_id,user_id,entity_id,title,due_at,kind,day)
   select r.tenant_id,r.branch_id,r.assignee_id,r.id,r.title,r.original_due_at,'run',d
    from public.ops_runs r join public.profiles p on p.id=r.assignee_id and p.tenant_id=r.tenant_id and p.is_active
    where r.branch_id=b.id and r.state not in ('done','canceled') and r.original_due_at<((d+1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    on conflict do nothing;
   insert into public.ops_notifications(tenant_id,branch_id,user_id,entity_id,title,due_at,kind,day)
   select t.tenant_id,t.branch_id,u.id,t.id,t.title,t.due_at,'todo',d from public.ops_todos t
    join public.profiles u on (u.id=t.assignee_id or u.id=any(t.collaborators)) and u.tenant_id=t.tenant_id and u.is_active
    where t.branch_id=b.id and t.state not in ('done','canceled') and (t.due_at<((d+1)::timestamp at time zone 'Asia/Ho_Chi_Minh') or t.follow_up_at<now()) on conflict do nothing;
  exception when others then errors:=errors||jsonb_build_array(jsonb_build_object('branchId',b.id,'code',sqlstate)); end;
  n:=n+1; last_id:=b.id;
 end loop;
 update public.ops_scheduler_state set cursor=last_id where name='daily';
 return jsonb_build_object('branches',n,'generated',generated,'errors',errors);
end $$;
revoke all on function public.ops_tick() from public,anon,authenticated;
grant execute on function public.ops_tick() to service_role;

create function public.ops_inbox(p_read uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED'; end if;
 if p_read is not null then update public.ops_notifications set read_at=coalesce(read_at,now()) where id=p_read and user_id=p.id and tenant_id=p.tenant_id; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select n.id,n.title,n.kind,n.due_at,n.read_at,n.created_at,b.name as branch_name from public.ops_notifications n
  join public.branches b on b.id=n.branch_id and b.tenant_id=p.tenant_id
  where n.user_id=p.id and n.tenant_id=p.tenant_id and (public.ops_can(n.branch_id,'view') or public.ops_todo_visible(n.entity_id))
  order by (n.read_at is not null),n.created_at desc,n.id desc limit 100) x),'[]');
end $$;
revoke all on function public.ops_inbox(uuid) from public,anon;
grant execute on function public.ops_inbox(uuid) to authenticated;
commit;
