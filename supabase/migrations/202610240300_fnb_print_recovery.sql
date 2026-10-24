begin;
set local lock_timeout='2s';
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
    -- Unclaimed old tickets are not proof of a failed physical send. Keep them for review.
    -- This runs only for an authenticated point, and never requeues sending/unknown jobs.
    update public.fnb_print_jobs set status='failed',finished_at=now(),
      message='[PRINT_QUEUE_STALE] Phiếu chờ quá 5 phút, chưa được điểm in nhận. Đã giữ lại; quản lý kiểm tra trước khi xác nhận in hoặc dừng.'
      where point_id=p_point and status='queued' and created_at<=now()-interval '5 minutes';
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
      -- A held (never claimed) ticket follows the current route after LAN/USB changes.
      -- Ambiguous reprints keep their original destination and explicit confirmation.
      if v_job.claimed_at is null and v_job.status='failed' and v_job.message like '[PRINT_QUEUE_STALE]%' then
        if not v_point.enabled then raise exception 'Điểm in chưa bật nhận phiếu.'; end if;
        select value into v_route from jsonb_array_elements(v_point.routes) where value->>'key'=v_job.route_key;
        if v_route is null or v_route->>'paper' is distinct from v_job.paper then
          raise exception 'Nơi nhận/khổ giấy đã thay đổi. Kiểm tra và tạo lại phiếu từ bill; chưa gửi phiếu cũ.';
        end if;
        v_job.printer:=v_route->>'printer';
      end if;
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
  select coalesce(jsonb_agg(j order by coalesce(j.status='failed' and j.message like '[PRINT_QUEUE_STALE]%',false) desc,j.created_at desc),'[]') into v_jobs from
    (select id,label,route_label,case when status='sending' and claimed_at<now()-interval '2 minutes' then 'unknown' else status end as status,created_at,actor_name,
      case when status='sending' and claimed_at<now()-interval '2 minutes' then 'Điểm in mất kết nối trong lúc xử lý. Kiểm tra giấy trước khi in lại.' else message end as message
      from public.fnb_print_jobs where branch_id=p_branch and tenant_id=v_tenant order by coalesce(status='failed' and message like '[PRINT_QUEUE_STALE]%',false) desc,created_at desc limit 50) j;
  return jsonb_build_object('point',v_point,'jobs',v_jobs);
end $$;
notify pgrst, 'reload schema';
commit;
