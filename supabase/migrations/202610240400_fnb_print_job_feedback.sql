begin;
set local lock_timeout='2s';
-- Read-only, permission/branch-scoped status. No credential, raster or physical printer access.
create or replace function public.fnb_print_jobs_status_v1(p_branch uuid,p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare v_tenant uuid; v_point jsonb; v_jobs jsonb;
begin
  v_tenant:=public._fnb_print_access_v1(p_branch);
  if p_ids is null or cardinality(p_ids)<1 or cardinality(p_ids)>100 or array_ndims(p_ids)>1 then
    raise exception 'Danh sách lệnh in không hợp lệ.';
  end if;
  select jsonb_build_object('enabled',p.enabled,'last_seen_at',p.last_seen_at,
    'connected',p.enabled and coalesce(p.last_seen_at>now()-interval '45 seconds',false)) into v_point
    from public.fnb_print_points p where branch_id=p_branch and tenant_id=v_tenant;
  select coalesce(jsonb_agg(j order by j.created_at,j.id),'[]') into v_jobs from
    (select id,label,route_label,created_at,actor_name,
      case when status='sending' and claimed_at<now()-interval '2 minutes' then 'unknown' else status end as status,
      case when status='sending' and claimed_at<now()-interval '2 minutes' then 'Điểm in mất xác nhận. Kiểm tra giấy trước khi in lại.' else message end as message
     from public.fnb_print_jobs where tenant_id=v_tenant and branch_id=p_branch and id=any(p_ids)) j;
  return jsonb_build_object('point',v_point,'jobs',v_jobs);
end $$;
revoke all on function public.fnb_print_jobs_status_v1(uuid,uuid[]) from public,anon;
grant execute on function public.fnb_print_jobs_status_v1(uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
