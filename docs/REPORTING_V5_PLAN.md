# Reporting V5 - Kế hoạch triển khai báo cáo quản trị

## Mục tiêu

Nâng cấp 36 báo cáo hiện có thành một hệ thống quản trị thống nhất cho CEO, CFO,
kế toán và quản lý chi nhánh. Giữ nguyên cấu trúc route, phân quyền, nguồn dữ liệu
và công thức trong `REPORTING_V3_SPEC.md` và `REPORTING_V4_AUDIT.md`.

Công việc giao diện, bộ lọc, biểu đồ và xuất file không được tạo, sửa hoặc xóa
dữ liệu nghiệp vụ. Chỉ tạo migration/RPC đọc khi một góc nhìn không thể tính đúng
và đủ nhanh bằng API hiện có.

## Nguyên tắc bố cục

Mỗi báo cáo được tổ chức theo thứ tự:

1. Phạm vi: toàn công ty hoặc một chi nhánh.
2. Thời gian và kỳ so sánh.
3. Chỉ số tổng hợp.
4. Yếu tố đóng góp và xu hướng.
5. Bảng chi tiết hoặc chứng từ nguồn.
6. Xuất nội dung đang xem hoặc báo cáo đầy đủ.

Bộ lọc chính luôn hiển thị. Bộ lọc chuyên sâu nằm trong danh sách thả xuống.
Trang nhiều mã hàng phải có tìm kiếm, sắp xếp, phân trang, chọn cột, cố định cột
tên và cột tổng.

## Thứ tự triển khai

### Đợt 1 - Nền giao diện chung

- Trung tâm báo cáo có lối vào theo câu hỏi công việc.
- Khắc phục bố cục rỗng khi chỉ có Báo cáo đã ghim hoặc Mở gần đây.
- Chuẩn hóa thanh tiêu đề, phạm vi, kiểu hiển thị, thời gian và xuất file.
- Bộ chọn thời gian hoạt động trên màn hình hẹp và đồng bộ ngày tùy chỉnh.
- Tổng quan hiển thị đúng kỳ, đúng nhãn so sánh và có liên kết xem chi tiết.

### Đợt 2 - Điều hành và tài chính

Phạm vi: Tổng quan, Kết quả vận hành, Phân tích tài chính, Luồng tiền, VAT,
Công nợ và Cảnh báo điều hành.

- KPI có định nghĩa và kỳ so sánh rõ ràng.
- Doanh thu, giá vốn, chi phí và kết quả có bảng đối chiếu.
- Toàn công ty có thể xem đóng góp theo chi nhánh.
- Chỉ số tổng có thể mở tới chi tiết giao dịch liên quan.
- Không gọi báo cáo quản trị là báo cáo tài chính pháp định.

### Đợt 3 - Bán hàng và khách hàng

Phạm vi: Bán hàng, Đặt hàng, Kênh bán, Khuyến mãi, Trả hàng, Khách hàng,
Khách × Sản phẩm, Cohort, RFM và Nhân viên.

- Chuyển linh hoạt giữa tổng hợp và chi tiết.
- Xem theo chi nhánh, kênh, nhóm hàng, mặt hàng, khách và nhân viên.
- Bảng chéo giới hạn Top 10/20/50 hoặc tất cả bằng danh sách thả xuống.
- Có luồng tổng quan → khách/mặt hàng → hóa đơn.
- Tìm kiếm và sắp xếp không tải lại toàn trang.

### Đợt 4 - Hàng hóa, kho và mua hàng

Phạm vi: Xuất Nhập Tồn, Hàng hóa, ABC, Lô hàng, Kiểm kê, Chênh lệch,
Tuổi tồn, Tổn thất, Tiêu hao, Giá vốn công thức và Nhà cung cấp.

- Phân biệt số lượng, giá trị, giá vốn và đơn vị tính.
- Có góc nhìn tồn đầu, nhập, xuất, tồn cuối và biến động.
- Nhận diện hàng chậm bán, sắp hết, âm kho, chênh lệch và hao hụt.
- Chi tiết có mã hàng, tên hàng, nhóm, chi nhánh, chứng từ và ngày giao dịch.
- Nhà cung cấp có mua hàng, giá trị nhập, VAT và công nợ khi nguồn có sẵn.

### Đợt 5 - Vận hành và F&B

Phạm vi: Cuối ngày, Đối chiếu ca, Tổng hợp kênh, F&B, Shipper, Tùy chọn món,
Thời gian phục vụ và phí nền tảng.

- So sánh cửa hàng, ca, kênh, nhân viên và phương thức thanh toán.
- Cảnh báo chênh lệch và vượt ngưỡng có đường xem chi tiết.
- Chỉ số thời gian dùng biểu đồ phân bố/xu hướng, không dùng biểu đồ cơ cấu.
- Báo cáo chỉ hiển thị dữ liệu trong quyền chi nhánh của tài khoản.

### Đợt 6 - Bảng lớn, Excel và tốc độ

- Áp dụng khung bảng chung cho các bảng phù hợp.
- Phân trang hoặc ảo hóa khi dữ liệu lớn.
- Truy vấn độc lập chạy song song; bỏ qua phản hồi cũ khi đổi bộ lọc.
- Xuất đầy đủ lấy toàn bộ dữ liệu trong phạm vi, không chỉ Top N trên màn hình.
- File Excel có Thông tin, Tổng hợp, Chi tiết; số và ngày là ô dữ liệu thật.
- Số tổng trên web và Excel phải khớp.

## Cổng kiểm thử

Mỗi đợt phải đạt:

- Test phân quyền và phạm vi toàn công ty/từng chi nhánh.
- Test URL giữ bộ lọc, thời gian và kiểu hiển thị.
- Test công thức tổng, kỳ so sánh và tính đầy đủ của Excel.
- Lint, type check và Next production build.
- Chrome QC trên desktop và màn hình hẹp.
- PR riêng, CI xanh, merge main, Vercel production thành công.
- QC production chỉ đọc, không tạo/sửa/xóa dữ liệu nghiệp vụ.

## Điều kiện cần SQL

Không cần SQL cho Đợt 1. Từ Đợt 2 trở đi, chỉ tạo SQL khi thiếu phép tổng hợp
đọc cần thiết. Migration chỉ tạo/sửa view, function, policy hoặc index; không
cập nhật/xóa dòng dữ liệu kinh doanh. SQL do người phụ trách chạy sau khi review
và phải có truy vấn kiểm tra đọc kèm theo.