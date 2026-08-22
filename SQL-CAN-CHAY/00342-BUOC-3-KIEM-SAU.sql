-- ============================================================================
-- 00342 BƯỚC 3 — KIỂM SAU (CHỈ ĐỌC). Chạy SAU khi đã chạy BƯỚC 2.
--
-- Trả về MỘT bảng. Cột `ket_qua` phải ĐẠT ở tất cả các dòng K1–K7.
-- Nếu có dòng LỆCH: dừng, không tự hoàn tác, báo nguyên văn.
--
-- Ý chính cần chứng minh: KPI (RPC) và DANH SÁCH (client) đếm CÙNG một tập
-- dòng. Vì vậy K3/K4 dựng lại đúng công thức của cả hai rồi so nhau.
-- ============================================================================

with dinh_nghia as (
  select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_invoice_list_summary'
    and p.pronargs = 7
),
i as (
  select
    i.status, i.source, i.order_code, i.fulfilled_by_id, i.code,
    (i.source is distinct from 'order' or (i.order_code is not null and i.order_code <> ''))
      as la_chung_tu_ban
  from public.invoices i
  where i.deleted_at is null
)
select * from (
  select 'K1' as muc, 'RPC KPI đã mang mệnh đề lọc chứng từ bán' as chi_tieu,
         (select case when position('i.source IS DISTINCT FROM ''order''' in def) > 0
                      then 'ĐẠT' else 'LỆCH' end from dinh_nghia) as ket_qua, 1 as tt
  union all
  select 'K2', 'RPC vẫn giữ bản ngày hoá đơn 00339 (ISSUED_AT_00335)',
         (select case when position('ISSUED_AT_00335' in def) > 0 then 'ĐẠT' else 'LỆCH' end
          from dinh_nghia), 2
  union all
  select 'K2b', 'RPC có marker CHUNG_TU_BAN_00342',
         (select case when position('CHUNG_TU_BAN_00342' in def) > 0 then 'ĐẠT' else 'LỆCH' end
          from dinh_nghia), 2
  union all
  select 'K2c', 'RPC KHÔNG dùng so sánh <> (không an toàn NULL)',
         (select case when def ~ 'i\.source\s*<>\s*''order''' then 'LỆCH' else 'ĐẠT' end
          from dinh_nghia), 2
  union all
  -- K3: đơn đặt hàng KHÔNG được còn nằm trong tập của trang Hoá đơn
  select 'K3', 'số đơn đặt hàng còn lọt vào trang Hoá đơn (phải 0)',
         (select case when count(*) = 0 then 'ĐẠT · 0'
                      else 'LỆCH · ' || count(*)::text end
          from i where la_chung_tu_ban and source = 'order'
                   and (order_code is null or order_code = '')), 3
  union all
  select 'K4', 'hoá đơn chuyển TẠI CHỖ còn nguyên (phải > 0 nếu BƯỚC 1 có A3)',
         (select count(*)::text || ' hoá đơn' from i
          where source = 'order' and order_code is not null and order_code <> ''
            and la_chung_tu_ban), 4
  union all
  select 'K5', 'tập dòng trang Hoá đơn sau khi lọc',
         (select count(*)::text from i where la_chung_tu_ban), 5
  union all
  select 'K5b', 'trong đó hoàn thành / đã huỷ',
         (select count(*) filter (where status = 'completed')::text || ' / '
               || count(*) filter (where status = 'cancelled')::text
          from i where la_chung_tu_ban), 5
  union all
  select 'K6', 'số dòng BỊ ẨN (phải bằng số đơn đặt hàng còn là đơn)',
         (select count(*)::text from i where not la_chung_tu_ban), 6
  union all
  select 'K6b', 'kiểm chéo: dòng bị ẩn PHẢI đều là source=order chưa chuyển mã',
         (select case when count(*) filter (
                        where not (source = 'order' and (order_code is null or order_code = ''))
                      ) = 0 then 'ĐẠT' else 'LỆCH' end
          from i where not la_chung_tu_ban), 6
  union all
  -- K7: bốn đơn trong ảnh
  select 'K7', 'DH000055–58 còn hiện ở trang Hoá đơn (phải 0)',
         (select case when count(*) = 0 then 'ĐẠT · 0' else 'LỆCH · ' || count(*)::text end
          from i where code in ('DH000055','DH000056','DH000057','DH000058')
                   and la_chung_tu_ban), 7
  union all
  -- K7b/K7c chỉ có nghĩa trên PRODUCTION (nơi tồn tại đúng 4 mã đó). Chạy trên
  -- nền thử nghiệm không có 4 mã này thì K7b ra 0 — đó KHÔNG phải lỗi.
  select 'K7b', 'bốn đơn đó vẫn còn trong bảng, KHÔNG bị xoá/sửa (prod: phải 4)',
         (select case when count(*) = 4 then 'ĐẠT · 4' else 'LỆCH · ' || count(*)::text end
          from i where code in ('DH000055','DH000056','DH000057','DH000058')), 7
  union all
  select 'K7c', 'trạng thái bốn đơn vẫn là draft (không bị đổi)',
         (select string_agg(distinct status, ', ') from i
          where code in ('DH000055','DH000056','DH000057','DH000058')), 7
) x order by tt, muc;
