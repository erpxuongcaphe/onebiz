# Kế hoạch RLS theo cụm

## Mục tiêu

Khôi phục RLS bằng các đợt nhỏ, đo được và có đường lui. Không coi số bảng
đang tắt RLS là bằng chứng một lỗ hổng cụ thể; phải đối chiếu catalog
production, grant hiệu lực, policy sống và đường app đang dùng.

## Dữ liệu cần có trước khi viết migration

1. Chạy `docs/qc/sql/RLS-TOAN-CUC-PREFLIGHT-READONLY.sql` để lấy P1-P5.
2. Chạy `docs/PREFLIGHT-WEB-TABLE-ACCESS-2026-08-03.sql` để đối chiếu mọi
   thao tác trực tiếp từ web với grant và policy hiện có.
3. Đọc lại `docs/qc/sql/RLS-PREFLIGHT-READONLY.sql` cho nhóm bảng nhạy cảm
   đã được khoanh vùng từ hai kết quả trên.

Ba file đều chỉ đọc. Không file nào cần `tenant_id` hay đọc dòng hóa đơn,
khách hàng, kho, tiền thực tế.

## Quy tắc không thay đổi

- Không bật RLS hàng loạt và không tái sử dụng `00241` đã bị thu hồi.
- Không thêm policy theo tenant để "đủ CRUD". Policy permissive được nối bằng
  OR; một policy rộng hơn có thể nới quyền.
- Sổ kho, sổ quỹ, điểm, coupon usage và audit log chỉ được xét theo bất biến
  riêng: đọc/thêm qua đúng luồng, không cấp sửa/xóa trực tiếp cho client.
- Bảng theo người dùng như thông báo, yêu thích, saved view phải giữ điều kiện
  `user_id`, không được thay bằng tenant-wide.
- Bảng con phải kiểm qua quan hệ cha thật, không tự suy diễn cột `tenant_id`.
- Mỗi cụm cần migration mới, rollback riêng, postflight SQL và UAT giới hạn.

## Thứ tự dự kiến sau khi có preflight

1. **Cụm A - dữ liệu cá nhân ít rủi ro:** favorites, notifications,
   customer_saved_views và các bảng tương đương. Chỉ khi P2/P4 xác minh khóa
   người dùng và mã web có đủ handling lỗi.
2. **Cụm B - danh mục đọc nhiều:** categories, products, suppliers, customers,
   bảng giá và các bảng con. Chỉ dùng policy đúng tenant/parent đang có bằng
   chứng; kiểm toàn bộ tìm kiếm, lọc, export ở tối thiểu hai vai trò.
3. **Cụm C - chứng từ:** invoices, đơn bán/mua, trả hàng, giao hàng và các
   item con. UAT tạo/lưu/hoàn tất/hủy trên môi trường cách ly trước; production
   chỉ bật khi có postflight và cửa sổ vận hành phù hợp.
4. **Cụm D - kho, tiền và audit:** stock_movements, branch_stock,
   cash_transactions, product_lots, loyalty ledger, audit_log. Đây là cụm cuối
   cùng, chạy giờ vắng, có đối chiếu tồn - quỹ - audit trước/sau và rollback
   không sửa dữ liệu nghiệp vụ.

## Cổng dừng

Dừng, không viết migration cho cụm nào khi có một trong các điểm sau:

- P2 có bảng không rõ owner, scope hoặc cột khóa;
- P3 còn grant `anon`/`PUBLIC` chưa giải thích được;
- P4 không có policy cùng bản chất để kế thừa hoặc có policy permissive rộng;
- web còn ghi thẳng vào bảng sổ cái hoặc bảng cấu hình nhạy cảm;
- không có kịch bản UAT an toàn cho cụm đó.

Kết quả của đợt này chỉ là bản đồ và kế hoạch. Việc bật RLS phải được duyệt
riêng sau khi có catalog production thật.
