# Lịch công việc và nhật ký Hub

Vào https://onebiz.com.vn/hub → Thiết lập.

## Tạo công việc

1. Chọn Standard Working, nhập tên và kết quả cần đạt.
2. Chọn phạm vi và quản lý phụ trách đúng chi nhánh.
3. Không bật **Lặp lại**: chọn ngày cần hoàn thành và giờ hạn; hệ thống chỉ tạo một công việc.
4. Bật **Lặp lại**: chọn chu kỳ và các trường tương ứng:

| Chu kỳ | Cần chọn |
| --- | --- |
| Hằng ngày | Ngày bắt đầu, giờ hạn |
| Hằng tuần | Thứ thực hiện, ngày bắt đầu, giờ hạn |
| Hằng tháng | Ngày trong tháng, ngày bắt đầu, giờ hạn |
| Hằng quý | Ngày trong tháng, tháng thứ 1/2/3 của quý, ngày bắt đầu, giờ hạn |
| Hằng năm | Ngày và tháng thực hiện, ngày bắt đầu, giờ hạn |

5. Nếu cần dừng lịch vào một ngày, bật **Kết thúc lặp vào ngày**. Không bật nghĩa là tiếp tục lặp đến khi ngừng áp dụng.
6. Điền tiêu chí kết quả, kiểm tra và lưu bản nháp. Duyệt áp dụng để công việc có hiệu lực. Đề xuất của quản lý vẫn cần CEO duyệt.

Ngày bắt đầu xác định lúc lịch có hiệu lực, không thay cho thứ/ngày lặp. Ví dụ: bắt đầu 17/10/2026, lặp ngày 1 tháng thứ 2 của quý thì lần đến hạn tiếp theo là 01/11/2026.

Ngày 29/30/31 gặp tháng ngắn sẽ dùng ngày cuối tháng; 29/2 gặp năm không nhuận dùng 28/2. Ngày hiển thị dd/mm/yyyy; giờ HH:mm theo giờ Việt Nam.

## Bộ tiêu chí chung

- Sửa lịch của từng mục trong bộ chung bằng ô **Lặp lại**. Nguồn 34 mục CEO không tự thay đổi lịch đã lưu.
- Áp dụng cho chi nhánh: chọn chi nhánh, nhiều quản lý, ngày bắt đầu và giờ hạn. Lịch tuần chưa có thứ riêng sẽ theo thứ chọn tại chi nhánh.
- Kiểm tra bảng xác nhận rồi áp dụng. Nhiều quản lý cùng theo một công việc, không tạo bản trùng cho từng người.
- Sửa bộ chung không ghi đè những công việc đã áp dụng. Tại chi nhánh đã dùng, chọn **Phiên bản mới**, ghi lý do, kiểm tra ngày có hiệu lực rồi duyệt.
- File Excel cũ 7 cột vẫn đọc được. Mẫu mới thêm **Ngày lặp** và **Tháng lặp**, kèm sheet hướng dẫn.

## Xem nhật ký

1. Chọn chi nhánh và tháng cần xem trên thanh đầu Hub.
2. Vào Thiết lập → **Nhật ký thao tác**.
3. Xem người thực hiện, thời gian, nội dung và lý do.
4. Với thay đổi lịch, mở **Xem lịch thực hiện** để đối chiếu trước/sau.

Sinh việc tự động ghi người thực hiện là **Hệ thống**. Lịch sử cấu hình bộ chung chỉ dành cho người có quyền CEO/cấu hình. Người dùng không được sửa hoặc xóa nhật ký qua API.

Không tự áp dụng bộ tiêu chí, đổi phân công hoặc tạo kết quả đạt. Công việc/kết quả cũ giữ nguyên; thay đổi lịch không tính lại kỳ đã qua.
