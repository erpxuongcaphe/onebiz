# Hoàn thiện Hub trong một đợt

Phạm vi bắt buộc: cả tám khoảng thiếu so với Word/Excel ngày 14/10/2026.
Không phát hành từng phần cho CEO sử dụng như bản hoàn chỉnh.

## Điều kiện bàn giao

- Kỳ đánh giá có khoảng ngày độc lập lịch công việc.
- Quy tắc giới hạn, lỗi lặp, điểm cộng và thưởng cấu hình rõ, có phiên bản.
- Giữ nguyên sáu nhóm và 34 mục nguồn; phân biệt nhóm QC và phân loại To-do.
- Ghi ngoài lịch, nhiều vấn đề trong một lần kiểm tra, nguồn liên kết có quyền.
- Tổng quan bốn nhóm số có truy xuống và giữ phạm vi lọc.
- Liên kết mã hàng, lô, nhà cung cấp và chứng từ không sửa dữ liệu nghiệp vụ.
- Một luồng thiết lập thống nhất, bộ lọc mobile và bảo vệ nội dung chưa lưu.
- Nghiệm thu quyền, nghiệp vụ, tệp, đồng thời, hồi quy, desktop/mobile.

## Trình tự và an toàn

1. Làm trên nhánh riêng từ main; không chỉnh checkout của AI khác.
2. Bổ sung cơ chế có tương thích dữ liệu cũ, không tính lại lịch sử.
3. Chạy test database cô lập và giao diện; không seed production.
4. Tổng hợp đúng các yêu cầu đạt/chưa đạt; không dùng số lượng test thay nghiệm thu.
5. Chỉ khi toàn bộ gói đạt mới chuẩn bị một gói SQL/phát hành để duyệt.
6. Không áp dụng SQL mới, push main hoặc deploy trong khi còn hạng mục chưa đạt.

## Tiến độ

- [x] Đã xây dựng kỳ đánh giá tùy chỉnh; giới hạn ngày do server quyết định, không đổi lịch ngày/tuần.
- [x] Đã xây dựng giới hạn điểm/thưởng tùy chọn và lỗi kéo dài qua kỳ; chính sách cũ giữ cách tính cũ.
- [x] Đã xây dựng nhóm QC riêng, lưu nhãn theo phiên bản; đối chiếu đủ 34 mục và sáu nhóm từ file nguồn.
- [x] Đã xây dựng kiểm tra phát sinh, danh sách có tìm kiếm/phân trang và nhiều vấn đề trong một lần kiểm tra.
- [x] Đã xây dựng tổng quan bốn nhóm và truy xuống đúng bộ lọc.
- [x] Đã xây dựng liên kết hàng hóa/lô/NCC/chứng từ chỉ đọc, kiểm quyền ERP và chi nhánh độc lập quyền Hub.
- [x] Đã xây dựng thiết lập thống nhất, bộ lọc mobile và bảo vệ nội dung chưa lưu.
- [ ] Nghiệm thu trọn gói và hướng dẫn cuối.

Các dấu hoàn thành trên là tình trạng xây dựng và kiểm thử local, **không phải đã phát hành production**.

## Bằng chứng đã có

- Unit test: 248 ca thuộc 24 file Hub; vòng tích hợp thêm các kiểm thử FnB liên quan đạt 258 ca thuộc 27 file.
- Database cô lập: 103 ca, gồm 53 ca nền, 23 ca nâng cao và 27 ca bổ sung kỳ/nhóm/quyền/nguồn/Excel/đúng hạn.
- Nguồn Word/Excel: 24 kiểm tra, đủ 34 mục; 32 ngày, 2 tuần; trọng số trừ 197, hai mục cộng tổng 10.
- Trình duyệt Chrome: 56 kiểm tra trang/popup trên 1920x1080, 1366x768, 1280x800, 1024x768, 390x844, 430x932; thêm 7 hồi quy và 3 kiểm tra mất phản hồi.
- Supabase Docker local: 12 kiểm tra PostgreSQL 17/Auth/PostgREST/Storage, bao gồm hai yêu cầu đồng thời, tệp riêng tư và chặn chéo doanh nghiệp.
- TypeScript, ESLint và build production bản code đã đóng băng đều đạt; tạo đủ 146/146 trang.
- Nhánh đã tích hợp main `d8db3325` theo fast-forward; không sửa hoặc hoàn tác thay đổi FnB của AI khác.
- Hướng dẫn CEO bản chờ phát hành đã soạn 8 trang, có ảnh phần mềm với dữ liệu giả và kiểm tra bố cục từng trang. Chỉ đổi thành bản sử dụng chính thức sau kiểm tra production.
- Gói SQL nguyên tử đã qua thêm 3 kiểm tra: chặn nền thay đổi, ghi đủ hai lịch sử, chặn chạy lặp; chạy lại đủ 103 ca nghiệp vụ trên chính nội dung gói.
- Production: đã đối soát chỉ đọc và áp dụng thành công 00550–00551 ngày 15/10/2026 theo phê duyệt. Không chạy lại migration cũ, không tạo dữ liệu mẫu hoặc tính lại kết quả hiện có.

## Còn trước phát hành

1. Đối soát/tích hợp với main mới nhất và chạy lại cổng kiểm tra bản bàn giao.
2. Chuyển hướng dẫn CEO từ bản chờ phát hành sang bản sử dụng chính thức sau khi hậu kiểm; ảnh local hiện đã ghi rõ dữ liệu giả.
3. Xác minh baseline và số migration production bằng kiểm tra chỉ đọc; gói mới dự kiến **00550–00551**, không chạy lại 00532–00539 hay SQL FnB 00540–00542.
4. Trình gói SQL mới cùng phạm vi tác động để duyệt một lần, rồi mới áp dụng và phát hành trọn gói.
5. Kiểm tra sau phát hành chỉ đọc; không tự tạo công việc, điểm, nguồn doanh thu hoặc tài khoản thật.

Giới hạn nghiệm thu: kiểm tra mobile là trình duyệt mô phỏng kích thước/khung nhìn; chưa thay thế thử trên iPhone/Android vật lý. SQL mới đã áp dụng; code đang qua cổng GitHub/Vercel, chưa xác nhận phát hành hoàn tất.
