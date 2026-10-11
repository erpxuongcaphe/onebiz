# Phát hành Hub ngày 11/10/2026

## Đã áp dụng trên Supabase production

- Chủ hệ thống đã duyệt bản khóa nền và tiếp tục phát hành khi kiểm tra đạt.
- Lưu bản sao cấu hình quyền, chính sách và định nghĩa hàm trước thay đổi tại thư mục bằng chứng local; không đưa dữ liệu này vào Git.
- Bật giới hạn đọc theo doanh nghiệp; chặn ghi trực tiếp vào sáu bảng quản trị, bao gồm quyền ghi từng cột; giữ các hàm quản trị hiện có.
- Bốn hàm quản trị có kiểm tra chống tự thay đổi quyền/phạm vi hoặc vai trò đang dùng. Đây không phải tuyên bố đã nghiệm thu toàn bộ bảo mật ERP.
- Áp dụng đúng tám migration 00301–00308. Cả 18 bảng Hub bật RLS, không ghi trực tiếp từ trình duyệt; bucket minh chứng riêng tư, giới hạn 5 MB; liên kết MKT không đồng bộ kho, doanh thu hoặc trạng thái hoàn thành.
- SQL Editor bổ sung bật RLS cho bảng trạng thái lịch; migration local đã cập nhật tương ứng.
- Không tạo công việc, mẫu, người dùng thật; kiểm tra sau migration xác nhận standards/runs/todos đều bằng 0. Không sửa tồn, giá vốn, hóa đơn hay công nợ.

## Kiểm tra trước phát hành

- 59 kiểm tra bản khóa nền trên dữ liệu giả.
- 81 kiểm tra database Hub và 38 kiểm tra quyền đã đạt.
- 166 kiểm tra liên quan Hub/quản trị/cài đặt trên 18 file đã đạt.
- Đã kiểm tra UX local desktop/mobile và đăng nhập/database cô lập trong các vòng trước. Những kết quả này không thay thế nghiệm thu phiên đăng nhập production.
- Bản build và commit phải tách khỏi thay đổi ERP/POS của AI khác. Không đưa thư mục test, ảnh bằng chứng hay dữ liệu nguồn CEO vào Git.

## Truy cập và cấu hình

Link dự kiến sau deploy: https://onebiz.com.vn/hub, dùng tài khoản OneBiz chung. Chưa cấu hình hub.onebiz.com.vn.

CEO thiết lập mẫu công việc, chỉ tiêu và thưởng; sau này cấp quyền Hub và phạm vi chi nhánh cho người phụ trách. Không tự tạo tài khoản trong lần phát hành.

Lịch tự động bổ sung lúc 05:00 giờ Việt Nam mỗi ngày; giữ nguyên hai lịch ERP hiện có. CRON_SECRET và SUPABASE_SERVICE_ROLE_KEY đã có trên Vercel, không thay đổi giá trị.

## Trạng thái web

Bản build từ HEAD cộng đúng phạm vi Hub đã đạt TypeScript và 152/152 trang; 155/155 test Hub trên bản tách riêng đạt. Kiểm tra database chạy lại sau bổ sung RLS đạt 81/81. Chưa xác nhận deploy trong báo cáo này.

Web production được kiểm tra chỉ đọc sau khóa nền: phiên đăng nhập admin, chi nhánh và dashboard tải xong; không có lỗi console trong lượt kiểm tra. Chưa thực hiện giao dịch nghiệp vụ để thử.

Git checkout chính đang có tiến trình/khóa từ công việc khác; phát hành qua checkout riêng từ cùng HEAD, không xóa khóa hoặc ghi index checkout chính.
