-- ============================================================================
-- ROLLBACK 00325 — trả policy ảnh nền sơ đồ về đúng hiện trạng trước F1c
--
-- Khôi phục nguyên văn 3 policy đo được ở preflight 15/08 (select/insert/delete,
-- điều kiện duy nhất là đã đăng nhập) và bỏ giới hạn dung lượng / loại tệp.
--
-- LƯU Ý: policy UPDATE vốn KHÔNG tồn tại trước 00325 — rollback gỡ nó đi thì
-- lỗi cũ quay lại (đổi ảnh nền lần thứ hai cho cùng một khu sẽ bị chặn).
-- Nếu chỉ muốn lui phần siết quyền mà GIỮ bản vá đó, hãy bỏ dòng
-- "drop policy ... floor_plans_update" và tự tạo lại policy update rộng.
-- ============================================================================

drop policy if exists floor_plans_select on storage.objects;
drop policy if exists floor_plans_insert on storage.objects;
drop policy if exists floor_plans_update on storage.objects;
drop policy if exists floor_plans_delete on storage.objects;

create policy floor_plans_select on storage.objects
for select
using (bucket_id = 'floor-plans' and auth.role() = 'authenticated');

create policy floor_plans_insert on storage.objects
for insert
with check (bucket_id = 'floor-plans' and auth.role() = 'authenticated');

create policy floor_plans_delete on storage.objects
for delete
using (bucket_id = 'floor-plans' and auth.role() = 'authenticated');

update storage.buckets
set file_size_limit = null, allowed_mime_types = null
where id = 'floor-plans';

do $$
begin
  raise notice 'Rollback 00325: da tra ve 3 policy cu + bo gioi han bucket';
end $$;
