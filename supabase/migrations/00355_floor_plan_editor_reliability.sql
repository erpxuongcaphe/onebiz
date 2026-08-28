-- ============================================================================
-- 00355 — Sơ đồ bàn: cho phép kích thước mẫu mảnh của giao diện
--
-- Cửa, cửa sổ, TV và tường có mẫu chiều cao 8–16px. RPC 00323 đã cho phép
-- kích thước từ 4px, nhưng CHECK cũ của bảng vẫn bắt tối thiểu 20px nên nút
-- "Thêm" báo lỗi sau khi người dùng bấm. Migration này chỉ đồng bộ ràng buộc
-- dữ liệu với giới hạn đã có ở lớp máy chủ.
--
-- KHÔNG ĐỤNG: bàn, khu, đồ trang trí hiện có, ảnh nền, đơn FnB, tồn kho,
-- hóa đơn hoặc dữ liệu kinh doanh.
-- ============================================================================

begin;

do $prerequisite$
begin
  if to_regclass('public.floor_plan_decorations') is null
     or to_regprocedure('public.fnb_floor_decoration_config_atomic(text,jsonb)') is null then
    raise exception using errcode = 'P0001', message = 'FLOOR_PLAN_00355_PREREQUISITE_MISSING';
  end if;
end;
$prerequisite$;

-- Các giá trị đang có đều hợp lệ với biên mới rộng hơn. Chỉ thay CHECK để
-- tương thích với preset cửa/cửa sổ/TV/tường và resize tối thiểu 4px.
alter table public.floor_plan_decorations
  drop constraint if exists floor_plan_decorations_width_check,
  drop constraint if exists floor_plan_decorations_height_check;

alter table public.floor_plan_decorations
  add constraint floor_plan_decorations_width_check check (width between 4 and 2000),
  add constraint floor_plan_decorations_height_check check (height between 4 and 2000);

do $postcheck$
declare
  v_width_check text;
  v_height_check text;
begin
  select pg_get_constraintdef(c.oid) into v_width_check
    from pg_constraint c
   where c.conrelid = 'public.floor_plan_decorations'::regclass
     and c.conname = 'floor_plan_decorations_width_check';
  select pg_get_constraintdef(c.oid) into v_height_check
    from pg_constraint c
   where c.conrelid = 'public.floor_plan_decorations'::regclass
     and c.conname = 'floor_plan_decorations_height_check';

  if coalesce(v_width_check, '') not like '%4%' or coalesce(v_height_check, '') not like '%4%' then
    raise exception using errcode = 'P0001', message = 'FLOOR_PLAN_00355_CONSTRAINT_POSTCHECK_FAILED';
  end if;
end;
$postcheck$;

commit;

notify pgrst, 'reload schema';
