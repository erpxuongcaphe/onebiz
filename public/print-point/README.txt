CAI NHANH: Luu diem in tren web -> Tai bo ket noi chi nhanh (co san cau hinh)
-> Giai nen vao thu muc rieng -> Mo Cai-diem-in.cmd -> Cap nhat va in thu.
Bo cai tai Node 24 LTS tu nodejs.org neu chua co Node >=22, kiem SHA256,
chi dat runtime trong thu muc nay; khong doi execution policy, khong doi firewall.
Neu Windows chan tep/script, dung lai va lien he nguoi quan ly may;
khong tu tat bao ve. Chua co bo cai EXE ky so trong phien ban nay.
ZIP co ma ghep rieng: giu tai may quay, khong chia se ra ngoai.

ONEBIZ — ĐIỂM IN CHI NHÁNH (Windows, ESC/POS 58/80 mm)

USB native: bộ mới có OnebizUsbWorker.exe và mã nguồn OnebizUsbWorker.cs.
Gửi RAW và đọc tên máy in dùng Winspool trực tiếp, không khởi động PowerShell/
biên dịch Add-Type trên đường in. EXE dùng .NET Framework có sẵn trong Windows.
Thử OnebizUsbWorker.exe --probe chỉ báo ready rồi thoát, không gửi giấy.
Nếu EXE bị chính sách Windows chặn, không tắt bảo vệ; báo quản trị máy.
Giữ spool.ps1 để tương thích bộ cũ khi chưa có EXE, không âm thầm đổi cách
gửi sau một lệnh đã gửi hoặc mất xác nhận. Lỗi trước dispatch báo chưa gửi;
sau dispatch vẫn giữ chưa xác nhận, không tự in lại.

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
có agent.mjs, destination.mjs, network.mjs, usb-worker.mjs, spool.ps1, run.ps1 và setup.ps1.
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
Trên POS, nút “In & lệnh” mở ngay lịch sử, tự cập nhật mỗi 5 giây.
Dò máy Windows chạy nền, không chặn lệnh LAN. Khi hàng đợi trống,
điểm in kiểm tra lệnh mới sau 1 giây; lệnh đang gửi vẫn xử lý tuần tự.
USB giữ một tiến trình gửi Windows sẵn sàng, không khởi tạo lại cho mỗi bill.
Sau khi cập nhật, phải dừng và chạy lại task để nạp phiên bản mới.
Nếu mất phản hồi từ Windows, không tự gửi lại bill; kiểm tra giấy trước.
Nhật ký kỹ thuật tại logs/print-agent.log ghi thời gian lấy lệnh,
gửi máy và xác nhận. Khởi động lại giữ bản trước ở đuôi .previous.
Nhật ký không chứa mã kết nối hoặc nội dung phiếu.
6. Gửi phiếu thử và kiểm tra giấy. Windows đã nhận không bảo đảm giấy đã ra.
LAN có Kiểm tra kết nối chỉ mở socket IP/cổng, không gửi dữ liệu in.
USB có Kiểm tra kết nối kiểm tra tên máy trong Windows, chưa xác nhận dây
đang cắm hoặc giấy sẵn sàng. Xem kết quả ở lịch sử rồi dùng In thử.
Cắt giấy sau phiếu bật mặc định; tắt nếu máy không có dao cắt. Tắt lệnh
cắt không thay nội dung ảnh/phiếu. Lưu cấu hình trước khi kiểm tra/in thử.

KHỞI ĐỘNG CÙNG WINDOWS
Task dùng wscript.exe và start-hidden.vbs để mở supervisor PowerShell ẩn,
không có cửa sổ console để nhân viên đóng nhầm. Trình chạy đợi supervisor
kết thúc và trả mã thoát cho Task Scheduler; không chạy thả nổi tiến trình.
Windows Script Host bị chặn thì bộ cài dừng trước khi đổi task, không tắt
bảo vệ hoặc đổi execution policy. Máy vẫn cần giữ đăng nhập Windows.
Nâng cấp task đã cài: chép start-hidden.vbs, autostart.ps1 và
update-autostart.ps1 vào đúng thư mục điểm in, rồi chạy:
  .\update-autostart.ps1 -PointId <ID điểm in>
Script sao lưu XML task, giữ tài khoản/trigger/cấu hình in và bật chạy bù.
Không dừng/chạy lại receiver hiện tại. Action mới có hiệu lực lần chạy sau;
chỉ kiểm tra restart lúc quán thuận tiện, xác nhận kết nối và giấy thực tế.
Quay lại: quản trị có thể khôi phục XML autostart-backup-*.xml vừa tạo
bằng Register-ScheduledTask; giữ đúng tài khoản quầy, không tạo task thứ hai.
setup.ps1 tạo task cho tài khoản Windows hiện tại, chạy với quyền thường,
không lưu mật khẩu và không cài service. Nếu task cùng điểm đã tồn tại,
script dừng để quản lý kiểm tra, không ghi đè.
Nếu cần cấu hình thủ công, dùng Task Scheduler:
- Trigger: At log on (đăng nhập tài khoản quầy).
- Action: Windows\System32\wscript.exe.
- Arguments: //B //NoLogo "<thư mục điểm in>\start-hidden.vbs"
- Start in: thư mục điểm in.
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

PHỤC HỒI NHẬN LỆNH - 24/10/2026
RPC giới hạn 15 giây gồm đọc nội dung phản hồi; không tự retry claim.
Vòng nhận lệnh không tiến triển 90 giây sẽ thoát để run.ps1 chạy lại.
run.ps1 tự phục hồi child bị thoát, chờ tăng dần 5-60 giây, chỉ một task.
Không tự gửi lại phiếu sending/unknown. Không cần khởi động lại Windows.
Server giữ phiếu queued quá 5 phút ở "Phiếu cũ · chờ xác nhận"; quản lý
kiểm giấy rồi xác nhận in hoặc dừng. Không âm thầm xóa nội dung phiếu.
Nâng cấp cần thay đủ chương trình gồm recovery.mjs, giữ JSON cũ và token,
không bấm cấp mã mới/cài lại task. Chỉ cập nhật lúc phù hợp sau đối chiếu
cloud queue và Windows queue. Không chạy hai agent. Không tự đổi LAN/USB.
Đây không phải tự cập nhật từ web; máy quầy cần được cập nhật một lần.
Không cam kết chạy bộ cài/USB worker hiện hành trên Windows7/PowerShell2;
quản trị phải xác minh runtime thực tế trước khi thay chương trình quầy.
