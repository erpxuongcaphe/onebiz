-- ============================================================================
-- 00325 — F1c: siết quyền ghi ảnh nền sơ đồ bàn (bucket "floor-plans")
--
-- HIỆN TRẠNG (preflight 15/08, đã đo trên prod):
--   • Bucket công khai, KHÔNG giới hạn dung lượng, KHÔNG giới hạn loại tệp,
--     đang RỖNG (0 tệp) → siết bây giờ là lúc an toàn nhất.
--   • 3 policy riêng của bucket: floor_plans_select / _insert / _delete, điều
--     kiện duy nhất là "đã đăng nhập" → bất kỳ nhân viên nào của BẤT KỲ công ty
--     nào cũng ghi đè / xoá được ảnh nền của công ty khác.
--   • THIẾU HẲN policy UPDATE. Mã nguồn upload bằng chế độ ghi đè (upsert), nên
--     lần đổi ảnh nền THỨ HAI cho cùng một khu sẽ bị RLS chặn. Chưa ai vấp vì
--     bucket còn rỗng — migration này sửa luôn.
--
-- SAU MIGRATION:
--   • Ghi (thêm/sửa/xoá) chỉ khi: đã đăng nhập + thư mục cấp 1 đúng tenant của
--     người gọi + có quyền floor_plan.edit_global, hoặc floor_plan.edit_branch
--     kèm quyền truy cập chi nhánh ở thư mục cấp 2.
--     Đường dẫn mã nguồn đang dùng: {tenant_id}/{branch_id}/{zone_id}.{ext}
--   • Đọc qua đường dẫn công khai KHÔNG đổi (bucket vẫn public) → ảnh nền vẫn
--     hiển thị bình thường trên sơ đồ.
--   • Bucket nhận thêm giới hạn 5MB + chỉ ảnh (jpeg/png/webp/gif), bằng với
--     bucket product-images đang chạy ổn.
--
-- KHÔNG đụng policy của product-images / mkt-media. Không xoá tệp nào.
-- ============================================================================

-- ── 1. Giới hạn bucket ──
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
where id = 'floor-plans';

-- ── 2. Thay 3 policy cũ (chỉ kiểm "đã đăng nhập") ──
drop policy if exists floor_plans_select on storage.objects;
drop policy if exists floor_plans_insert on storage.objects;
drop policy if exists floor_plans_delete on storage.objects;
drop policy if exists floor_plans_update on storage.objects;

-- Đọc qua API: giới hạn trong phạm vi công ty của người gọi.
create policy floor_plans_select on storage.objects
for select to authenticated
using (
  bucket_id = 'floor-plans'
  and (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

-- Điều kiện ghi dùng chung cho thêm / sửa / xoá.
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

-- UPDATE: policy MỚI — trước đây không có nên ghi đè ảnh nền lần 2 bị chặn.
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

-- ── 3. Hậu kiểm ngay trong migration ──
do $$
declare
  v_count int;
  v_limit bigint;
begin
  select count(*) into v_count from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('floor_plans_select','floor_plans_insert',
                       'floor_plans_update','floor_plans_delete');
  if v_count <> 4 then
    raise exception '00325 that bai: chi co % / 4 policy floor_plans_*', v_count;
  end if;

  select file_size_limit into v_limit from storage.buckets where id = 'floor-plans';
  if v_limit is distinct from 5242880 then
    raise exception '00325 that bai: bucket floor-plans chua co gioi han dung luong';
  end if;

  -- Không được đụng policy của bucket khác
  select count(*) into v_count from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname like 'product_images%';
  if v_count <> 4 then
    raise exception '00325 that bai: policy product-images bi anh huong (con %)', v_count;
  end if;

  raise notice '00325: OK — 4 policy floor_plans_* theo tenant + quyen floor_plan.edit_*, bucket gioi han 5MB/anh';
end $$;
