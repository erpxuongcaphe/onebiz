ONEBIZ — ĐIỂM IN CHI NHÁNH (Windows, ESC/POS 58/80 mm)

Điện thoại nhân viên chỉ dùng trình duyệt và tài khoản riêng.
Máy quầy cần bật, có Internet và tiến trình điểm in đang chạy.
USB/LAN/Wi-Fi dùng tên máy đã cài trong Windows. Máy cần hỗ trợ GS v 0
ESC/POS raster 203dpi, vùng in 384 dots (58mm) hoặc 576 dots (80mm).
Không cam kết mọi máy nhiệt hoặc máy Bluetooth đều đáp ứng.

1. Cài driver; in thử từ Windows. Chỉ dùng sau khi thử tiếng Việt, QR, lề, cắt.
2. Cài Node.js LTS từ nodejs.org. Tạo thư mục riêng tại máy quầy.
3. Tải agent.mjs, spool.ps1, onebiz-print-point.json vào cùng thư mục.
JSON có mã riêng: giữ kín tại quầy, chỉ người quản lý máy được đọc.
Không dùng service-role key hoặc mật khẩu tài khoản nhân viên.
4. Mở terminal tại thư mục, chạy: node agent.mjs
5. Quản lý gán máy/khổ giấy và bật điểm in trong Cài đặt → In ấn.
Nhân viên mở POS → Nơi nhận & lệnh in → Dùng điểm in chi nhánh.
6. Gửi phiếu thử và kiểm tra giấy. Windows đã nhận không bảo đảm giấy đã ra.

KHỞI ĐỘNG CÙNG WINDOWS
Dùng Task Scheduler, tạo task cho tài khoản máy quầy:
- Trigger: At log on (đăng nhập tài khoản quầy).
- Action: node.exe (chọn đường dẫn Node.js đã cài).
- Arguments: agent.mjs
- Start in: thư mục riêng có 3 tệp trên.
- Tự khởi động lại khi lỗi; bỏ giới hạn thời gian chạy task.
- Chỉ chạy một instance; máy phải giữ đăng nhập, tắt sleep khi phục vụ.
Kiểm tra task sau khi khởi động lại trước khi đưa vào vận hành.
Tổ chức cần chạy trước đăng nhập có thể cấu hình task/service riêng bởi
quản trị Windows; bộ này không tự cài service hay đổi chính sách máy.
Nếu PowerShell chặn tệp, nhờ quản trị kiểm tra chính sách/chữ ký phù hợp.
Không tắt bảo vệ của hệ điều hành để vượt chặn.

XỬ LÝ LỖI
- Chờ điểm in: kiểm tra Internet, máy quầy và tiến trình.
- Chưa gửi được: kiểm tra tên máy và driver.
- Cần kiểm tra giấy: kiểm tra tại máy trước; quản lý mới in lại có xác nhận.
- Cấp lại mã sẽ ngắt cấu hình cũ; tải JSON mới và chạy lại điểm in.
- Trạng thái hết giấy/offline không được bộ này tự xác nhận từ mọi driver.
- Không tự gửi lại khi kết quả không chắc chắn để tránh bếp làm trùng món.
- Bộ này chưa cung cấp bán hàng hoặc hàng đợi cloud khi mất Internet.

GIỚI HẠN
Điểm in nhận phiếu nhiệt F&B; chứng từ A4/A5 dùng phương thức trực tiếp.
Không tự mở ngăn kéo tiền. Quyền tài khoản/chi nhánh kiểm tra ở server.
Nút Dừng lệnh không thu hồi giấy đã in.
