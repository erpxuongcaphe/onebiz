# Nghiệm thu nhân sự và phân quyền — 10/11/2026

## Kết luận

Chưa đạt nghiệm thu toàn bộ UX. Cơ chế giới hạn chi nhánh kiểm tra được, nhưng cấu hình nhân viên hiện hữu chưa đầy đủ và giao diện dễ làm người dùng hiểu sai tác động. Không thay phân công hoặc quyền của người thật trong lần nghiệm thu này.

## Bằng chứng trên production

- Trang `/he-thong/co-cau`, phiên bản cơ cấu 3: Thư giữ chức vụ Cửa hàng trưởng, nhóm Cửa Hàng Trưởng, truy cập Premium.
- Gọi hàm quyết định quyền chỉ đọc, với Thư tạo Nhân viên / Kinh Doanh / Thu ngân F&B: Premium ALLOWED; Tư Búa và Đồng Xoài OUTSIDE_HIERARCHY_OR_UNIT.
- Kiểm tra sửa tài khoản và đặt mật khẩu trên các tài khoản đang hoạt động: mỗi thao tác có 26 POSITION_NOT_ASSIGNED, 2 OWNER_PROTECTED, 1 SELF_ACCESS_PROTECTED, 1 OUTSIDE_HIERARCHY_OR_UNIT. Không có mục ALLOWED trong tập nhân viên hiện tại. Cần phân công đúng các nhân viên cấp dưới; không được tự suy chức vụ từ tên nhóm quyền.
- Quyền riêng từng người vẫn có thể bổ sung/thu hồi quyền nhóm. Màn hình chức vụ không phải bảng quyền hiệu lực đầy đủ của từng cá nhân.

## Sửa trong đợt nghiệm thu

- Hiện số nhân viên chưa gán chức vụ và đường dẫn bộ lọc để hoàn tất phân công.
- Hiện tên chi nhánh quản lý, phân biệt không có quyền quản lý với chỉ có quyền truy cập chi nhánh; hiện rõ ngoại lệ quản trị toàn doanh nghiệp.
- Loại chủ doanh nghiệp khỏi thao tác chọn hàng loạt phân công.
- Chỉ mở biểu mẫu phân công sau khi chọn nhân viên, giảm độ dài màn hình mobile.
- Hiện nhóm quyền sẽ áp dụng trước khi cập nhật bản nháp; nói rõ kiêm nhiệm không cộng nhóm quyền.
- Đổi “Bỏ phân công” thành “Gỡ chức vụ”, xác nhận rõ không khóa tài khoản và không gỡ nhóm quyền nghiệp vụ.
- Giải thích chọn nhóm mặc định không tự đổi nhóm của nhân viên hiện hữu.
- Tìm quyền không dấu; tổng số quyền của nhóm không đổi theo bộ lọc; chỉ quyền đã bật được mở để đọc.

## Kiểm thử và giới hạn

- 107 kiểm thử admin/permissions đạt ở 23 tệp trước thay đổi ẩn biểu mẫu; chạy lại các kiểm thử màn hình liên quan sau thay đổi.
- 63 kiểm tra PostgreSQL/WASM phạm vi tài khoản đạt; kiểm tra lưu nguyên tử, rollback, phiên bản cũ, khác tenant và owner-only của unified staff access đạt.
- TypeScript và lint các tệp sửa đạt trước bước giao diện cuối; chạy lại TypeScript sau bước cuối.
- Trình duyệt: production chỉ đọc; bản local dữ liệu giả kiểm tra chọn người → phân công → xem trước → lưu, và bố cục 390 × 844. Đây không phải xác nhận đăng nhập bằng tài khoản Thư hay thực hiện đổi mật khẩu người thật.
- Các bản sửa UX cần CI và triển khai rồi nghiệm thu lại trên web thật. Không gọi bản local là đã triển khai.

## Còn cần xử lý để đạt UX tổng thể

1. Màn hình quyền hiệu lực từng người cần trình bày nguồn quyền: nhóm, chức vụ, ngoại lệ cá nhân và phạm vi chi nhánh.
2. Liên kết chức vụ với nhóm mặc định cần thao tác áp dụng cho người hiện hữu có danh sách tác động rõ ràng, tránh phải hiểu hai mô hình dữ liệu.
3. Cần chủ doanh nghiệp xác định chức vụ thật cho nhân viên chưa phân công; không bật đồng loạt hoặc gán tất cả thành quản lý.

Không thay đổi RLS, quyền người thật, luồng in hoặc bán hàng trong bản sửa UX này.
