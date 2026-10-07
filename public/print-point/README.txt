CAI NHANH: Luu diem in tren web -> Tai bo ket noi chi nhanh (co san cau hinh)
-> Giai nen vao thu muc rieng -> Mo Cai-diem-in.cmd -> Cap nhat va in thu.
Bo cai tai Node 24 LTS tu nodejs.org neu chua co Node >=22, kiem SHA256,
chi dat runtime trong thu muc nay; khong doi execution policy, khong doi firewall.
Neu Windows chan tep/script, dung lai va lien he nguoi quan ly may;
khong tu tat bao ve. Chua co bo cai EXE ky so trong phien ban nay.
ZIP co ma ghep rieng: giu tai may quay, khong chia se ra ngoai.

ONEBIZ — ĐIỂM IN CHI NHÁNH (Windows, ESC/POS 58/80 mm)

Điện thoại nhân viên chỉ dùng trình duyệt và tài khoản riêng.
Máy quầy cần bật, có Internet và tiến trình điểm in đang chạy.
Phiên bản 2 — LAN/Wi-Fi dùng IP và cổng TCP (thường 9100), không cần driver
cho đường TCP trực tiếp. USB dùng tên máy đã cài driver trong Windows.
Máy cần hỗ trợ GS v 0
ESC/POS raster 203dpi, vùng in 384 dots (58mm) hoặc 576 dots (80mm).
Không cam kết mọi máy nhiệt hoặc máy Bluetooth đều đáp ứng.

1. USB: cài driver đúng model, chọn USB và in thử từ Windows.
LAN: máy in và máy quầy cùng mạng; giữ IP đang hoạt động, nhập đúng cổng.
Ví dụ máy của Xưởng Tư Búa: 192.168.10.222, cổng 9100. Chi nhánh khác
phải dùng địa chỉ máy tại chính chi nhánh đó. Không tự đổi IP đang dùng.
Chỉ dùng sau khi thử tiếng Việt, QR, lề, cắt.
2. Cài Node.js LTS từ nodejs.org. Tạo thư mục riêng tại máy quầy.
3. Tải bộ ZIP và giải nén; đặt onebiz-print-point.json vào cùng thư mục
có agent.mjs, destination.mjs, network.mjs, spool.ps1, run.ps1 và setup.ps1.
Nâng cấp: dừng task điểm in, thay toàn bộ các tệp chương trình từ ZIP mới,
giữ onebiz-print-point.json hiện có và chạy lại task. Không cần cấp lại mã.
JSON có mã riêng: giữ kín tại quầy, chỉ người quản lý máy được đọc.
Không dùng service-role key hoặc mật khẩu tài khoản nhân viên.
4. Lưu điểm in và bật nhận phiếu. Chạy setup.ps1 để đăng ký chạy nền
khi đăng nhập Windows, hoặc chạy node agent.mjs để kiểm tra thủ công.
5. Bấm Cập nhật trong Cài đặt → In ấn để lấy tên máy Windows; chọn kết nối
LAN/Wi-Fi (IP/cổng) hoặc USB/Windows cho từng nơi nhận; gán máy/
khổ giấy cho từng nơi nhận và lưu. Danh sách máy được quét lại mỗi 5 phút.
Nhân viên mở POS → Nơi nhận & lệnh in → Dùng điểm in chi nhánh.
6. Gửi phiếu thử và kiểm tra giấy. Windows đã nhận không bảo đảm giấy đã ra.
LAN có Kiểm tra kết nối chỉ mở socket IP/cổng, không gửi dữ liệu in.
USB có Kiểm tra kết nối kiểm tra tên máy trong Windows, chưa xác nhận dây
đang cắm hoặc giấy sẵn sàng. Xem kết quả ở lịch sử rồi dùng In thử.
Cắt giấy sau phiếu bật mặc định; tắt nếu máy không có dao cắt. Tắt lệnh
cắt không thay nội dung ảnh/phiếu. Lưu cấu hình trước khi kiểm tra/in thử.

KHỞI ĐỘNG CÙNG WINDOWS
setup.ps1 tạo task cho tài khoản Windows hiện tại, chạy với quyền thường,
không lưu mật khẩu và không cài service. Nếu task cùng điểm đã tồn tại,
script dừng để quản lý kiểm tra, không ghi đè.
Nếu cần cấu hình thủ công, dùng Task Scheduler:
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
- Chưa gửi được: USB kiểm tra tên máy, cổng USB và driver; LAN kiểm tra
IP/cổng, nguồn, dây mạng và dải mạng máy quầy. Không chuyển kết nối tự động.
- Cần kiểm tra giấy: kiểm tra tại máy trước; quản lý mới in lại có xác nhận.
- Cấp lại mã sẽ ngắt cấu hình cũ; tải JSON mới và chạy lại điểm in.
- "Đã chuyển dữ liệu in" không chứng minh giấy đã ra. Trạng thái hết giấy/
offline không được bộ này tự xác nhận từ mọi model hoặc driver.
- Không tự gửi lại khi kết quả không chắc chắn để tránh bếp làm trùng món.
- Bộ này chưa cung cấp bán hàng hoặc hàng đợi cloud khi mất Internet.

GIỚI HẠN
Điểm in nhận phiếu nhiệt F&B; chứng từ A4/A5 dùng phương thức trực tiếp.
Không tự mở ngăn kéo tiền. Quyền tài khoản/chi nhánh kiểm tra ở server.
Nút Dừng lệnh không thu hồi giấy đã in.
