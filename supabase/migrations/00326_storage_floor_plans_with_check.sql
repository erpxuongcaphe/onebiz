-- ============================================================================
-- 00326 — F1c.1: vá WITH CHECK của luật ghi ảnh nền sơ đồ bàn
--
-- LỖ CÒN LẠI SAU 00325 (CEO chỉ ra khi kiểm độc lập):
--   Policy UPDATE của bucket "floor-plans" có USING kiểm đủ (công ty + quyền +
--   chi nhánh trên ĐƯỜNG DẪN CŨ), nhưng WITH CHECK chỉ kiểm công ty. Trong
--   Storage, UPDATE cho phép đổi luôn cột `name` (đổi tên/di chuyển tệp) →
--   người chỉ có floor_plan.edit_branch ở chi nhánh A vẫn đẩy được ảnh sang
--   thư mục chi nhánh B của cùng công ty. Lỗ nhỏ nhưng thật.
--
-- 00326 làm:
--   1. Gom toàn bộ điều kiện ghi vào MỘT hàm `fnb_floor_plan_object_writable`
--      để USING và WITH CHECK dùng CHUNG một bộ kiểm — không còn cửa nào lỏng
--      hơn cửa nào, và lần sau sửa chỉ phải sửa một chỗ.
--   2. Siết thêm theo yêu cầu: đường dẫn phải đúng khuôn
--      {tenant_id}/{branch_id}/{zone_id}.{ext}; chi nhánh phải tồn tại và
--      thuộc đúng công ty; khu sơ đồ phải tồn tại, thuộc đúng công ty VÀ đúng
--      chi nhánh đó.
--   3. Dựng lại 3 policy ghi (insert/update/delete) trên nền hàm này.
--
-- KHÔNG đụng bucket product-images / mkt-media, KHÔNG xoá tệp, KHÔNG sửa dữ liệu.
-- Policy SELECT của 00325 giữ nguyên (đọc trong phạm vi công ty).
-- ============================================================================

-- ── 1. Hàm kiểm dùng chung cho mọi cửa ghi ──
create or replace function public.fnb_floor_plan_object_writable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor    uuid;
  v_tenant   uuid;
  v_parts    text[];
  v_branch   uuid;
  v_zone     uuid;
  v_file     text;
  v_uuid_re  constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  v_actor := auth.uid();
  if v_actor is null then
    return false;
  end if;

  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    return false;
  end if;

  -- Khuôn đường dẫn: đúng 2 cấp thư mục + 1 tên tệp.
  v_parts := storage.foldername(p_name);
  if v_parts is null or array_length(v_parts, 1) is distinct from 2 then
    return false;
  end if;

  -- Thư mục cấp 1 = công ty của chính người gọi.
  if v_parts[1] !~ v_uuid_re or v_parts[1] <> v_tenant::text then
    return false;
  end if;

  -- Thư mục cấp 2 = chi nhánh, phải là uuid hợp lệ.
  if v_parts[2] !~ v_uuid_re then
    return false;
  end if;
  v_branch := v_parts[2]::uuid;

  -- Tên tệp = {zone_id}.{ext}
  v_file := storage.filename(p_name);
  if v_file is null or position('.' in v_file) = 0 then
    return false;
  end if;
  if split_part(v_file, '.', 1) !~ v_uuid_re then
    return false;
  end if;
  v_zone := split_part(v_file, '.', 1)::uuid;

  -- Chi nhánh phải tồn tại và thuộc đúng công ty.
  if not exists (
    select 1 from public.branches b
    where b.id = v_branch and b.tenant_id = v_tenant
  ) then
    return false;
  end if;

  -- Khu sơ đồ phải tồn tại, thuộc đúng công ty VÀ đúng chi nhánh trên đường dẫn.
  if not exists (
    select 1 from public.floor_plan_zones z
    where z.id = v_zone
      and z.tenant_id = v_tenant
      and z.branch_id = v_branch
  ) then
    return false;
  end if;

  -- Quyền: toàn tenant, hoặc theo chi nhánh được gán.
  if public.user_has_permission(v_actor, 'floor_plan.edit_global') then
    return true;
  end if;
  if public.user_has_permission(v_actor, 'floor_plan.edit_branch')
     and public.user_has_branch_access(v_actor, v_branch) then
    return true;
  end if;

  return false;
end $$;

revoke all on function public.fnb_floor_plan_object_writable(text) from public, anon;
grant execute on function public.fnb_floor_plan_object_writable(text) to authenticated;

comment on function public.fnb_floor_plan_object_writable(text) is
  'F1c.1 00326: dieu kien ghi anh nen so do ban. Dung chung cho USING va WITH CHECK cua policy storage.objects bucket floor-plans.';

-- ── 2. Dựng lại 3 policy ghi trên nền hàm dùng chung ──
drop policy if exists floor_plans_insert on storage.objects;
drop policy if exists floor_plans_update on storage.objects;
drop policy if exists floor_plans_delete on storage.objects;

create policy floor_plans_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'floor-plans'
  and public.fnb_floor_plan_object_writable(name)
);

-- USING: được phép đụng vào tệp ĐANG có ở đường dẫn cũ.
-- WITH CHECK: đường dẫn MỚI cũng phải qua ĐÚNG bộ kiểm đó → không đổi tên tệp
-- sang chi nhánh khác được nữa.
create policy floor_plans_update on storage.objects
for update to authenticated
using (
  bucket_id = 'floor-plans'
  and public.fnb_floor_plan_object_writable(name)
)
with check (
  bucket_id = 'floor-plans'
  and public.fnb_floor_plan_object_writable(name)
);

create policy floor_plans_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'floor-plans'
  and public.fnb_floor_plan_object_writable(name)
);

-- ── 3. Hậu kiểm ngay trong migration ──
do $$
declare
  v_count int;
begin
  select count(*) into v_count from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('floor_plans_select','floor_plans_insert',
                       'floor_plans_update','floor_plans_delete');
  if v_count <> 4 then
    raise exception '00326 that bai: chi co % / 4 policy floor_plans_*', v_count;
  end if;

  -- UPDATE phải có CẢ hai vế và cả hai đều gọi hàm kiểm.
  select count(*) into v_count from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'floor_plans_update'
    and qual like '%fnb_floor_plan_object_writable%'
    and with_check like '%fnb_floor_plan_object_writable%';
  if v_count <> 1 then
    raise exception '00326 that bai: policy UPDATE chua kiem du ca USING lan WITH CHECK';
  end if;

  select count(*) into v_count from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname like 'product_images%';
  if v_count <> 4 then
    raise exception '00326 that bai: policy product-images bi anh huong (con %)', v_count;
  end if;

  raise notice '00326: OK — USING va WITH CHECK dung chung mot bo kiem (cong ty + chi nhanh + khu + quyen)';
end $$;
