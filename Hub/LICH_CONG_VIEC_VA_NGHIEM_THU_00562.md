# Đồng bộ vòng đời lịch Hub

Trạng thái: đã được duyệt; **SQL 00562 đã áp dụng production ngày 17/10/2026**, đang hoàn tất commit/push/deploy.

## Đối soát production

- Main đối soát: `d022d928`; số 00562 chưa sử dụng trước khi cài.
- 14 checksum của hàm Hub khớp hoàn toàn bản kiểm thử.
- Đã chạy đúng gói nguyên tử, đối chiếu toàn bộ bản ghi Hub cũ trong cùng giao dịch; không thay đổi dữ liệu cũ.
- Sau cài: 0 lịch, 0 lần thực hiện, 0 To-do, 0 kiểm tra như trước cài.
- RPC xem tác động có quyền scoped; hàm thực thi nội bộ và view nội bộ không cho authenticated truy cập trực tiếp.

## Phạm vi

- Sửa lịch với ngày hiệu lực và bước xem trước trước/sau.
- Chọn giữ việc tương lai đã tạo hoặc thay các việc chưa thực hiện; không chọn ngầm.
- Kết thúc lặp theo ngày cuối, bao gồm ngày đó; không tự đóng To-do.
- Đổi hạn một lần thực hiện, giữ hạn gốc và kỳ đánh giá.
- Lịch/kết quả cũ giữ nguyên; hủy vì đổi lịch không tính hoàn thành.
- Mọi thay đổi qua quyền, phiên bản, khóa giao dịch và nhật ký.

## An toàn dữ liệu

SQL chỉ bổ sung cấu trúc/hàm Hub. Khi cài không tự thay lịch, kết quả, số lượng tồn, hóa đơn hoặc tiền.
Chỉ sau thao tác được xác nhận, các việc tương lai trống mới có thể được hủy mềm có lý do.
Việc đã có kiểm tra, bằng chứng kể cả đang tải, To-do, kết quả, đã quá hạn hoặc kỳ đã chốt không bị hủy tự động.
Đổi hạn chỉ dành CEO có quyền cấu hình tại chi nhánh, việc chưa có hồ sơ/kết quả/kỳ chốt; hạn gốc vẫn dùng đánh giá đúng hạn.

## Nghiệm thu

- 644 file / 6,321 test hồi quy đạt sau khi giới hạn 4 worker; không bỏ assertion.
- SQL local: 53 kiểm tra nền và 35 kiểm tra vòng đời/gói phát hành đạt; không kết nối production.
- Production build đạt 147/147 trang với URL/key giả localhost, không dùng khóa Supabase thật.
- TypeScript đạt; ESLint không có lỗi, còn 2 cảnh báo unused prop có sẵn trong workspace.tsx.
- Trình duyệt local: duyệt lịch, kết thúc lặp, đổi hạn, bảo vệ đóng popup và lịch sử trước/sau đã kiểm tra.
- Khung nhìn mobile được đo thực tế khoảng 390×844: popup toàn màn hình, không tràn ngang, chân lưu hiện rõ.
- Chưa thử trên điện thoại vật lý; chưa hậu kiểm production vì chưa phát hành.

## Cổng phát hành còn lại

1. Đối soát main và số SQL để tránh thay đổi AI khác; 00562 hiện là số dự kiến trên nhánh.
2. Chạy preflight chỉ đọc, so 14 checksum và số bản ghi; drift thì dừng.
3. Xin duyệt SQL trước áp dụng. Không chạy lại 00561 hay SQL cũ.
4. Kiểm thử đúng gói SQL phát hành, đối soát quyền và metadata sau áp dụng.
5. Commit/push/deploy chỉ khi được duyệt và mọi kiểm tra đạt.
6. Hậu kiểm production chỉ đọc; thay ảnh local và nhãn chờ phát hành trong hướng dẫn bằng thông tin bản thật.

Tài liệu hướng dẫn nằm tại output/hub-lifecycle-20261017 trong workspace tài liệu, không chứa khóa truy cập.
