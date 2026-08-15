-- ============================================================================
-- PREFLIGHT F1c.1 — trước khi vá WITH CHECK ảnh nền sơ đồ (00326). CHỈ ĐỌC.
--
-- Chạy trong Supabase SQL Editor, trả về một bảng text duy nhất.
-- Mục đích: (a) chụp lại luật hiện tại để đối chiếu sau khi vá; (b) chứng minh
-- ràng buộc mới KHÔNG chặn oan dữ liệu đang có.
-- ============================================================================

select * from (

  -- A. Luật hiện tại của bucket ảnh nền — đặc biệt xem WITH CHECK của UPDATE
  select 1 as stt, 'A. LUẬT HIỆN TẠI' as muc,
         p.policyname || ' | lệnh=' || p.cmd
           || ' | điều kiện=' || coalesce(replace(p.qual, E'\n', ' '), '-')
           || ' | điều kiện ghi=' || coalesce(replace(p.with_check, E'\n', ' '), '-')
           as ket_qua
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
    and p.policyname like 'floor_plans%'

  union all
  -- B. Số tệp đang có (siết lúc còn ít là an toàn nhất)
  select 2, 'B. SỐ TỆP ẢNH NỀN', count(*)::text || ' tệp'
  from storage.objects where bucket_id = 'floor-plans'

  union all
  -- C. Tệp hiện có (nếu có) có khớp khuôn {tenant}/{branch}/{zone}.{ext} không?
  --    Dòng nào "KHỚP=false" sẽ bị luật mới chặn ghi đè → phải xử lý trước.
  select 3, 'C. TỆP CÓ KHỚP KHUÔN?',
         o.name
           || ' | đủ 2 cấp thư mục=' || (array_length(storage.foldername(o.name),1) = 2)::text
           || ' | thư mục 1 là công ty có thật='
           || exists(select 1 from public.tenants t
                     where t.id::text = (storage.foldername(o.name))[1])::text
           || ' | khu thuộc đúng chi nhánh='
           || exists(select 1 from public.floor_plan_zones z
                     where z.id::text = split_part(storage.filename(o.name), '.', 1)
                       and z.branch_id::text = (storage.foldername(o.name))[2])::text
  from storage.objects o where o.bucket_id = 'floor-plans'

  union all
  -- D. Khu sơ đồ hiện có + chi nhánh của nó (đường dẫn hợp lệ trong tương lai)
  select 4, 'D. KHU SƠ ĐỒ HIỆN CÓ',
         z.name || ' | khu=' || z.id::text || ' | chi nhánh=' || b.name
           || ' | đường dẫn hợp lệ: ' || z.tenant_id::text || '/' || z.branch_id::text
           || '/' || z.id::text || '.jpg'
  from public.floor_plan_zones z
  join public.branches b on b.id = z.branch_id
  where z.is_active

  union all
  -- E. Khu nào có chi nhánh KHÁC tenant của khu → dữ liệu hỏng, luật mới sẽ chặn
  select 5, 'E. KHU LỆCH CÔNG TY/CHI NHÁNH',
         coalesce(
           (select string_agg(z.id::text, ', ')
            from public.floor_plan_zones z
            join public.branches b on b.id = z.branch_id
            where z.tenant_id <> b.tenant_id),
           'KHÔNG CÓ — an toàn')

  union all
  -- F. Hàm nền mà luật mới sẽ gọi
  select 6, 'F. HÀM NỀN',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('get_user_tenant_id','user_has_permission',
                      'user_has_branch_access','fnb_floor_plan_object_writable')

  union all
  -- G. Hàm tách đường dẫn của Storage phải tồn tại
  select 7, 'G. HÀM STORAGE',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'storage' and p.proname in ('foldername','filename')

) t order by stt, ket_qua;
