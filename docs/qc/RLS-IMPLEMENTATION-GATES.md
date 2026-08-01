# Cổng an toàn trước khi bật RLS

## Quyết định hiện tại

- Không chạy `00241_rls_layer2_batch2.sql`.
- Không thêm policy để “đủ bốn lệnh” cho mọi bảng.
- Không bật RLS đồng loạt khi chưa đọc policy sống trên DB.
- Không dùng một lần bán thử làm bằng chứng duy nhất.

## Thứ tự triển khai

1. Chạy `docs/qc/sql/RLS-PREFLIGHT-READONLY.sql` và lưu bốn bảng kết quả.
2. Đối chiếu policy sống với các luồng ghi trong `DATA-FLOW-MAP.md`.
3. Chốt quyền cho từng bảng theo loại:
   - hồ sơ của mình;
   - dữ liệu theo người dùng;
   - dữ liệu theo tenant;
   - bảng con lọc qua bảng cha;
   - sổ cái chỉ thêm và đọc;
   - bảng backup chặn client.
4. Tạo policy trước nhưng chưa bật RLS.
5. Test bằng hai tài khoản của hai tenant và ít nhất hai vai trò trong môi trường
   cách ly.
6. Bật theo cụm nhỏ:
   - dữ liệu phụ ít rủi ro;
   - người dùng và thông báo;
   - chứng từ bán/mua;
   - tiền và kho vào giờ vắng.
7. Mỗi cụm có SQL kiểm tra, SQL tắt RLS và danh sách UAT riêng.

## UAT bắt buộc cho cụm tiền và kho

- Bán POS mới và mở lại đơn nháp cũ.
- Tạo, sửa, hoàn tất và hủy phiếu nhập theo trạng thái cho phép.
- Thu tiền hóa đơn, chi tiền phiếu nhập và hủy giao dịch đúng quyền.
- Tạo và hoàn tất kiểm kho, chuyển kho, trả hàng.
- Xác nhận tồn chi nhánh, thẻ kho, sổ quỹ, công nợ và audit cùng khớp.
- Tài khoản tenant A không đọc hoặc ghi được ID của tenant B.
- Nhân viên bị thu hồi quyền không thể dùng API trực tiếp dù nút đã bị ẩn.

Chỉ khi toàn bộ cổng trên đạt mới đưa migration bật RLS vào production.
