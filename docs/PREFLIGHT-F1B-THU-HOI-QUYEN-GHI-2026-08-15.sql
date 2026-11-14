-- ============================================================================
-- PREFLIGHT F1b — trước khi thu hồi quyền ghi thẳng 3 bảng cấu hình bàn.
-- CHỈ ĐỌC. Chạy trong Supabase SQL Editor, trả về một bảng text.
--
-- Chạy 2 LẦN: một lần TRƯỚC migration (chụp hiện trạng), một lần SAU (đối chiếu).
-- ============================================================================

select * from (

  -- A. Quyền hiện có trên 3 bảng — cái sẽ bị thu hồi
  select 1 as stt, 'A. QUYỀN TRÊN BẢNG' as muc,
         g.table_name || ' | ' || g.grantee || ' | ' || g.privilege_type as ket_qua
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name in ('restaurant_tables','floor_plan_zones','floor_plan_decorations')
    and g.grantee in ('authenticated','anon','public')

  union all
  -- B. 4 RPC của F1a phải còn sống, đúng chữ ký (nếu mất là web gãy ngay sau khi thu hồi)
  select 2, 'B. RPC F1a CÒN SỐNG',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
           || ' | security definer=' || p.prosecdef::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fnb_table_config_atomic','fnb_floor_zone_config_atomic',
                      'fnb_floor_layout_update_atomic','fnb_floor_decoration_config_atomic')

  union all
  -- C. Ai được GỌI 4 RPC đó
  select 3, 'C. QUYỀN GỌI RPC',
         p.proname || ' | ' || coalesce(array_to_string(p.proacl::text[], ' '), 'mặc định')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fnb_table_config_atomic','fnb_floor_zone_config_atomic',
                      'fnb_floor_layout_update_atomic','fnb_floor_decoration_config_atomic')

  union all
  -- D. RPC vận hành bàn (không thuộc F1 nhưng phải còn chạy sau khi thu hồi)
  select 4, 'D. RPC VẬN HÀNH BÀN',
         p.proname || ' | security definer=' || p.prosecdef::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('mark_fnb_table_available_atomic','transfer_fnb_table_atomic',
                      'merge_fnb_tables_atomic','merge_kitchen_orders_atomic')

  union all
  -- E. Số liệu để đối chiếu trước/sau (không được đổi)
  select 5, 'E. SỐ LIỆU ĐỐI CHIẾU',
         'bàn đang hoạt động=' || (select count(*) from public.restaurant_tables where is_active)::text
      || ' | khu sơ đồ=' || (select count(*) from public.floor_plan_zones where is_active)::text
      || ' | trang trí=' || (select count(*) from public.floor_plan_decorations)::text

  union all
  -- F. RLS vẫn bật (F1b KHÔNG đụng RLS — chỉ để chứng minh không đổi)
  select 6, 'F. RLS 3 BẢNG',
         c.relname || ' | rowsecurity=' || c.relrowsecurity::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('restaurant_tables','floor_plan_zones','floor_plan_decorations')

) t order by stt, ket_qua;
