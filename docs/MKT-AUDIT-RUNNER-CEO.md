# Hướng dẫn CEO dùng AI chạy MKT Audit Runner

## Điều kiện một lần trước khi dùng

1. Các migration Audit Runner (`00209` và bản vá `00210` nếu hệ thống đã cài `00209`) đã được chạy trên Supabase.
2. Bản web chứa Audit Runner đã được đưa lên production.
3. CEO đăng nhập MKT Hub bằng Google Chrome và có quyền `mkt.audit_runner`.
4. Mở: `https://mkthub.onebiz.com.vn/audit-runner`.

Chủ tài khoản OneBiz có quyền mặc định. Người khác chỉ thấy trang này khi được cấp đúng quyền, không phụ thuộc chức danh.

## Khởi tạo lần đầu

1. Bấm **Khởi tạo môi trường thử**.
2. Chờ màn hình hiện **Môi trường: Audit Sandbox**.
3. Kiểm tra có mã tenant thử nghiệm ở bên phải.
4. Chỉ khởi tạo một lần. Các lần sau dùng lại sandbox này.

Sandbox nằm chung dự án Supabase nhưng là tenant giả riêng biệt. Tất cả người dùng, chiến dịch, nội dung và công việc dùng để test đều là dữ liệu giả. Telegram và email bị chặn trong tenant này.

## Cách giao cho AI trên laptop CEO

CEO giữ Chrome đang đăng nhập, sau đó yêu cầu AI điều khiển Chrome bằng nội dung sau:

> Mở https://mkthub.onebiz.com.vn/audit-runner bằng tab Chrome hiện tại. Xác nhận trang ghi “Môi trường: Audit Sandbox”, sau đó bấm “Chạy tất cả”. Chờ hoàn tất, đọc bảng kết quả và báo cáo: số PASS, FAIL, ERROR; liệt kê từng dòng không PASS cùng Thực tế, mã lỗi và trạng thái Nhật ký. Không mở Supabase, không chạy SQL, không thay đổi quyền và không truy cập trang dữ liệu thật.

AI không cần tài khoản riêng. AI dùng phiên đăng nhập Chrome của CEO để thao tác giao diện, nhưng quyền vẫn bị backend kiểm tra như thao tác của CEO.

## Cách đọc kết quả

- **PASS**: quy tắc backend hoạt động đúng mong đợi.
- **FAIL**: backend cho phép hoặc từ chối sai so với quy tắc.
- **ERROR**: chính môi trường runner hoặc dữ liệu giả chưa sẵn sàng.
- **Nhật ký = Có**: lần từ chối hoặc thay đổi đã được ghi lại để kiểm tra.

Có thể bấm biểu tượng chạy ở từng dòng để kiểm tra lại một tình huống. Nút **Sao chép kết quả JSON** tạo bản kết quả gọn để gửi cho đội phát triển.

## Quy tắc an toàn

- Không đưa cho AI mật khẩu, service role key, token Telegram hoặc quyền truy cập Supabase.
- Không cho AI tự chạy SQL.
- Chỉ chạy khi trang hiện rõ **Audit Sandbox**.
- Nếu trang không hiện Audit Sandbox, dừng ngay và báo đội phát triển.
- Runner không đọc, sửa hoặc xóa dữ liệu công ty.
- Dữ liệu nghiệp vụ giả được dọn sau từng tình huống; kết quả và nhật ký thử nghiệm được giữ lại.
