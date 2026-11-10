# Nhân sự & phân quyền

## Luồng sử dụng

Mở Cài đặt → Nhân sự & phân quyền. Khi chưa có cơ cấu, chọn **Xem sơ đồ mẫu cửa hàng → Dùng sơ đồ này**. Mẫu gồm Cửa hàng trưởng → Ca trưởng → Nhân viên → Thu ngân / Phục vụ / Bếp–Pha chế; tất cả tên, cấp quản lý và quyền đều chỉnh được. Mẫu không cấp quyền hoặc gán người trước khi lưu.

Trong **Chức vụ & quyền**, chọn nhóm quyền hiện có hoặc tạo nhóm mới, chỉnh quyền nghiệp vụ ngay tại chỗ. Quyền quản lý tài khoản được cấu hình cùng màn hình, theo cấp dưới và phạm vi được giao. Liên kết nhóm quyền là mặc định cho các lần phân công/tạo nhân viên; không tự đổi nhóm quyền của người đã được phân công trước đó.

Trong **Nhân viên & chi nhánh**, chọn người, chức vụ và chi nhánh quản lý, bấm **Cập nhật phân công**. Nhóm quyền của chức vụ sẽ được đưa vào thay đổi cho những người vừa chọn. **Lưu thay đổi / Lưu tất cả thay đổi → Xác nhận lưu** lưu đồng thời cơ cấu, quyền và phân công. Mọi quyền riêng từng người, quyền truy cập chi nhánh và token đăng nhập vẫn giữ nguyên.

## Kỹ thuật và triển khai

- `save_staff_access` là một giao dịch có kiểm tra owner đang hoạt động và tenant. Tái sử dụng hàm lưu cơ cấu, nhóm quyền, cập nhật nhân viên đã được kiểm soát. Không sửa hàm in, bán hàng, RLS hay Auth.
- So sánh phiên bản cơ cấu, danh sách quyền gốc và role hiện tại của người nhận trước khi lưu. Một phần lỗi sẽ rollback tất cả.
- Tên chức vụ không suy ra quyền. `roleId` là liên kết tường minh. Vai trò mới được tạo và thay mã nháp trong cùng giao dịch.
- Migration chỉ thêm hàm, không cập nhật quyền/dữ liệu hiện hữu. Áp dụng migration trước khi phát hành giao diện.
- Rollback giao diện về deployment trước vẫn đọc được document có `roleId` bổ sung. Không cần xóa hàm hay sửa dữ liệu. Không tự hoàn tác quyền đã được người dùng lưu: cần đối chiếu audit riêng.
- Bản này hợp nhất chỉnh quyền chung và phân công; màn hình quyền riêng cá nhân hiện hữu vẫn giữ lại. Không gộp quyền nghiệp vụ từ nhiều chức vụ kiêm nhiệm thành phép hợp tự động.

## Kiểm thử

- 102 kiểm thử UI/account/permissions qua 21 tệp.
- `node scripts/test-account-management-scope.mjs --unified-staff`: 63 kiểm tra cơ cấu hiện hữu và bộ kiểm tra lưu đồng thời, tạo/ghép nhóm quyền, giữ chi nhánh, rollback, stale writes, khác tenant, owner-only và chặn anon.
- TypeScript và production build Next.js đạt.
- Kiểm tra trình duyệt với dữ liệu giả, gồm viewport 390×844; trường nhập xuống dòng, không ép bảng ngang, nút lưu bám đáy.
- Không tạo tài khoản nhân viên, sửa quyền hoặc in thử trên production trong quá trình kiểm thử.
