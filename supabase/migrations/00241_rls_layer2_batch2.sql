-- ============================================================
-- 00241 — ĐÃ THU HỒI, KHÔNG ĐƯỢC CHẠY
--
-- File này TỪNG chứa bước "bật cách ly dữ liệu (RLS) cho 30 bảng còn lại".
-- Rà lại 30/07/2026 phát hiện nó NỚI LỎNG bảo mật ngoài ý muốn, nên nội
-- dung đã được thay bằng chốt chặn bên dưới. Bản gốc vẫn tra được trong
-- lịch sử git (commit 411e352).
--
-- ═══ VÌ SAO NGUY HIỂM ═══
-- Bản cũ tự chế biểu thức `tenant_id = get_user_tenant_id()` cho mọi lệnh
-- còn thiếu. PostgreSQL gộp các quy tắc cùng loại bằng OR → thêm một quy
-- tắc rộng là NỚI quyền, không phải siết:
--   • profiles      — đang chỉ cho tự sửa dòng của mình; thêm xoá theo
--                     tenant ⇒ nhân viên XOÁ ĐƯỢC tài khoản chủ.
--   • audit_log     — đang chỉ-đọc (nhật ký kiểm toán); thêm sửa/xoá ⇒
--                     nhân viên xoá được dấu vết thao tác của chính mình.
--   • stock_movements / loyalty_transactions / coupon_usages — sổ cái bất
--                     biến; thêm sửa/xoá ⇒ client sửa được sổ kho, sổ điểm.
--   • notifications / favorites — đang lọc theo NGƯỜI (user_id); thêm quy
--                     tắc theo tenant ⇒ đọc/xoá được của người khác.
-- Ngoài ra bản cũ bỏ sót bảng `sales_returns`, và dùng `limit 1` để copy
-- một biểu thức bất kỳ áp cho nhiều lệnh khác bản chất.
--
-- ═══ LÀM ĐÚNG THÌ LÀM THẾ NÀO ═══
-- Cách ly dữ liệu vẫn là việc CẦN làm (khoảng 30 bảng chưa bật). Trình tự:
--   1. Chạy docs/qc/sql/RLS-PREFLIGHT-READONLY.sql (chỉ đọc) để lấy trạng
--      thái quy tắc THẬT trên database — tuyệt đối không suy từ file
--      migration, vì migration chạy tay nên thứ tự thực tế có thể khác.
--   2. Tạo quy tắc còn thiếu bằng cách COPY biểu thức CÙNG BẢN CHẤT đã có
--      trên chính bảng đó (pg_get_expr). Không có anh em cùng bản chất thì
--      KHÔNG thêm — giữ nguyên tính bất biến.
--   3. Sổ cái + audit_log: chỉ giữ đọc/thêm. profiles: không cấp thêm/xoá.
--      notifications, favorites: lọc theo user_id. tenants: lọc theo id.
--   4. Bật RLS theo CỤM NHỎ; cụm tiền/kho để sau cùng và vào giờ vắng. Mỗi
--      cụm có SQL đối chiếu + SQL tắt lại + danh sách UAT riêng.
-- Chi tiết: docs/qc/RLS-IMPLEMENTATION-GATES.md
--
-- ⚠️ Giữ nguyên số hiệu 00241 (không tái dùng cho việc khác) để lịch sử
--    migration không lệch. Bước RLS mới phải mang số hiệu MỚI.
-- ============================================================

do $$
begin
  raise exception using
    errcode = 'P0001',
    message = '00241 đã bị thu hồi — KHÔNG chạy file này.',
    detail  = 'Ban cu noi long quyen tren profiles/audit_log/stock_movements/'
              || 'loyalty_transactions/coupon_usages/notifications/favorites '
              || '(PostgreSQL gop quy tac bang OR nen them quy tac = mo quyen).',
    hint    = 'Doc phan dau file nay, roi theo docs/qc/RLS-IMPLEMENTATION-GATES.md. '
              || 'Buoc RLS moi phai dung so hieu migration MOI.';
end $$;

-- ============================================================
-- KIỂM TRA — bản cũ đã từng chạy nhầm chưa? (chỉ đọc, chạy riêng)
--
-- Bản cũ đặt tên mọi quy tắc nó tạo với hậu tố _00241:
--
--   select c.relname as bang, p.polname as quy_tac, p.polcmd as lenh
--   from pg_policy p
--     join pg_class c on c.oid = p.polrelid
--   where p.polname like '%\_00241'
--   order by c.relname, p.polname;
--
-- → 0 dòng  = chưa từng chạy. Không cần làm gì.
-- → có dòng = đã chạy nhầm. Gỡ từng quy tắc trong danh sách bằng
--   `drop policy <quy_tac> on public.<bang>;` rồi báo lại để rà xem
--   khoảng hở đã bị dùng chưa (đọc audit_log quanh mốc thời gian đó).
-- ============================================================
