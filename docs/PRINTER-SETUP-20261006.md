# In ấn Onebiz — cập nhật 06/10/2026

Khổ nhiệt: **58 mm và 80 mm**. Chứng từ ERP: A4/A5. Không có yêu cầu khổ 56 mm.

## Phương thức và phạm vi

| Phương thức | Đường kết nối | Điều kiện |
|---|---|---|
| Trình duyệt | Máy đã được hệ điều hành nhận: USB, LAN, Wi-Fi, Bluetooth/AirPrint khi có driver tương thích | Chọn máy trong hộp thoại; web không tự dò IP hoặc ghép Bluetooth |
| QZ Tray | Hàng đợi in trong hệ điều hành trên cùng máy quầy | Cài driver, chạy QZ Tray, cấp quyền khi được hỏi, tìm máy và gán vai trò |
| USB trực tiếp | WebUSB → ESC/POS raster, tiếng Việt được dựng thành ảnh | Chrome/Edge, HTTPS, model hỗ trợ lệnh raster; driver giữ cổng có thể gây lỗi |

QZ Tray là cầu nối localhost, không phải dịch vụ cloud. Bản hiện tại chưa cấu hình chứng thư/chữ ký để bỏ hoàn toàn hộp thoại xác nhận. Không mở quyền hệ thống, cài ứng dụng desktop hoặc đổi firewall tự động. Điện thoại/tablet không tự dùng QZ Tray của một máy khác. Bluetooth phải tạo được máy in trong hệ điều hành; chưa có Web Bluetooth trực tiếp.

Máy Thu ngân, máy Bếp/Bar chung và máy Chứng từ A4/A5 được lưu trên trình duyệt hiện tại. Trạm Bar/Bếp có thể gán máy riêng theo chi nhánh và trạm, cũng lưu cục bộ. Mẫu mặc định và thương hiệu vẫn theo phạm vi hiện có của database.

## Đường in thống nhất

- Bill F&B qua mẫu, bill dự phòng, tạm tính, phiếu bếp, báo cáo ca X/Z và bill bán lẻ trực tiếp dùng bộ gửi lệnh chung.
- Chứng từ từ `printDocument` dùng cầu nối QZ nếu được chọn; chế độ USB chỉ hỗ trợ giấy nhiệt. A4/A5 ở chế độ USB mở hộp thoại trình duyệt.
- USB lấy cùng HTML rồi dựng raster 384/576 dots. Giữ tiếng Việt, tuỳ chọn, ghi chú và các ảnh tải được. Đây là vùng in phổ biến 48/72 mm ở 203 dpi; model khác phải in thử.
- Cầu nối không tự chuyển sang máy khác khi lỗi, tránh in trùng hoặc nhầm trạm. USB có thể chuyển sang hộp thoại khi lỗi và báo rõ; người vận hành kiểm tra giấy trước khi in lại.
- “Đã gửi lệnh” không xác nhận giấy đã ra, cắt giấy hay mở ngăn kéo thành công.
- Ngăn kéo: USB giữ lệnh ESC/POS khi thanh toán tiền mặt và cài đặt được bật. QZ dùng cấu hình driver nếu được thiết bị hỗ trợ; chưa gửi lệnh ngăn kéo riêng qua QZ.

## Mẫu và UX

- Bản xem trước bill/chứng từ dùng chung `generateDocumentHtml` và `applyTemplateToDocData` với bản in thật. Phiếu bếp dùng chung bộ dựng bếp.
- Nhãn dữ liệu minh họa đặt ngay trước preview. Phiếu thu/chi minh họa có người nộp/nhận, nội dung, phương thức và số tiền; không dùng giỏ món.
- Khoá cột bắt buộc tên/số lượng/thành tiền khi có cột đó. Tắt đơn giá không còn in “× 0”. QR, giảm giá, công nợ và lời cảm ơn thực sự được áp dụng.
- Bill nhiệt có chữ mặc định lớn hơn, ghi chú rõ, tên dài xuống dòng. Chữ ký chỉ hiển thị trong tuỳ chỉnh A4/A5 và để trống để ký tay.
- Nút lưu trong dialog cố định ở đáy. Tùy chọn thanh toán chỉ hiện với loại chứng từ phù hợp.
- Thêm xem trước in thử và kiểm tra dựng ảnh USB không gửi lệnh ra máy. In thử riêng Thu ngân/Bếp và từng trạm. Không xoá thông báo lỗi sau 4 giây.

## Việc chủ quán thực hiện khi setup

1. Cài driver và in thử từ hệ điều hành.
2. Chọn phương thức trong Cài đặt → In ấn → Máy in & vận hành.
3. Với QZ: cài ứng dụng từ trang chính thức, chạy trên máy quầy, tìm máy và chọn Thu ngân/Bếp/Chứng từ. Có thể dùng chung một thiết bị.
4. Chọn khổ 58/80 đúng cuộn giấy; mẫu bill/bếp cũng chọn đúng khổ.
5. Gán máy riêng cho trạm nếu cần. Kiểm tra chi nhánh trước khi gán.
6. In thử từng máy: tiếng Việt, món dài, tuỳ chọn, QR nếu có, lề, cắt giấy, ngăn kéo. Giữ kết quả in thử để nghiệm thu model.

## Giới hạn kiểm chứng

Kiểm thử tự động bao phủ API QZ, định tuyến vai trò/trạm, lỗi máy, raster, cờ mẫu và hồi quy in. Chưa có nghiệm thu thiết bị vật lý: USB/LAN/Wi-Fi/Bluetooth, bản in giấy 58/80, quét QR trên giấy, cắt giấy và ngăn kéo. Không cài QZ desktop, tạo đơn, thu/chi tiền hay sửa dữ liệu vận hành để thử.

Tài liệu chính thức: [QZ Getting started](https://qz.io/docs/getting-started), [QZ Pixel printing](https://qz.io/docs/pixel), [QZ Signing](https://qz.io/docs/signing), [html2canvas configuration](https://html2canvas.hertzen.com/configuration).
