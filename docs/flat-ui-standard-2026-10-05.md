# Chuẩn giao diện phẳng — ERP và POS

Người dùng duyệt phong cách POS/giỏ phẳng và yêu cầu đồng nhất kiểu thiết kế toàn web ngày 05/10/2026. Đây là chuẩn giao diện, không thay đổi nghiệp vụ.

- **Nền:** surface trung tính; panel dùng `bg-card`/`bg-surface-container-lowest`. Màu primary dành cho điều khiển đang chọn, tổng quan trọng và hành động chính. Giữ màu trạng thái kèm nhãn chữ.
- **Phân cấp màu:** tiêu đề trang dùng primary, tiêu đề section dùng foreground đậm; nút chính nền primary và chữ primary-foreground, nút phụ viền nhẹ. Tab đang chọn có nền primary nhẹ. Trạng thái giữ token success/warning/error kèm chữ, không dùng màu đơn lẻ để truyền tải ý nghĩa. Giữ màu thương hiệu do người dùng thiết lập.
- **Section:** đường phân cách mảnh, góc khoảng 8px; tránh thêm thẻ nền và viền quanh từng phần con. `Card` mặc định phẳng, không đổ bóng. `ambient-shadow` ở trạng thái nghỉ là không bóng; dialog, sheet và menu dùng `ambient-shadow-floating` để phân biệt lớp nổi.
- **Chữ:** nội dung và điều khiển 14px; tên/giá món POS 16px; chữ phụ ít nhất 12px. Tiêu đề trang 20–24px. Không thu nhỏ chữ để ép tên hay số tiền vào ô. Giữ tên đầy đủ trong chi tiết khi dòng chính có giới hạn hai dòng.
- **Khoảng cách:** 8–12px trong panel, 12–16px giữa các section. Bảng và PageHeader mặc định `compact`; caller vẫn có thể chọn mật độ rộng hơn khi cần. Không đổi chiều cao hàng có bộ cuộn ảo nếu chưa sửa đồng bộ phép đo.
- **Nút:** kích thước desktop gọn; thiết bị `pointer: coarse` dùng vùng bấm ít nhất 44px. Giữ focus ring, trạng thái disabled, nhãn truy cập và hỗ trợ bàn phím.
- **Tab/badge:** góc nhỏ, nền nhẹ khi chọn; tránh nhiều pill/khung nền lồng nhau. Avatar vẫn được bo tròn.
- **Giỏ FnB:** tên, số lượng, thành tiền và nút thao tác cùng hàng chính. Mở tăng/giảm/sửa/xóa khi cần; size, tùy chọn, topping, ghi chú và trạng thái bếp vẫn hiển thị. Thành tiền lấy từ trạng thái đơn, không tự tính trong component trình bày.
- **Chủ đề:** dùng token, giữ cài đặt giao diện và dark mode hiện có. Không thay phóng to/thu nhỏ, màu thương hiệu do người dùng chọn, hoặc bố cục in bằng việc chuẩn hóa panel.

Rà soát lần này chuẩn hóa literal `className` bằng TypeScript AST, cùng thành phần dùng chung. Không thay callback, truy vấn, phép tính, dữ liệu hay bản đồ vị trí bàn. Đối chiếu AST trước/sau để xác nhận các trang chỉ đổi lớp trình bày. Kiểm thử đại diện ở desktop/tablet/mobile, sáng/tối, dialog/menu và các hành vi dùng chung trước phát hành.
