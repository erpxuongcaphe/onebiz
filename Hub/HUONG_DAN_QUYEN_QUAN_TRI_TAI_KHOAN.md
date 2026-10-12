# Quyền quản trị tài khoản OneBiz

## Trạng thái

Bản bổ sung đã được duyệt phát hành; migration 00516 đã áp dụng và đối soát trên production ngày 12/10/2026. Số ban đầu 00515 đổi thành 00516 vì bản đơn vị tính của AI khác đã dùng 00515; không đổi nội dung nghiệp vụ. Tài khoản admin và Nguyễn Hoàng Thanh đã là owner, trạng thái này được giữ nguyên sau migration. Bản này không tự đổi quyền của hai tài khoản đó hay tài khoản khác khi cài đặt. Sau khi deployment mới sẵn sàng, tải lại trang để dùng các thao tác dưới đây.

## Sau khi phát hành

1. Đăng nhập tài khoản quản trị toàn doanh nghiệp.
2. Vào **Hệ thống → Người dùng & Phân quyền**: https://onebiz.com.vn/he-thong/users.
3. Tại tài khoản cần chỉnh, mở **Thao tác → Quyền quản trị & lịch sử**.
4. Đọc quyền hiện tại và phạm vi thay đổi; ghi lý do, nhập đúng email tài khoản đích.
5. Bấm **Xác nhận cấp quyền** hoặc **Xác nhận thu hồi**. Chỉ báo thành công sau khi server xác nhận.
6. Người được thay đổi quyền đăng xuất rồi đăng nhập lại. Kiểm tra Hub: https://onebiz.com.vn/hub.

## Hai lớp quyền

- **Vai trò thông thường:** bộ quyền và chi nhánh được gán, có quyền riêng nếu cần. Tên vai trò như Chủ cửa hàng không tự đồng nghĩa với CEO.
- **Quản trị toàn doanh nghiệp (owner):** toàn quyền ERP và Hub trong doanh nghiệp; bao gồm quản trị tài khoản, kho, tài chính và duyệt Standard Working. Không cấp quyền này chỉ để xem Hub.
- Cấp Hub thông thường: chọn quyền Xem Hub và thao tác phù hợp trong phân quyền, sau đó vào Hub → Thiết lập → Phân công. Người chỉ phối hợp một To-do chỉ thấy việc được giao.

## Bảo vệ

- Chỉ owner đang hoạt động được cấp/thu hồi owner; quyền quản lý người dùng thông thường không đủ.
- Không tự đổi quyền quản trị của mình. Cần một owner khác thực hiện.
- Không làm mất owner đang hoạt động cuối cùng. Không vô hiệu hóa một owner đang hoạt động qua lối sửa hồ sơ: phải thu hồi owner bằng tài khoản quản trị khác trước.
- Giữ nguyên vai trò thông thường, quyền riêng và chi nhánh khi cấp/thu hồi owner. Thu hồi owner không tự xóa những quyền khác đã gán.
- Không đổi mật khẩu/PIN, không sửa tồn kho, hóa đơn, công nợ hay tiền.
- Lý do và email xác nhận bắt buộc; lưu lịch sử cùng giao dịch. Khóa giao dịch theo doanh nghiệp, kiểm tra quyền hiện tại và yêu cầu cũ; gửi lại cùng yêu cầu không tạo lịch sử trùng.
- Lịch sử hiển thị 20 lần gần nhất với người thực hiện, thời gian Việt Nam và lý do. SQL thủ công trước đây không được giả lập thành lịch sử thao tác qua giao diện.

## Cổng phát hành

Kiểm thử cô lập và build phải đạt. Trước khi áp dụng 00516, kiểm tra số migration chưa bị AI khác sử dụng và hàm quản trị hiện tại không lệch. Chỉ chạy migration định nghĩa một lần sau khi anh duyệt; những lần cấp quyền tiếp theo thao tác qua website, không cần SQL riêng từng tài khoản. Không tạo tài khoản hoặc thay đổi quyền thật để thử tính năng.
