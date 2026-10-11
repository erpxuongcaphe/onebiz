# Phân quyền Hub — gọn, rõ và dùng chung OneBiz

Ngày 11/10/2026. Đây là bản code local chưa phát hành. Không thay tài khoản, quyền hoặc dữ liệu production.

## Nguyên tắc

- Một tài khoản OneBiz cho ERP, POS, MKT và Hub.
- Quyền thao tác lấy từ cơ chế hiện có: vai trò + cấp riêng − thu hồi riêng; không lấy chức danh để suy ra quyền.
- Phạm vi chi nhánh/trách nhiệm lấy từ phân công Hub. Có quyền nhưng không được phân công thì không thao tác ở chi nhánh đó.
- Owner đang hoạt động giữ toàn quyền trong doanh nghiệp mình theo cơ chế OneBiz; không coi admin là CEO.
- Bảy quyền: xem, làm việc, xác minh, cấu hình/duyệt, chốt kỳ, hủy việc, phân công. Cấu hình và duyệt vẫn là một nhóm có chủ đích, không tuyên bố tách người soạn/người duyệt cho nhóm này.
- Người phối hợp cần quyền xem, chỉ truy cập To-do được giao, trao đổi và minh chứng. Không được sửa trạng thái hoặc xem KPI/thưởng toàn chi nhánh.
- Người ủy quyền phân công không tự sửa phân công, không cấp tiếp quyền phân công, không sửa người có phạm vi cao hơn mình và không cấp vượt quyền mình có. Thao tác này không ghi role_permissions/user_permission_overrides.
- Yêu cầu gửi lại sau khi bị thu hồi quyền không được bỏ qua kiểm tra quyền nhờ kết quả lưu trước đó.

## Phạm vi code

- Thêm nhóm Hub vào danh mục phân quyền chung, không tự ghi quyền vào vai trò hoặc tài khoản.
- SQL Hub dùng user_has_permission hiện hành và phân công đúng tenant/chi nhánh; kiểm tra ở database, không chỉ ẩn nút.
- Quản lý được giao việc phải có quyền xem/làm việc; lỗi thiếu quyền báo bằng tiếng Việt.
- UI phân công chỉ hiện thao tác được phép và nạp lại cấu hình người được chọn; nút Phân công dùng quyền/phạm vi, không chỉ isCeo.
- Chỉnh các migration Hub chưa áp dụng production 00301/00302/00305. Không phải migration nâng cấp cho database đã có Hub: nếu catalog thay đổi và có ops_* thì phải dừng, soạn SQL nâng cấp riêng.

## Nền bảo mật production còn chặn

Catalog trước đó cho thấy profiles/branches/tenants chưa bật RLS và authenticated có quyền sửa cột nhạy cảm profiles. Việc thêm quyền Hub không tự khắc phục điểm này. Không chạy SQL bật RLS/thu hồi quyền khi chưa đối chiếu các đường đăng nhập, hồ sơ, quản trị người dùng/chi nhánh và các policy thực tế.

Trình tự còn lại: metadata chỉ đọc → SQL khóa quyền tối thiểu riêng → thử hồi quy ERP/POS/MKT và tài khoản giả → duyệt SQL áp dụng → kiểm tra sau. Không sửa tồn, tiền, hóa đơn; không dùng dữ liệu kinh doanh để thử quyền.

## Nghiệm thu lượt này

- 38 ca quyền/phạm vi trên PGlite: đạt, dùng định nghĩa user_has_permission từ migration 00189, không dùng stub cho hàm quyền trong bộ này.
- 81 kiểm tra nghiệp vụ database: đạt sau khi fixture được cấp quyền xem/làm việc đúng mô hình mới.
- 155 test Hub thuộc 15 file: đạt.
- Lint các file thay đổi và TypeScript Hub: đạt.
- 11 kiểm tra Auth/RPC/Storage trên Docker local: đạt. 77 kiểm tra web thật qua Next.js và Supabase local: đạt, gồm đăng nhập chung, quyền bị thu hồi, minh chứng, phối hợp MKT và sáu kích cỡ desktop/tablet/mobile.
- Đối chiếu cấu trúc: 8 migration tạo 18 bảng Hub trên bản sao metadata, giữ nguyên 143 cột nền. Đây không phải nghiệm thu quyền trên production.
- Production build bản cuối trên bản sao cô lập: đạt TypeScript và 153/153 trang. Một lượt build lại lỗi cache font Turbopack; xóa riêng `.next` của bản sao rồi chạy lại đạt, không đổi font/cấu hình web chính. Còn cảnh báo nhiều lockfile trong bản sao, không làm fail build. Không dùng kết quả build để kết luận production đã sẵn sàng.
- Chưa chạy SQL ghi production, commit, push hoặc deploy. Bản Word hướng dẫn ngày 10/10 chưa đồng bộ quyền mới; dùng Markdown cập nhật cho phần quyền.
