# Khôi phục lớp đọc sau đổi hàm phân quyền

## Nguyên nhân và phạm vi

PostgreSQL lưu tham chiếu hàm trong view và RLS theo OID. Khi migration cơ cấu
đổi tên `user_has_permission` rồi thu hồi quyền gọi bản cũ, view/policy đã tồn tại
vẫn gọi OID cũ. API quy cách món trả `permission denied for function
user_has_permission_before_account_hierarchy`, kể cả profile owner khi request
chạy bằng database role `authenticated`.

## Hotfix

Migration `20261102233230_repair_account_permission_dependencies.sql` phân tích
lại các view/policy còn tham chiếu bản cũ, chuyển sang wrapper hiện hành. Giữ
nguyên điều kiện tenant/chi nhánh, biểu thức che giá vốn, policy restrictive,
view OID/owner/ACL và reloptions (security_barrier/security_invoker).
Không cấp lại EXECUTE cho hàm riêng, không ghi dữ liệu nghiệp vụ.
Giao dịch dùng lock timeout 3 giây và statement timeout 20 giây; lỗi sẽ rollback.

## Xác minh

- Fixture tạo view và policy trước migration cơ cấu, tái hiện lỗi bằng role
  authenticated, sau đó kiểm tra đọc quy cách, che/cho đọc giá vốn theo quyền,
  tenant/chi nhánh, restrictive policy, WITH CHECK và migration chạy lặp lại.
- Bộ kiểm tra cơ cấu đạt 63 PostgreSQL/WASM checks. PGlite không mô phỏng đầy đủ
  security_invoker; chỉ xác nhận bảo toàn reloptions của loại view này.
- Trên production, đọc thực bằng database role authenticated và request context
  thu ngân Premium + admin: Xưởng Gu Việt có Size M/L, thu ngân không thấy giá vốn.
- 8 view giữ nguyên OID/owner/ACL/reloptions. Không còn pg_rewrite/pg_policy trỏ
  đến hai hàm riêng; hàm cũ vẫn không cho authenticated gọi trực tiếp.

Khi retry trên POS, đóng/mở popup hoặc bấm Thử lại. Không cần đăng xuất hay khởi
động lại laptop. Đây là sửa database, không cần cài bộ in hoặc phát hành UI.
