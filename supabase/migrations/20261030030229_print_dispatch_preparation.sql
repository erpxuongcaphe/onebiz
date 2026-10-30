begin;
set local lock_timeout = '2s';
set local statement_timeout = '10s';

-- Nullable metadata only: no backfill, no change to old jobs or claim semantics.
alter table public.fnb_print_jobs add column if not exists preparation_ms jsonb;

-- Dispatch needs routing, not a sorted history of the last fifty tickets.
create or replace function public.fnb_print_routes_v1(p_branch uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_tenant uuid; v_point jsonb;
begin
  v_tenant := public._fnb_print_access_v1(p_branch);
  select jsonb_build_object('id', p.id, 'enabled', p.enabled, 'routes', p.routes)
    into v_point from public.fnb_print_points p
    where p.branch_id = p_branch and p.tenant_id = v_tenant;
  return jsonb_build_object('point', v_point);
end $$;

-- Timings travel with the existing enqueue request; no extra telemetry RPC.
-- v1 remains the sole authority for permissions, paper validation and idempotency.
create or replace function public.fnb_print_enqueue_v2(
  p_branch uuid, p_id uuid, p_route text, p_label text, p_paper text, p_bytes text,
  p_prepare_ms integer, p_render_ms integer, p_encode_ms integer
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_result jsonb;
begin
  if p_prepare_ms is null or p_prepare_ms not between 0 and 60000
    or p_render_ms is null or p_render_ms not between 0 and 120000
    or p_encode_ms is null or p_encode_ms not between 0 and 60000 then
    raise exception 'INVALID_PRINT_TIMING';
  end if;
  v_result := public.fnb_print_enqueue_v1(p_branch,p_id,p_route,p_label,p_paper,p_bytes);
  update public.fnb_print_jobs
    set preparation_ms = jsonb_build_object('prepare',p_prepare_ms,'render',p_render_ms,'encode',p_encode_ms)
    where id=p_id and branch_id=p_branch and actor_id=auth.uid()
      and preparation_ms is null and status='queued';
  return v_result;
end $$;

revoke all on function public.fnb_print_routes_v1(uuid) from public, anon;
revoke all on function public.fnb_print_enqueue_v2(uuid,uuid,text,text,text,text,integer,integer,integer) from public, anon;
grant execute on function public.fnb_print_routes_v1(uuid) to authenticated;
grant execute on function public.fnb_print_enqueue_v2(uuid,uuid,text,text,text,text,integer,integer,integer) to authenticated;
commit;
