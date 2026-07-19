# Hướng dẫn CEO sử dụng MKT Audit Runner với AI

## Mục đích

Audit Runner giúp AI kiểm tra 10 quy tắc quan trọng của MKT Hub mà không cần tài khoản OneBiz, cookie hoặc phiên Chrome của CEO.

Liên kết dành cho AI chỉ hoạt động với **Audit Sandbox**. Đây là môi trường dữ liệu giả, tách khỏi dữ liệu công ty và không gửi Telegram hoặc email.

## Tạo liên kết cho AI

1. CEO đăng nhập `https://mkthub.onebiz.com.vn/audit-runner`.
2. Xác nhận màn hình hiển thị **Môi trường: Audit Sandbox**.
3. Tại mục **Liên kết kiểm tra dành cho AI CEO**, chọn thời hạn 1 giờ, 4 giờ hoặc 24 giờ.
4. Bấm **Tạo liên kết cho AI**.
5. Bấm **Sao chép** và gửi liên kết vừa tạo cho AI.

Mỗi liên kết được chạy tối đa 3 lượt. Khi tạo liên kết mới, liên kết cũ tự hết hiệu lực.

## Câu lệnh gửi AI

> Mở liên kết Audit Runner tôi gửi. Xác nhận trang ghi “Môi trường: Audit Sandbox”, sau đó bấm “Chạy tất cả”. Chờ hoàn tất và báo cáo tổng số PASS, FAIL, ERROR. Liệt kê từng tình huống không PASS cùng nội dung Thực tế, mã lỗi và trạng thái Nhật ký. Không mở trang khác, không thay đổi quyền hoặc cài đặt.

AI mở liên kết trong môi trường riêng của AI. CEO không cần mở sẵn Chrome và không cần cung cấp tài khoản, mật khẩu hoặc mã xác thực.

## Cách đọc kết quả

- **PASS**: Quy tắc hoạt động đúng.
- **FAIL**: Quy tắc xử lý chưa đúng mong đợi.
- **ERROR**: Môi trường kiểm tra hoặc quá trình chạy gặp lỗi.
- **Nhật ký = Có**: Hành động đã được ghi để đối chiếu.

Kết quả tốt là cả 10 tình huống đều **PASS**, không có **FAIL** hoặc **ERROR**.

## Kết thúc kiểm tra

1. Nhận báo cáo từ AI.
2. Quay lại trang `https://mkthub.onebiz.com.vn/audit-runner`.
3. Bấm **Thu hồi** tại mục liên kết dành cho AI.

Liên kết cũng tự hết hiệu lực khi hết thời hạn hoặc đã dùng đủ 3 lượt.

## Khi gặp lỗi

- AI báo **Cache miss** khi mở `/audit-runner`: AI đang dùng sai đường dẫn có yêu cầu đăng nhập. Hãy gửi lại liên kết có dạng `https://mkthub.onebiz.com.vn/ai-audit/...`.
- Trang báo liên kết không hợp lệ: Tạo liên kết mới và gửi lại cho AI.
- Trang không hiện **Audit Sandbox**: Dừng ngay và báo người phụ trách MKT Hub.
- Có **FAIL** hoặc **ERROR**: Sao chép JSON kết quả và gửi người phụ trách xử lý.

## Quy tắc an toàn

- Chỉ gửi liên kết cho đúng AI hoặc người được CEO giao kiểm tra.
- Không gửi mật khẩu, mã xác thực hay khóa hệ thống.
- Thu hồi liên kết ngay sau khi nhận kết quả.
- Không chạy kiểm tra nếu trang không ghi rõ **Audit Sandbox**.