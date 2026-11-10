# Trả hàng nội bộ từ chi nhánh

Phạm vi được chủ quán chốt ngày 10/11/2026

- Lập từ đơn nội bộ đã nhận. Giữ nguyên phiếu nhận, hóa đơn và lịch sử gốc.
- Chi nhánh chọn hàng, số lượng theo đơn vị trên đơn gốc, ghi lý do rồi xác nhận gửi. Không được trả vượt số đã nhận trừ các phiếu trả trước.
- Gửi trả ghi giảm tồn chi nhánh. Kho Tổng chưa tăng tồn. Phần đang đi được theo dõi trên phiếu trả.
- Nhân viên Kho Tổng có quyền nhận trả xác nhận thực nhận. Có thể nhận nhiều đợt. Phần chưa nhận giữ chờ xử lý, không tự coi là mất hàng hoặc nhập đủ.
- Nhận trả ghi tăng mã gốc tại kho xuất của đơn, dùng quy đổi đã lưu khi nhận; không đọc lại BOM để đoán mã.
- Mỗi lần nhận trả giảm nợ hóa đơn gốc theo giá gốc. Phần vượt nợ là khoản chờ hoàn/cấn trừ, không tự tạo phiếu tiền mặt.
- Mỗi yêu cầu ghi nhận có khóa chống lặp; kiểm tra quyền/chi nhánh trên máy chủ, không chỉ ẩn nút.
- Xem trước nêu số kho thay đổi, tiền giảm nợ dự kiến và khoản chờ hoàn. Khi xác nhận phải tính lại trong giao dịch.
- Bản đang xây dựng xử lý hàng đã nhập tồn. Dòng ghi chi phí vận hành hiển thị không chọn được; cần bổ sung đảo chi phí riêng trước khi hỗ trợ trả vật tư đã ghi chi phí. Không tạo xuất kho giả cho hàng chưa từng nhập tồn.
- Bộ lọc theo chi nhánh, trạng thái, mã đơn; giao diện một cột trên mobile, bảng gọn trên màn rộng. Không polling nền.

Không dùng hủy hóa đơn đã nhận thay cho trả hàng. Không cho bấm lại làm phát sinh thêm chứng từ sau timeout.

## Kiểm tra bản nháp 11/11/2026

- 5 kiểm thử component: xem trước, quy đổi, chống gửi trùng sau lỗi mạng/mở lại, đổi chi nhánh không giữ dòng cũ, tabs nguồn nhập.
- PostgreSQL/PGlite: trả vượt lượng rollback; quy đổi; idempotency; quyền chi nhánh; nhận nhiều đợt; giảm nợ/chờ hoàn; giữ giá vốn gốc và hạn dùng; số lượng lẻ 4 chữ số; chặn sửa riêng chứng từ tài chính.
- TypeScript và production build webpack đạt trong thư mục phụ thuộc độc lập, dùng cấu hình Supabase giả. Không dùng build này làm artifact production.
- Browser preview dùng component thật và dữ liệu giả: 320/390/768/1024/1366 px; không tràn ngang. Chưa phải kiểm tra trên thiết bị iOS thực.
- Chưa triển khai migration/chưa tạo chứng từ production. CI đầy đủ còn phải chạy trên PR.
- Phạm vi đầu tiên không hỗ trợ dòng đã ghi chi phí, hủy phiếu đã gửi hoặc đưa phần bị từ chối trở về chi nhánh. Phần nhận thiếu giữ trạng thái chờ nhận, không tự ghi hao hụt.

## Xử lý công nợ tại Kho Tổng

- Quyền riêng `inventory.internal_return_settle`, bắt buộc thuộc kho nhận trả. Quyền nhận hàng không tự cấp quyền chi tiền.
- Chỉ khoản đã có sự kiện nhận trả mới được xử lý. Cấn vào hóa đơn nội bộ đã hoàn thành, cùng Kho Tổng và cùng chi nhánh; không vượt khoản chờ hoặc nợ còn lại.
- Hoàn tiền cần thêm `finance.create_transaction`, chọn quỹ/tài khoản đang hoạt động của Kho Tổng và xác nhận đã thực trả. Không tự chuyển tiền ngân hàng.
- Xử lý một phần được; giữ số dư chờ xử lý. Lưu lịch sử người/ngày/số tiền/hóa đơn hoặc phiếu chi. Yêu cầu lặp sau timeout/mở lại không tạo lần chi thứ hai.
- Phiếu chi gắn với xử lý trả nội bộ không sửa/hủy riêng để tránh làm lệch số dư. Sai khoản đã xử lý cần đối soát, chưa có luồng đảo cấn/hoàn trong phiên bản này.
- Không tự cấp quyền tài chính cho toàn bộ nhân viên kho. Quản trị phân quyền nhận trả và xử lý công nợ tại chi nhánh được giao.
