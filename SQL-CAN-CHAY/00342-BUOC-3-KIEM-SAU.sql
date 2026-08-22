-- ============================================================================
-- 00342 BƯỚC 3 — KIỂM SAU (CHỈ ĐỌC). Chạy SAU khi đã chạy BƯỚC 2.
--
-- ⚠️ ĐỌC CỘT `loai` TRƯỚC KHI ĐÁNH GIÁ:
--
--   loai = 'ĐIỀU KIỆN'  → cột ket_qua PHẢI bắt đầu bằng chữ ĐẠT.
--                         Có một dòng LỆCH là DỪNG, không tự hoàn tác, báo
--                         nguyên văn.  (K1, K2, K2b, K2c, K3, K6b, K7, K7b)
--
--   loai = 'THÔNG TIN'  → chỉ là SỐ LIỆU để đối chiếu, KHÔNG có chữ ĐẠT và
--                         KHÔNG phải lỗi.  (K4, K5, K5b, K6, K7c)
--
-- ⚠️ K7/K7b/K7c chỉ có nghĩa trên PRODUCTION (nơi tồn tại đúng 4 mã đó). Chạy
-- trên nền thử nghiệm không có 4 mã này thì K7b ra "LỆCH · 0" — đó KHÔNG phải
-- lỗi của bản vá, chỉ là nền thử không có dữ liệu đó.
--
-- Cách đối chiếu số liệu với BƯỚC 1:
--   K5  phải bằng  P4 "sau điều kiện → CÒN hiện"
--   K6  phải bằng  P4 "sau điều kiện → BỊ ẨN"  (và bằng A1 + A2 ở P2)
--   K4  phải bằng  nhóm A3 ở P2 của BƯỚC 1
--
-- Ý chính cần chứng minh: KPI (RPC) và DANH SÁCH (client) đếm CÙNG một tập
-- dòng. K1 kiểm RPC đã mang mệnh đề; K3/K5/K6 kiểm tập dòng theo đúng công
-- thức mà client dùng.
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
  -- ══ ĐIỀU KIỆN — phải ĐẠT hết ════════════════════════════════════════════
  select 'K1' as muc, 'ĐIỀU KIỆN' as loai,
         'RPC KPI đã mang mệnh đề lọc chứng từ bán' as chi_tieu,
         (select case when position('i.source IS DISTINCT FROM ''order''' in def) > 0
                      then 'ĐẠT' else 'LỆCH' end from dinh_nghia) as ket_qua, 1 as tt
  union all
  select 'K2', 'ĐIỀU KIỆN', 'RPC vẫn giữ bản ngày hoá đơn 00339 (ISSUED_AT_00335)',
         (select case when position('ISSUED_AT_00335' in def) > 0 then 'ĐẠT' else 'LỆCH' end
          from dinh_nghia), 2
  union all
  select 'K2b', 'ĐIỀU KIỆN', 'RPC có marker CHUNG_TU_BAN_00342',
         (select case when position('CHUNG_TU_BAN_00342' in def) > 0 then 'ĐẠT' else 'LỆCH' end
          from dinh_nghia), 3
  union all
  select 'K2c', 'ĐIỀU KIỆN', 'RPC KHÔNG dùng so sánh <> (không an toàn NULL)',
         (select case when def ~ 'i\.source\s*<>\s*''order''' then 'LỆCH' else 'ĐẠT' end
          from dinh_nghia), 4
  union all
  select 'K3', 'ĐIỀU KIỆN', 'đơn đặt hàng còn lọt vào trang Hoá đơn (phải 0)',
         (select case when count(*) = 0 then 'ĐẠT · 0'
                      else 'LỆCH · ' || count(*)::text end
          from i where la_chung_tu_ban and source = 'order'
                   and (order_code is null or order_code = '')), 5
  union all
  select 'K6b', 'ĐIỀU KIỆN', 'mọi dòng BỊ ẨN đều là source=order chưa chuyển mã',
         (select case when count(*) filter (
                        where not (source = 'order' and (order_code is null or order_code = ''))
                      ) = 0 then 'ĐẠT' else 'LỆCH' end
          from i where not la_chung_tu_ban), 6
  union all
  select 'K7', 'ĐIỀU KIỆN', 'DH000055–58 còn hiện ở trang Hoá đơn (phải 0)',
         (select case when count(*) = 0 then 'ĐẠT · 0' else 'LỆCH · ' || count(*)::text end
          from i where code in ('DH000055','DH000056','DH000057','DH000058')
                   and la_chung_tu_ban), 7
  union all
  select 'K7b', 'ĐIỀU KIỆN', 'bốn đơn đó vẫn còn nguyên trong bảng, KHÔNG bị xoá',
         (select case when count(*) = 4 then 'ĐẠT · 4' else 'LỆCH · ' || count(*)::text end
          from i where code in ('DH000055','DH000056','DH000057','DH000058')), 8

  -- ══ THÔNG TIN — chỉ là số liệu, KHÔNG có chữ ĐẠT, KHÔNG phải lỗi ════════
  union all
  select 'K4', 'THÔNG TIN', 'hoá đơn chuyển TẠI CHỖ còn lại (so với A3 ở BƯỚC 1)',
         (select count(*)::text || ' hoá đơn' from i
          where source = 'order' and order_code is not null and order_code <> ''
            and la_chung_tu_ban), 9
  union all
  select 'K5', 'THÔNG TIN', 'tập dòng trang Hoá đơn sau khi lọc (so với P4 CÒN hiện)',
         (select count(*)::text from i where la_chung_tu_ban), 10
  union all
  select 'K5b', 'THÔNG TIN', 'trong đó hoàn thành / đã huỷ',
         (select count(*) filter (where status = 'completed')::text || ' / '
               || count(*) filter (where status = 'cancelled')::text
          from i where la_chung_tu_ban), 11
  union all
  select 'K6', 'THÔNG TIN', 'số dòng BỊ ẨN (so với P4 BỊ ẨN = A1 + A2)',
         (select count(*)::text from i where not la_chung_tu_ban), 12
  union all
  select 'K7c', 'THÔNG TIN', 'trạng thái bốn đơn (phải vẫn là draft, không bị đổi)',
         (select coalesce(string_agg(distinct status, ', '), '(không thấy)') from i
          where code in ('DH000055','DH000056','DH000057','DH000058')), 13
) x order by tt;
