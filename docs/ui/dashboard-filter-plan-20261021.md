# Dashboard và bộ lọc OneBiz

Cập nhật 21/10/2026. Phạm vi: trang chủ, quyền xem chỉ tiêu, phương thức hoàn tiền và giao diện bộ lọc. Phục vụ toàn hệ sinh thái F&B, Retail, xưởng rang và văn phòng; không thay dữ liệu kinh doanh để khớp phần mềm tham khảo.

## Trạng thái và thứ tự

| Ưu tiên | Hạng mục | Trạng thái |
|---|---|---|
| Đã phát hành | Doanh số phía trên theo một ngày, mặc định hôm nay; kỳ biểu đồ độc lập | PR723 |
| Đã phát hành | Hoàn theo các khoản thu còn hiệu lực; không hoàn lại phiếu thu đã hủy | PR724 |
| Đang hoàn thiện | Hiện tên phương thức thực tế thay nhãn chung "Theo thanh toán gốc" | Chỉ sửa cách hiển thị, giữ nguyên ghi sổ |
| P0 | Kiểm tra quyền tổng thu, sổ quỹ, giá vốn, lợi nhuận, xuất file và phạm vi chi nhánh | Chưa hoàn tất; không tự đổi quyền tài khoản thật |
| P1 | Thiết kế lại popup lọc dùng chung, giữ nguyên nội dung và hành vi nghiệp vụ | Bổ sung theo yêu cầu; duyệt bản giao diện trước khi áp rộng |
| P2 | Mở rộng dashboard theo nhu cầu quản trị và công việc vận hành | Đề xuất bên dưới; chưa coi là đã xây |

## Phương thức hoàn tiền

- Chỉ có khoản thu tiền mặt: hiện "Tiền mặt".
- Chỉ có khoản thu chuyển khoản: hiện "Chuyển khoản"; thẻ tương tự.
- Có nhiều phương thức còn hiệu lực: hiện "Thanh toán kết hợp", liệt kê số tiền từng phương thức.
- Lựa chọn giữ nguyên không gửi phương thức ghi đè; máy chủ giữ riêng từng khoản gốc.
- Các lựa chọn ghi đè ghi rõ "Đổi sang...". Việc tách quyền ghi đè riêng thuộc P0, chưa được coi là đã xử lý chỉ bằng đổi nhãn.
- Không suy đoán tiền mặt khi chưa xác định nguồn. Không tự chuyển tiền ngân hàng.

## Dashboard đề xuất

### Khối đầu ngày

Giữ doanh số thực tế là chỉ tiêu chính. Chỉ chọn một ngày, mặc định ngày hiện tại theo giờ Việt Nam. Tiền mặt, chuyển khoản và các phương thức khác vẫn nằm cùng khối; phân biệt doanh số và tiền thực thu sau hoàn.

Bổ sung so sánh với cùng khung giờ của ngày đối chiếu, không lấy doanh số sáng nay so với cả ngày hôm qua. Khi xem một ngày lịch sử đầy đủ, so sánh hai ngày đầy đủ. Mốc so sánh bằng không thì không tạo phần trăm vô nghĩa.

Số hóa đơn hoàn tất và giá trị hóa đơn bình quân trình bày gọn. Bình quân lấy tổng giá trị các hóa đơn hoàn tất chia đúng số hóa đơn tương ứng; không lấy tiền thực thu hoặc số đã trừ trả hàng khác kỳ chia cho số đơn hôm nay.

### Phân tích bán hàng

Giữ điều khiển Giờ, Ngày, Tháng, Năm và bảng số liệu riêng. Phạm vi kỳ ghi ngay cạnh tiêu đề biểu đồ, không tác động ngày bán ở khối đầu.

Danh sách món/hàng bán tốt có lựa chọn số lượng và doanh số. Dữ liệu từ dòng hóa đơn lịch sử, phân bổ giảm giá/trả hàng đúng nguồn; không nhân số lượng với giá bán hiện tại. Bản tóm tắt có giới hạn được ghi rõ và có đường xem toàn bộ danh sách với lọc, sắp xếp, xuất file theo quyền.

Khi xem tất cả chi nhánh, bổ sung so sánh đóng góp và biến động từng chi nhánh. Phải dùng cùng định nghĩa chỉ tiêu với báo cáo chi tiết. Không cộng bán nội bộ thành doanh thu bán ngoài ở số hợp nhất; vẫn tra được chứng từ nội bộ tại từng chi nhánh.

### Vận hành theo loại chi nhánh

- F&B: đơn đang phục vụ, bàn đang dùng, đơn mang về/giao hàng chờ xử lý. Doanh thu ước tính của đơn mở phải tách khỏi doanh số hoàn tất.
- Retail: đơn cần xử lý, hàng thiếu theo dữ liệu tồn và quyền được cấp; không hiện khối bàn/phục vụ.
- Xưởng rang/kho: sản xuất, giao/nhận nội bộ và ngoại lệ tồn liên quan nhiệm vụ; không ép dùng bố cục quán.
- Văn phòng/toàn hệ thống: tổng hợp theo quyền quản trị; không biến mọi vai trò thành người xem toàn doanh nghiệp.

Không đếm một đơn nhiều lần do tách hóa đơn, nhiều dòng bếp hoặc nhiều khoản thanh toán. Không tự coi một hóa đơn là một khách nếu nguồn không ghi nhận số khách.

### Việc cần xử lý

Chỉ hiện ngoại lệ có chứng cứ và hành động phù hợp: đơn chờ xử lý, ca chưa đối soát, chứng từ cần kiểm tra, hàng thiếu. Mỗi dòng có số lượng/giá trị, kỳ và phạm vi, mức ưu tiên cùng đường mở đúng danh sách đã lọc.

Không suy diễn nguyên nhân kinh doanh chỉ từ một chỉ số giảm. Không đưa số tiền hoặc cảnh báo nhạy cảm cho người thiếu quyền. Chỉ tiêu lợi nhuận/giá vốn phải có quyền riêng và nguồn giá vốn lịch sử, không tính lại BOM hiện tại.

## Thiết kế popup lọc

### Giữ nguyên nghiệp vụ

Kiểm kê các trang dùng `FilterPanel` và các popup lọc riêng trước khi sửa thành phần chung. Giữ nguyên tên trường, tập giá trị, kiểu chọn đơn/nhiều, mặc định, cách ghép điều kiện, reset, sắp xếp, phân trang và tham số gửi dịch vụ.

`FilterPanel` hiện lọc trực tiếp khi đổi điều kiện; nút "Xem kết quả" đóng panel. Đợt thiết kế không tự chuyển thành mô hình chờ "Áp dụng", không làm đóng panel đồng nghĩa xóa bộ lọc. Không đổi phạm vi chi nhánh vận hành khi chỉ lọc báo cáo.

### Bố cục đề xuất

- Desktop: panel có chiều rộng vừa đủ, header/footer cố định; phân nhóm rõ bằng tiêu đề và nền nhạt, không chia thành nhiều thẻ lồng nhau.
- Mobile: sheet có giới hạn chiều cao, một vùng cuộn nội dung; nút đóng và xem kết quả luôn tiếp cận được, tôn trọng safe area và bàn phím.
- Thời gian: các kỳ nhanh gọn theo lựa chọn có sẵn; ngày tùy chỉnh vẫn dùng đúng loại và phạm vi ngày của trang.
- Trạng thái/loại/đối tượng: giữ control phù hợp và nhãn đầy đủ; không thu gọn đến mức mất nội dung lựa chọn.
- Số tiền/số lượng: đọc rõ phân cách hàng nghìn và số thập phân theo quy ước hiện hành; không đổi giá trị khi định dạng.
- Hiện số điều kiện đang bật; có reset dễ nhận biết theo hành vi hiện có. Khi đóng, khôi phục focus về nút mở; Escape và nút đóng không để màn hình kẹt overlay.

Thử thiết kế trước ở hóa đơn, công nợ, nhận hàng và báo cáo. Chỉ nhân rộng sau kiểm thử hợp đồng lọc và ảnh desktop/mobile.

## Nghiệm thu

1. Đối chiếu tổng, chi tiết, bảng số liệu và Excel với cùng nguồn/chứng từ, cùng kỳ và cùng chi nhánh.
2. Bao phủ giảm giá, trả/hủy, thanh toán kết hợp, thu nợ khác ngày, phiếu thu hủy, bản ghi vượt một trang API và mốc chuyển ngày Việt Nam.
3. Kiểm tra không chỉ ẩn giao diện: người thiếu quyền không nhận được số nhạy cảm qua dịch vụ, API hoặc xuất file.
4. Kiểm tra một chi nhánh, nhiều chi nhánh được giao và hợp nhất; không lộ chi nhánh ngoài phạm vi, không nhân đôi giao dịch nội bộ.
5. Bộ lọc trước/sau cho cùng kết quả và cùng tham số; nút đóng, reset, focus, sắp xếp và phân trang hoạt động đúng.
6. Ảnh ở 320px, 390px và desktop: không tràn chữ, không chồng nút, không mất phần nội dung hoặc điều khiển cuối panel.
7. Không tự tạo/hủy/hoàn giao dịch thật hay đổi quyền người dùng để nghiệm thu. Migration mới chỉ phát hành theo phạm vi được duyệt sau kiểm thử.

## Tài liệu tham khảo

[Tổng quan F&B KiotViet](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/fnb-bao-cao/trang-tong-quan/) có các góc nhìn theo thời gian, hiệu quả thực đơn và vận hành quán. OneBiz tham khảo câu hỏi quản trị; giữ định nghĩa doanh số hoàn tất đã thống nhất, không sao chép công thức hay cộng đơn đang phục vụ vào doanh số thực tế.

[Hóa đơn F&B KiotViet](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/fnb-giao-dich/hoa-don/) minh họa tìm kiếm theo nhiều tiêu chí và sắp xếp danh sách. Với OneBiz, đợt này làm lại cách trình bày bộ lọc hiện có, không thêm/bớt điều kiện theo phần mềm tham khảo.
