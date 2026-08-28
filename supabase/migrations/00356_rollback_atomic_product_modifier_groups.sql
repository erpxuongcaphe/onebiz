-- Hoàn tác 00356. Không sửa liên kết tuỳ chọn hay dữ liệu món hiện có.

begin;

drop function if exists public.save_product_modifier_groups_atomic(uuid, uuid[]);

commit;

notify pgrst, 'reload schema';
