-- ============================================================================
-- 00372 - Khoa ghi tram bep theo quyen quan tri chi nhanh.
--
-- KDS/POS van duoc SELECT tram de routing. Chi user co
-- system.manage_branches va truy cap dung chi nhanh moi duoc tao/sua/xoa.
-- ============================================================================

drop policy if exists kitchen_stations_tenant_isolation on public.kitchen_stations;
drop policy if exists kitchen_stations_select_00372 on public.kitchen_stations;
drop policy if exists kitchen_stations_insert_00372 on public.kitchen_stations;
drop policy if exists kitchen_stations_update_00372 on public.kitchen_stations;
drop policy if exists kitchen_stations_delete_00372 on public.kitchen_stations;

create policy kitchen_stations_select_00372
  on public.kitchen_stations
  for select
  using (tenant_id = public.get_user_tenant_id());

create policy kitchen_stations_insert_00372
  on public.kitchen_stations
  for insert
  with check (
    tenant_id = public.get_user_tenant_id()
    and public.user_has_permission(auth.uid(), 'system.manage_branches')
    and public.user_has_branch_access(auth.uid(), branch_id)
  );

create policy kitchen_stations_update_00372
  on public.kitchen_stations
  for update
  using (
    tenant_id = public.get_user_tenant_id()
    and public.user_has_permission(auth.uid(), 'system.manage_branches')
    and public.user_has_branch_access(auth.uid(), branch_id)
  )
  with check (
    tenant_id = public.get_user_tenant_id()
    and public.user_has_permission(auth.uid(), 'system.manage_branches')
    and public.user_has_branch_access(auth.uid(), branch_id)
  );

create policy kitchen_stations_delete_00372
  on public.kitchen_stations
  for delete
  using (
    tenant_id = public.get_user_tenant_id()
    and public.user_has_permission(auth.uid(), 'system.manage_branches')
    and public.user_has_branch_access(auth.uid(), branch_id)
  );

do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'kitchen_stations'
    and p.cmd in ('INSERT', 'UPDATE', 'DELETE')
    and (
      coalesce(p.qual, '') not like '%system.manage_branches%'
      and coalesce(p.with_check, '') not like '%system.manage_branches%'
    );
  if v_bad <> 0 then
    raise exception '00372 that bai: con % policy ghi tram bep khong co guard quan tri', v_bad;
  end if;
end $$;

notify pgrst, 'reload schema';
