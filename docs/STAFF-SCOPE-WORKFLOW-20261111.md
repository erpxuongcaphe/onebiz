# Phạm vi quản lý → chọn nhân viên → phân công

## Thay đổi
- Bộ lọc chung cho trang nhân viên và trang phân công: nhiều chi nhánh, nhiều phòng ban, tên/email/điện thoại không dấu, đếm kết quả và xóa lọc.
- Danh sách nhân viên vẫn do get_managed_accounts quyết định ở máy chủ. Migration chỉ thêm departmentIds/positionIds cho những người đã được phép trả về, không đổi quyết định quyền.
- Gán chức vụ/nhóm quyền thông thường có một nút Lưu phân công. Preview/fingerprint/version vẫn kiểm tra phía máy chủ trước transaction save_staff_access. Không lưu cấu hình chung chưa được xem trước kèm theo thao tác phân công.
- Đổi bộ lọc loại người bị ẩn khỏi lựa chọn hàng loạt. Bắt đầu chọn không mặc định chức vụ quản lý. Chi nhánh quản lý ngoài phạm vi truy cập của một người được chọn bị vô hiệu hóa và kiểm tra lại trước lưu.
- Cấu hình chức vụ trình bày phạm vi quản lý trước thao tác tài khoản, rồi quyền nghiệp vụ. Bổ sung phòng ban ở dòng nhân viên.

## Kiểm chứng
- 122 kiểm thử / 25 tệp admin và permissions đạt.
- 86 kiểm tra PostgreSQL/WASM đạt, thêm so sánh danh sách trước/sau migration cho 10 actor, metadata đúng phân công, anon bị từ chối. Các kiểm tra unified staff access về transaction/rollback/stale/tenant vẫn đạt.
- TypeScript, ESLint các tệp sửa đạt.
- Browser local dữ liệu giả: chọn người, chức vụ và Premium, lưu một lần hiện thành công; kiểm tra 390×844 không ép ngang bảng filter. Đây không phải thao tác cấp quyền production.

## Triển khai và giới hạn
Áp dụng migration metadata trước frontend; frontend cũ bỏ qua trường thêm. Frontend mới báo chưa có metadata nếu backend chưa cập nhật, không coi thiếu trường là người chưa có phòng ban. Rollback frontend không cần xóa metadata.

Không thay phân công người thật. Không đổi quyền in/bán hàng. Bản này chưa triển khai mô hình quyền nghiệp vụ khác nhau theo từng chi nhánh, đồng bộ mọi phạm vi truy cập trong cùng transaction, hay bộ kiểm tra đầy đủ từng công việc theo mockup. Không mô tả các phần đó là đã hoàn thành.
