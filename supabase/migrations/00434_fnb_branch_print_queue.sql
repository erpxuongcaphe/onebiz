begin;

-- Previously applied through SQL Editor under working filename 00433.
-- 00434 avoids the invoice migration version collision. Safe to apply again.
create table if not exists public.fnb_print_points (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id), name text not null,
  enabled boolean not null default false, routes jsonb not null default '[]', detected_printers jsonb not null default '[]',
  token_hash bytea, last_seen_at timestamptz, updated_at timestamptz not null default now(),
  unique(branch_id)
);
create table if not exists public.fnb_print_jobs (
  id uuid primary key, tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id), point_id uuid not null references public.fnb_print_points(id),
  actor_id uuid not null references public.profiles(id), actor_name text not null,
  label text not null, route_key text not null, route_label text not null, printer text not null,
  paper text not null check(paper in ('58mm','80mm')), bytes_base64 text not null, payload_hash bytea not null,
  status text not null default 'queued' check(status in ('queued','sending','handed_off','failed','unknown','cancelled')),
  message text, created_at timestamptz not null default now(), claimed_at timestamptz,
  claim_id uuid, finished_at timestamptz, last_action_by uuid references public.profiles(id)
);
create index if not exists fnb_print_jobs_pending on public.fnb_print_jobs(point_id,created_at) where status='queued';
create index if not exists fnb_print_jobs_inflight on public.fnb_print_jobs(point_id,claimed_at) where status='sending';
create index if not exists fnb_print_jobs_branch on public.fnb_print_jobs(branch_id,created_at desc);
alter table public.fnb_print_points enable row level security;
alter table public.fnb_print_jobs enable row level security;
revoke all on public.fnb_print_points,public.fnb_print_jobs from anon,authenticated;

create or replace function public._fnb_print_access_v1(p_branch uuid,p_manage boolean default false)
returns uuid language plpgsql stable security definer set search_path=public,extensions as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
  if v_tenant is null or not coalesce(public.user_has_branch_access(auth.uid(),p_branch),false)
     or not exists(select 1 from public.branches where id=p_branch and tenant_id=v_tenant and is_active) then
    raise exception 'Không có quyền sử dụng chi nhánh này.' using errcode='42501';
  end if;
  if p_manage then
    if not coalesce(public.user_has_permission(auth.uid(),'system.manage_branches'),false) then
      raise exception 'Cần quyền quản lý chi nhánh để thiết lập điểm in.' using errcode='42501';
    end if;
  elsif not (coalesce(public.user_has_permission(auth.uid(),'pos_fnb.send_kitchen'),false)
      or coalesce(public.user_has_permission(auth.uid(),'pos_fnb.checkout'),false)
      or coalesce(public.user_has_permission(auth.uid(),'pos_fnb.view_orders'),false)
      or coalesce(public.user_has_permission(auth.uid(),'system.manage_branches'),false)) then
    raise exception 'Không có quyền xem hoặc gửi phiếu F&B.' using errcode='42501';
  end if;
  return v_tenant;
end $$;

create or replace function public.fnb_print_manage_v1(p_branch uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_tenant uuid; v_point public.fnb_print_points; v_token text; v_route jsonb; v_routes jsonb; v_job public.fnb_print_jobs;
begin
  v_tenant:=public._fnb_print_access_v1(p_branch,true);
  perform pg_advisory_xact_lock(hashtextextended('fnb-print:'||p_branch::text,0));
  select * into v_point from public.fnb_print_points where branch_id=p_branch and tenant_id=v_tenant for update;
  if p_action='save' then
    v_routes:=p_data->'routes';
    if nullif(trim(p_data->>'name'),'') is null or length(p_data->>'name')>80 or jsonb_typeof(v_routes) is distinct from 'array' or jsonb_array_length(v_routes)>30 then raise exception 'Tên điểm in hoặc danh sách nơi nhận không hợp lệ.'; end if;
    for v_route in select value from jsonb_array_elements(v_routes) loop
      if coalesce(v_route->>'key','') !~ '^(cashier|kitchen|[0-9a-f-]{36})$'
        or coalesce(v_route->>'paper','') not in ('58mm','80mm')
        or nullif(trim(v_route->>'printer'),'') is null or length(v_route->>'printer')>200
        or nullif(trim(v_route->>'label'),'') is null or length(v_route->>'label')>80 then raise exception 'Nơi nhận, tên máy hoặc khổ giấy không hợp lệ.'; end if;
      if v_route->>'key' not in ('cashier','kitchen') and not exists(select 1 from public.kitchen_stations where id=(v_route->>'key')::uuid and branch_id=p_branch and tenant_id=v_tenant) then raise exception 'Trạm không thuộc chi nhánh.'; end if;
    end loop;
    if (select count(*) from jsonb_array_elements(v_routes))<>(select count(distinct value->>'key') from jsonb_array_elements(v_routes)) then raise exception 'Một nơi nhận chỉ được gán một máy.'; end if;
    insert into public.fnb_print_points(tenant_id,branch_id,name,routes,enabled)
      values(v_tenant,p_branch,trim(p_data->>'name'),v_routes,coalesce((p_data->>'enabled')::boolean,false))
      on conflict(branch_id) do update set name=excluded.name,routes=excluded.routes,enabled=excluded.enabled,updated_at=now() returning * into v_point;
    return to_jsonb(v_point)-'token_hash';
  elsif p_action='rotate' then
    if v_point.id is null then raise exception 'Lưu điểm in trước khi cấp mã kết nối.'; end if;
    v_token:=encode(gen_random_bytes(32),'hex');
    update public.fnb_print_points set token_hash=digest(v_token,'sha256'),last_seen_at=null,updated_at=now() where id=v_point.id;
    return jsonb_build_object('id',v_point.id,'token',v_token);
  elsif p_action in ('retry','cancel') then
    update public.fnb_print_jobs set status='unknown',message='Điểm in mất kết nối trong lúc xử lý.',finished_at=now()
      where branch_id=p_branch and tenant_id=v_tenant and status='sending' and claimed_at<now()-interval '2 minutes';
    select * into v_job from public.fnb_print_jobs where id=(p_data->>'id')::uuid and branch_id=p_branch and tenant_id=v_tenant for update;
    if not found or v_job.status not in ('failed','unknown','queued') then raise exception 'Lệnh không còn ở trạng thái có thể xử lý.'; end if;
    if p_action='cancel' then
      update public.fnb_print_jobs set status='cancelled',bytes_base64='',last_action_by=auth.uid(),finished_at=now(),message='Quản lý dừng lệnh.' where id=v_job.id;
    else
      -- Reprinting is a new audited job. The original never loses its history.
      insert into public.fnb_print_jobs(id,tenant_id,branch_id,point_id,actor_id,actor_name,label,route_key,route_label,printer,paper,bytes_base64,payload_hash,message)
      values(gen_random_uuid(),v_tenant,p_branch,v_job.point_id,auth.uid(),(select full_name from public.profiles where id=auth.uid()),'IN LẠI · '||left(v_job.label,65),v_job.route_key,v_job.route_label,v_job.printer,v_job.paper,v_job.bytes_base64,v_job.payload_hash,'In lại có xác nhận từ lệnh '||v_job.id::text);
      update public.fnb_print_jobs set status='cancelled',bytes_base64='',last_action_by=auth.uid(),finished_at=now(),message='Đã tạo lệnh in lại; xem lịch sử lệnh mới.' where id=v_job.id;
    end if;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Thao tác không hợp lệ.';
end $$;

create or replace function public.fnb_print_state_v1(p_branch uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare v_tenant uuid; v_point jsonb; v_jobs jsonb;
begin
  v_tenant:=public._fnb_print_access_v1(p_branch);
  select (to_jsonb(p)-'token_hash')||jsonb_build_object('connected',p.enabled and coalesce(p.last_seen_at>now()-interval '45 seconds',false)) into v_point from public.fnb_print_points p where branch_id=p_branch and tenant_id=v_tenant;
  select coalesce(jsonb_agg(j order by j.created_at desc),'[]') into v_jobs from
    (select id,label,route_label,case when status='sending' and claimed_at<now()-interval '2 minutes' then 'unknown' else status end as status,created_at,actor_name,
      case when status='sending' and claimed_at<now()-interval '2 minutes' then 'Điểm in mất kết nối trong lúc xử lý. Kiểm tra giấy trước khi in lại.' else message end as message
      from public.fnb_print_jobs where branch_id=p_branch and tenant_id=v_tenant order by created_at desc limit 50) j;
  return jsonb_build_object('point',v_point,'jobs',v_jobs);
end $$;

create or replace function public.fnb_print_enqueue_v1(p_branch uuid,p_id uuid,p_route text,p_label text,p_paper text,p_bytes text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_tenant uuid; v_point public.fnb_print_points; v_route jsonb; v_job public.fnb_print_jobs; v_bytes bytea;
begin
  v_tenant:=public._fnb_print_access_v1(p_branch);
  if p_id is null or nullif(trim(p_label),'') is null or length(p_label)>80 then raise exception 'Thông tin phiếu không hợp lệ.'; end if;
  if p_route='cashier' then
    if not (coalesce(public.user_has_permission(auth.uid(),'pos_fnb.checkout'),false) or coalesce(public.user_has_permission(auth.uid(),'pos_fnb.view_orders'),false) or coalesce(public.user_has_permission(auth.uid(),'system.manage_branches'),false)) then raise exception 'Không có quyền in bill.' using errcode='42501'; end if;
  elsif not (coalesce(public.user_has_permission(auth.uid(),'pos_fnb.send_kitchen'),false) or coalesce(public.user_has_permission(auth.uid(),'system.manage_branches'),false)) then raise exception 'Không có quyền gửi phiếu bếp.' using errcode='42501'; end if;
  if length(p_bytes)>2400000 or p_bytes is null then raise exception 'Phiếu quá dài. Chia nội dung rồi gửi lại.'; end if;
  v_bytes:=decode(p_bytes,'base64');
  if octet_length(v_bytes)<20 or substring(v_bytes from 1 for 5)<>decode('1b401b6101','hex') then raise exception 'Dữ liệu in không hợp lệ.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-print:'||p_branch::text,0));
  select * into v_point from public.fnb_print_points where branch_id=p_branch and tenant_id=v_tenant and enabled for share;
  if not found then raise exception 'Chi nhánh chưa bật điểm in.'; end if;
  select value into v_route from jsonb_array_elements(v_point.routes) where value->>'key'=p_route;
  if v_route is null or v_route->>'paper' is distinct from p_paper then raise exception 'Nơi nhận chưa gán máy hoặc khổ giấy đã thay đổi. Hãy tải lại và gửi lại.'; end if;
  select * into v_job from public.fnb_print_jobs where id=p_id;
  if found then
    if v_job.tenant_id<>v_tenant or v_job.branch_id<>p_branch or v_job.actor_id<>auth.uid() or v_job.route_key<>p_route or v_job.payload_hash<>digest(v_bytes,'sha256') then raise exception 'Mã lệnh đã được dùng cho phiếu khác.'; end if;
    return jsonb_build_object('id',v_job.id,'route_label',v_job.route_label);
  end if;
  if (select count(*) from public.fnb_print_jobs where point_id=v_point.id and status='queued')>=100 then raise exception 'Điểm in có quá nhiều phiếu chờ. Nhờ quản lý kiểm tra.'; end if;
  insert into public.fnb_print_jobs(id,tenant_id,branch_id,point_id,actor_id,actor_name,label,route_key,route_label,printer,paper,bytes_base64,payload_hash)
  values(p_id,v_tenant,p_branch,v_point.id,auth.uid(),(select full_name from public.profiles where id=auth.uid()),trim(p_label),p_route,v_route->>'label',v_route->>'printer',p_paper,p_bytes,digest(v_bytes,'sha256'));
  return jsonb_build_object('id',p_id,'route_label',v_route->>'label');
end $$;

-- Device credential grants only access to that point, never user/business tables.
create or replace function public.fnb_print_agent_v1(p_point uuid,p_token text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_point public.fnb_print_points; v_job public.fnb_print_jobs; v_claim uuid; v_status text;
begin
  if p_token is null or length(p_token)<>64 then raise exception 'PRINT_POINT_UNAUTHORIZED' using errcode='42501'; end if;
  select * into v_point from public.fnb_print_points where id=p_point and enabled and token_hash=digest(p_token,'sha256') for update;
  if not found then raise exception 'PRINT_POINT_UNAUTHORIZED' using errcode='42501'; end if;
  update public.fnb_print_points set last_seen_at=now() where id=p_point and (last_seen_at is null or last_seen_at<now()-interval '15 seconds');
  -- Expired sends are ambiguous. Never reclaim automatically.
  update public.fnb_print_jobs set status='unknown',message='Điểm in mất kết nối trong lúc xử lý. Kiểm tra giấy trước khi in lại.',finished_at=now()
    where point_id=p_point and status='sending' and claimed_at<now()-interval '2 minutes';
  if p_action='heartbeat' then
    if jsonb_typeof(p_data->'printers') is distinct from 'array' or jsonb_array_length(p_data->'printers')>100
      or exists(select 1 from jsonb_array_elements(p_data->'printers') p where jsonb_typeof(p)<>'string' or length(p#>>'{}')>200) then raise exception 'INVALID_PRINTER_LIST'; end if;
    update public.fnb_print_points set detected_printers=p_data->'printers' where id=p_point;
    return jsonb_build_object('ok',true);
  elsif p_action='claim' then
    if exists(select 1 from public.fnb_print_jobs where point_id=p_point and status='sending') then return null; end if;
    select * into v_job from public.fnb_print_jobs where point_id=p_point and status='queued' order by created_at,id for update skip locked limit 1;
    if not found then return null; end if;
    v_claim:=gen_random_uuid();
    update public.fnb_print_jobs set status='sending',claim_id=v_claim,claimed_at=now() where id=v_job.id;
    return jsonb_build_object('id',v_job.id,'claim_id',v_claim,'printer',v_job.printer,'paper',v_job.paper,'label',v_job.label,'bytes',v_job.bytes_base64);
  elsif p_action='finish' then
    v_status:=p_data->>'status';
    if v_status not in ('handed_off','failed','unknown') or v_status is null then raise exception 'INVALID_PRINT_STATUS'; end if;
    update public.fnb_print_jobs set status=v_status,bytes_base64=case when v_status='handed_off' then '' else bytes_base64 end,message=left(p_data->>'message',300),finished_at=now()
     where id=(p_data->>'id')::uuid and point_id=p_point and claim_id=(p_data->>'claim_id')::uuid and status='sending';
    if not found then raise exception 'PRINT_CLAIM_EXPIRED'; end if;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'INVALID_PRINT_ACTION';
end $$;

revoke all on function public._fnb_print_access_v1(uuid,boolean) from public,anon,authenticated;
revoke all on function public.fnb_print_manage_v1(uuid,text,jsonb),public.fnb_print_state_v1(uuid),public.fnb_print_enqueue_v1(uuid,uuid,text,text,text,text),public.fnb_print_agent_v1(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fnb_print_manage_v1(uuid,text,jsonb),public.fnb_print_state_v1(uuid),public.fnb_print_enqueue_v1(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.fnb_print_agent_v1(uuid,text,text,jsonb) to anon,authenticated;
commit;
