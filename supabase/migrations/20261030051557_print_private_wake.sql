begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
-- Opt-in only after the receiver at this point has been upgraded in a quiet window.
alter table public.fnb_print_points add column if not exists wake_enabled boolean not null default false;
create or replace function public.fnb_print_agent_v1(p_point uuid,p_token text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_point public.fnb_print_points; v_job public.fnb_print_jobs; v_claim uuid; v_status text; v_request uuid;
begin
  if p_token is null or length(p_token)<>64 then raise exception 'PRINT_POINT_UNAUTHORIZED' using errcode='42501'; end if;
  -- Legacy-compatible idle fast path: authenticate every call, but avoid point
  -- row locks and queue maintenance UPDATEs when there is no outstanding work.
  -- Validate recoverable UUIDs before the idle shortcut; no queued/sending job means no replay.
  if p_action='claim' then
    if nullif(p_data->>'request_id','') is not null then v_request:=(p_data->>'request_id')::uuid; end if;
    if not exists(select 1 from public.fnb_print_points where id=p_point and enabled and token_hash=digest(p_token,'sha256')) then
      raise exception 'PRINT_POINT_UNAUTHORIZED' using errcode='42501';
    end if;
    if not exists(select 1 from public.fnb_print_jobs where point_id=p_point and status='queued')
       and not exists(select 1 from public.fnb_print_jobs where point_id=p_point and status='sending') then
      update public.fnb_print_points set last_seen_at=now()
        where id=p_point and enabled and token_hash=digest(p_token,'sha256')
        and (last_seen_at is null or last_seen_at<now()-interval '15 seconds');
      return null;
    end if;
  end if;
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
    return jsonb_build_object('ok',true,'recoverable_claim_v1',true);
  elsif p_action='claim' then
    -- Optional for old receivers. New receivers fsync this random request ID
    -- before calling, and fsync a physical-send journal before touching paper.
    if nullif(p_data->>'request_id','') is not null then
      v_request:=(p_data->>'request_id')::uuid;
      select * into v_job from public.fnb_print_jobs where point_id=p_point and claim_id=v_request for update;
      if found then
        -- A terminal/expired job must NEVER be delivered again for this intent.
        if v_job.status<>'sending' then return null; end if;
        return jsonb_build_object('id',v_job.id,'claim_id',v_job.claim_id,'printer',v_job.printer,'paper',v_job.paper,'label',v_job.label,'bytes',v_job.bytes_base64);
      end if;
    end if;
    -- Unclaimed old tickets are not proof of a failed physical send. Keep them for review.
    -- This runs only for an authenticated point, and never requeues sending/unknown jobs.
    update public.fnb_print_jobs set status='failed',finished_at=now(),
      message='[PRINT_QUEUE_STALE] Phiếu chờ quá 5 phút, chưa được điểm in nhận. Đã giữ lại; quản lý kiểm tra trước khi xác nhận in hoặc dừng.'
      where point_id=p_point and status='queued' and created_at<=now()-interval '5 minutes';
    if exists(select 1 from public.fnb_print_jobs where point_id=p_point and status='sending') then return null; end if;
    select * into v_job from public.fnb_print_jobs where point_id=p_point and status='queued' order by created_at,id for update skip locked limit 1;
    if not found then return null; end if;
    v_claim:=coalesce(v_request,gen_random_uuid());
    update public.fnb_print_jobs set status='sending',claim_id=v_claim,claimed_at=now() where id=v_job.id;
    return jsonb_build_object('id',v_job.id,'claim_id',v_claim,'printer',v_job.printer,'paper',v_job.paper,'label',v_job.label,'bytes',v_job.bytes_base64);
  elsif p_action='finish' then
    v_status:=p_data->>'status';
    if v_status not in ('handed_off','failed','unknown') or v_status is null then raise exception 'INVALID_PRINT_STATUS'; end if;
    update public.fnb_print_jobs set status=v_status,bytes_base64=case when v_status='handed_off' then '' else bytes_base64 end,message=left(p_data->>'message',300),finished_at=now()
     where id=(p_data->>'id')::uuid and point_id=p_point and claim_id=(p_data->>'claim_id')::uuid and status='sending';
    if not found then
      -- A committed finish whose HTTP response was lost can be acknowledged
      -- again, but cannot overwrite a different result or a management action.
      if exists(select 1 from public.fnb_print_jobs where id=(p_data->>'id')::uuid
        and point_id=p_point and claim_id=(p_data->>'claim_id')::uuid and status=v_status) then
        return jsonb_build_object('ok',true,'already_finished',true);
      end if;
      raise exception 'PRINT_CLAIM_EXPIRED';
    end if;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'INVALID_PRINT_ACTION';
end $$;

-- Server-only authorization for the receive-only SSE relay. The installed point
-- credential is checked, never returned. Browser/anonymous roles cannot call it.
create or replace function public.fnb_print_wake_authorize_v1(p_point uuid,p_token text)
returns boolean language sql stable security definer set search_path=public,extensions as $$
  select length(p_token)=64 and exists(
    select 1 from public.fnb_print_points where id=p_point and enabled and wake_enabled and token_hash=digest(p_token,'sha256')
  )
$$;
revoke all on function public.fnb_print_wake_authorize_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.fnb_print_wake_authorize_v1(uuid,text) to service_role;

create or replace function public._fnb_print_wake_v1()
returns trigger language plpgsql security definer set search_path=public,extensions set lock_timeout='100ms' as $$
begin
  if new.status='queued' then
    if tg_op='UPDATE' then
      if old.status='queued' and old.point_id=new.point_id then return new; end if;
    end if;
    if not exists(select 1 from public.fnb_print_points where id=new.point_id and enabled and wake_enabled) then return new; end if;
    -- Notification is a hint after commit, never a job/credential. Private
    -- channel, server-only subscriber; no realtime.messages policy is added.
    begin
      perform realtime.send('{}'::jsonb,'wake','fnb-print:'||new.point_id::text,true);
    exception when others then
      -- Realtime failure must not stop selling/enqueue. Existing polling recovers.
      null;
    end;
  end if;
  return new;
end $$;
revoke all on function public._fnb_print_wake_v1() from public,anon,authenticated;
drop trigger if exists fnb_print_wake on public.fnb_print_jobs;
create trigger fnb_print_wake after insert or update of status,point_id on public.fnb_print_jobs
  for each row execute function public._fnb_print_wake_v1();

notify pgrst, 'reload schema';
commit;

