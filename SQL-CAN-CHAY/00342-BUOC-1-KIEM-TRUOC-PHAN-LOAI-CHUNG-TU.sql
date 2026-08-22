-- ============================================================================
-- 00342 BƯỚC 1 — KIỂM TRƯỚC (CHỈ ĐỌC). Chạy CẢ FILE, dán bảng kết quả.
--
-- MỤC ĐÍCH: chứng minh bằng dữ liệu thật đâu là mốc phân biệt "đơn đặt hàng
-- còn là đơn" với "hoá đơn bán thật", TRƯỚC khi đổi điều kiện đọc.
--
-- ⚠️ ĐIỀU DỄ SAI NHẤT: lọc bằng `source <> 'order'`. Mô hình CŨ hoàn tất đơn
-- TẠI CHỖ (pos_checkout_v3/v5, migration 00169 dòng 118-130): cấp mã HD mới,
-- ghi order_code = mã cũ, nhưng GIỮ source='order'. Những bản ghi đó là HOÁ
-- ĐƠN BÁN THẬT. Mục P2 nhóm `A3` đếm chính xác bao nhiêu bản ghi như vậy —
-- nếu A3 > 0 thì lọc theo source đơn thuần sẽ LÀM MẤT đúng bấy nhiêu hoá đơn.
--
-- File này KHÔNG ghi gì: chỉ SELECT. Một truy vấn duy nhất (Supabase SQL
-- Editor chỉ hiện kết quả của câu lệnh CUỐI).
-- ============================================================================

with i as (
  select
    i.id, i.code, i.order_code, i.source, i.status,
    i.source_order_id, i.fulfilled_by_id, i.deleted_at,
    substring(coalesce(i.code, '') from '^[A-Za-z]+') as tien_to,
    (i.order_code is not null and i.order_code <> '')  as co_order_code,
    (i.source = 'order')                               as la_source_order
  from public.invoices i
  where i.deleted_at is null
),
p as (
  select i.*,
    case
      when la_source_order and not co_order_code and fulfilled_by_id is null
        then 'A1_DH_goc_CHUA_xu_ly'
      when la_source_order and not co_order_code
        then 'A2_DH_goc_DA_xu_ly'
      when la_source_order and co_order_code
        then 'A3_HD_lich_su_chuyen_TAI_CHO'
      when source_order_id is not null
        then 'B1_HD_con_tu_don_dat_hang'
      when tien_to = 'NH'
        then 'B2_nhap_POS_NH'
      else 'B3_HD_ban_thang'
    end as nhom,
    -- ĐIỀU KIỆN ĐỌC DÙNG CHUNG sắp cài (giống hệt bản trong code + RPC 00342)
    (source is distinct from 'order' or (order_code is not null and order_code <> ''))
      as hien_o_trang_hoa_don
  from i
)
select * from (
  -- ── P1. Bức tranh thô: source × tiền tố mã × có order_code ───────────────
  select 'P1' as muc,
         coalesce(source,'(null)') || ' · ' || coalesce(tien_to,'(không chữ)')
           || ' · order_code=' || case when co_order_code then 'có' else 'không' end as chi_tieu,
         count(*)::text as gia_tri, 1 as tt
  from p group by source, tien_to, co_order_code

  -- ── P2. Nhóm chứng từ × status — cột sống của quyết định ─────────────────
  union all
  select 'P2', nhom || ' · ' || status, count(*)::text, 2
  from p group by nhom, status

  -- ── P3. Bất thường — MỌI dòng phải = 0, khác 0 là điều kiện chưa đủ ──────
  union all
  select 'P3', 'X1 mã DH nhưng source KHÁC order',
         count(*) filter (where tien_to = 'DH' and source is distinct from 'order')::text, 3 from p
  union all
  select 'P3', 'X2 source=order + có order_code nhưng mã KHÔNG phải HD',
         count(*) filter (where la_source_order and co_order_code and tien_to <> 'HD')::text, 3 from p
  union all
  select 'P3', 'X3 source=order + KHÔNG order_code nhưng mã KHÔNG phải DH',
         count(*) filter (where la_source_order and not co_order_code and tien_to <> 'DH')::text, 3 from p
  union all
  select 'P3', 'X4 source=order mà lại có source_order_id',
         count(*) filter (where la_source_order and source_order_id is not null)::text, 3 from p
  union all
  select 'P3', 'X5 có fulfilled_by_id nhưng source KHÁC order',
         count(*) filter (where fulfilled_by_id is not null and source is distinct from 'order')::text, 3 from p

  -- ── P4. Điều kiện mới tác động thế nào ───────────────────────────────────
  union all
  select 'P4', 'tổng dòng còn sống (trang Hoá đơn HIỆN NAY hiện)', count(*)::text, 4 from p
  union all
  select 'P4', 'sau điều kiện → CÒN hiện',
         count(*) filter (where hien_o_trang_hoa_don)::text, 4 from p
  union all
  select 'P4', 'sau điều kiện → BỊ ẨN (phải toàn A1/A2)',
         count(*) filter (where not hien_o_trang_hoa_don)::text, 4 from p
  union all
  select 'P4', 'ĐỐI CHỨNG ÂM — nếu lọc ngây thơ source<>order thì MẤT thêm',
         count(*) filter (where la_source_order and co_order_code)::text || ' hoá đơn bán thật', 4 from p

  -- ── P5. Nhóm bị ẩn thuộc đâu — chỉ được có A1/A2 ─────────────────────────
  union all
  select 'P5', 'BỊ ẨN: ' || nhom, count(*)::text, 5
  from p where not hien_o_trang_hoa_don group by nhom

  -- ── P6. Bốn đơn trong ảnh production ─────────────────────────────────────
  union all
  select 'P6', code || ' · ' || nhom,
         'status=' || status
      || ' | order_code=' || coalesce(order_code,'(null)')
      || ' | fulfilled=' || case when fulfilled_by_id is null then '(null)' else 'có' end
      || ' | ' || case when hien_o_trang_hoa_don then 'CÒN HIỆN (SAI)' else 'ẨN (đúng)' end, 6
  from p where code in ('DH000055','DH000056','DH000057','DH000058')
) x order by tt, chi_tieu;
