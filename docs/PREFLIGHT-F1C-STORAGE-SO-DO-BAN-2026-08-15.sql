-- ============================================================================
-- PREFLIGHT F1c — ảnh nền sơ đồ bàn (bucket "floor-plans"). CHỈ ĐỌC.
--
-- Chạy trong Supabase SQL Editor. Trả về MỘT bảng text để không bị mất kết quả
-- (SQL Editor chỉ hiện kết quả của câu lệnh cuối cùng).
--
-- Mục đích: biết chính xác các luật (policy) đang gác việc ghi ảnh nền, trước
-- khi siết ở migration 00325. KHÔNG sửa gì.
-- ============================================================================

select * from (

  -- 1. Bucket: công khai hay không, có giới hạn dung lượng / loại tệp không
  select 1 as stt, 'A. BUCKET' as muc,
         b.id || ' | công khai=' || b.public
           || ' | giới hạn dung lượng=' || coalesce(b.file_size_limit::text, 'KHÔNG')
           || ' | loại tệp cho phép=' || coalesce(array_to_string(b.allowed_mime_types, ','), 'KHÔNG')
           as ket_qua
  from storage.buckets b
  where b.id in ('floor-plans','product-images','mkt-media')

  union all
  -- 2. Số tệp đang có trong bucket ảnh nền
  select 2, 'B. SỐ TỆP HIỆN CÓ',
         'floor-plans = ' || count(*)::text || ' tệp'
  from storage.objects o where o.bucket_id = 'floor-plans'

  union all
  -- 3. Mọi policy trên storage.objects (xem cái nào chạm floor-plans)
  select 3, 'C. POLICY storage.objects',
         p.policyname || ' | lệnh=' || p.cmd
           || ' | vai trò=' || array_to_string(p.roles, ',')
           || ' | điều kiện=' || coalesce(replace(p.qual, E'\n', ' '), '-')
           || ' | điều kiện ghi=' || coalesce(replace(p.with_check, E'\n', ' '), '-')
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'

  union all
  -- 4. RLS trên storage.objects có bật không
  select 4, 'D. RLS storage.objects',
         'rowsecurity=' || c.relrowsecurity::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects'

  union all
  -- 5. Các hàm nền F1c sẽ dùng trong policy — phải tồn tại
  select 5, 'E. HÀM NỀN',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('get_user_tenant_id','user_has_permission','user_has_branch_access')

) t order by stt, ket_qua;
