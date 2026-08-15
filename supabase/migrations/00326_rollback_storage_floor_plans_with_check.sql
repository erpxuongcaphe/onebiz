-- ============================================================================
-- ROLLBACK 00326 — trả luật ghi ảnh nền về đúng bản 00325
--
-- Sau khi chạy tệp này, lỗ cũ quay lại: WITH CHECK của UPDATE chỉ kiểm công ty
-- nên người có quyền ở chi nhánh A đổi được tên tệp sang thư mục chi nhánh B.
-- Chỉ chạy khi 00326 gây trục trặc thật và cần lui gấp.
-- ============================================================================

drop policy if exists floor_plans_insert on storage.objects;
drop policy if exists floor_plans_update on storage.objects;
drop policy if exists floor_plans_delete on storage.objects;

create policy floor_plans_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'floor-plans'
  and (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  and (
    public.user_has_permission(auth.uid(), 'floor_plan.edit_global')
    or (
      public.user_has_permission(auth.uid(), 'floor_plan.edit_branch')
      and public.user_has_branch_access(
            auth.uid(), ((storage.foldername(name))[2])::uuid)
    )
  )
);

create policy floor_plans_update on storage.objects
for update to authenticated
using (
  bucket_id = 'floor-plans'
  and (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  and (
    public.user_has_permission(auth.uid(), 'floor_plan.edit_global')
    or (
      public.user_has_permission(auth.uid(), 'floor_plan.edit_branch')
      and public.user_has_branch_access(
            auth.uid(), ((storage.foldername(name))[2])::uuid)
    )
  )
)
with check (
  bucket_id = 'floor-plans'
  and (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

create policy floor_plans_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'floor-plans'
  and (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  and (
    public.user_has_permission(auth.uid(), 'floor_plan.edit_global')
    or (
      public.user_has_permission(auth.uid(), 'floor_plan.edit_branch')
      and public.user_has_branch_access(
            auth.uid(), ((storage.foldername(name))[2])::uuid)
    )
  )
);

drop function if exists public.fnb_floor_plan_object_writable(text);

do $$
begin
  raise notice 'Rollback 00326: da tra 3 policy ghi ve ban 00325 va go ham kiem';
end $$;
