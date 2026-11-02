# Cơ cấu quản lý tài khoản và khôi phục mật khẩu

## Vận hành

- Chủ doanh nghiệp vào **Cài đặt → Cơ cấu & phân quyền** (`/he-thong/co-cau`).
- Tạo chức vụ và bộ phận, chọn cấp trên, chọn phạm vi và từng thao tác tài khoản.
- Gán nhân viên hàng loạt, thay phân công hoặc thêm chức vụ kiêm nhiệm. Việc gán không đổi nhóm quyền nghiệp vụ hoặc chi nhánh được truy cập.
- Xem trước cơ cấu/phân công và quyền hiệu lực, rồi xác nhận. Có kiểm tra phiên bản để không ghi đè chỉnh sửa ở tab khác. Lịch sử chỉ đọc lưu người sửa, thời điểm, phiên bản và nội dung trước/sau.
- Cơ cấu khởi tạo trống. Mẫu tham khảo chỉ nằm trong bản nháp; không tự gán chức vụ hay quyền cho tài khoản hiện có.
- Các thao tác tài khoản của quản lý yêu cầu cơ cấu và phân công rõ ràng. Quản lý không thể sửa cấp trên, ngang cấp, chính mình, chủ doanh nghiệp hoặc quản trị được bảo vệ. Mọi phân công kiêm nhiệm và toàn bộ chi nhánh của tài khoản phải được bao phủ.
- Nhóm quyền nghiệp vụ dùng chung và ngoại lệ quản trị toàn doanh nghiệp do chủ doanh nghiệp quản lý. Không suy luận cấp quyền từ tên chức danh.

## Quên mật khẩu

- Nhân viên chỉ có SĐT nhờ quản lý được phân quyền tại **Cài đặt → Người dùng → Đặt lại mật khẩu**. Quản lý giao mật khẩu tạm qua kênh riêng; nhân viên được yêu cầu đổi khi đăng nhập tiếp. Không đổi PIN và không chuyển danh tính thu ngân đang bán.
- Đường ghi mật khẩu dùng service-only RPC để ghi yêu cầu/kết quả audit; không ghi mật khẩu hoặc token vào lịch sử.
- Email sử dụng phiên khôi phục riêng trong bộ nhớ, không đọc/ghi phiên POS. Hỗ trợ mã OTP recovery và liên kết recovery mặc định của Supabase; lỗi mạng có timeout và gửi lại có đếm ngược.
- **Theo yêu cầu người dùng, cấu hình SMTP được để sau.** `NEXT_PUBLIC_ONEBIZ_EMAIL_RECOVERY_ENABLED` mặc định `false`; giao diện thông báo rõ và hướng dẫn nhờ quản lý. Không tự gửi email qua dịch vụ mặc định chưa sẵn sàng.
- Khi hoàn thiện email: cấu hình custom SMTP trong Supabase, kiểm tra domain gửi, dùng mẫu `supabase/templates/recovery.html`, xác nhận redirect tới `/dat-lai-mat-khau` trên miền chính/F&B, thử gửi/nhập mã/đổi mật khẩu trên tài khoản thử được cho phép. Sau đó mới đặt biến trên thành `true` cho production/preview phù hợp và phát hành lại. Không bật trước khi xác nhận gửi thực tế.

## Kiểm tra và triển khai

1. Chạy Vitest, TypeScript, CI build trên môi trường sạch. Checkout Windows hiện dùng junction node_modules khác ổ đĩa nên build cục bộ có lỗi resolver; không thay thư viện dùng chung để tránh tác động các chat khác.
2. Chạy `scripts/test-account-management-scope.mjs` với `ONEBIZ_PGLITE_MODULE` trỏ tới PGlite 0.5.8 cài trong thư mục công cụ riêng. Có kiểm tra quyền gọi trực tiếp, khởi tạo hồ sơ thật qua migration 00280, ticket một lần, lịch sử và RLS. Không dùng dữ liệu production.
3. Áp dụng `20261102044150_scoped_account_management.sql` trước khi promote giao diện mới. Migration không gán chức vụ, chỉnh role, đổi mật khẩu, sửa bill, kho, ca hoặc máy in.
4. Kiểm tra owner đọc cơ cấu rỗng, quản lý ngoài phạm vi bị từ chối, số lượng profile/role/branch assignment không đổi. Kiểm tra giao diện trên mobile, iPad và laptop; không lưu bản mẫu hoặc đổi mật khẩu thật khi kiểm tra.
5. Không revert riêng API tạo user về bản cũ khi vẫn giữ migration mới: bản mới yêu cầu reservation server-only. Nếu cần dừng chức năng, giữ guard và đóng giao diện cấu hình, không mở lại RPC cũ ra authenticated.

## Giới hạn tải

Không polling hoặc theo dõi realtime bổ sung. Lịch sử chỉ tải khi mở và tối đa 30 dòng; nội dung phiên bản tải riêng. Xem trước chỉ xét người có quyền quản lý hiệu lực trong cơ cấu và giới hạn 10.000 cặp quản lý/nhân viên; vượt giới hạn sẽ dừng trước tính toán, không áp dụng một phần. Giới hạn tài liệu 1 MiB, 128 chức vụ/bộ phận và 1.024 phân công; không phải mô hình không giới hạn.

## Bổ sung: bảo vệ khởi tạo Auth

Trigger `handle_new_user` cũ còn đọc tenant/role/branch từ `raw_user_meta_data`. Đây là dữ liệu người dùng có thể tự sửa, không được dùng để cấp quyền. API tạo nhân viên bổ sung `app_metadata.managed_tenant_id` và `managed_role_id` sau khi kiểm tra phạm vi; trigger chỉ tin phần do server cấp, luôn khởi tạo nhân viên là `staff`. Việc bổ nhiệm owner vẫn qua luồng bảo vệ riêng.

**Thứ tự riêng cho bản bổ sung:** phát hành API bổ sung app_metadata trước (tương thích trigger cũ), rồi áp dụng `20261102180654_trusted_account_bootstrap.sql`. Trigger từ chối lời mời dùng metadata cũ nếu không có ngữ cảnh server; giữ nguyên bootstrap tenant độc lập, không sửa profile/Auth user hiện có. Không áp dụng guard trước API để tránh chặn tạo nhân viên hợp lệ ở phiên bản đang chạy.
