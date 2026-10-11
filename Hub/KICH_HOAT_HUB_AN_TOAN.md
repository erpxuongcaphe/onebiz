# Kích hoạt Hub Vận hành OneBiz an toàn

## Trạng thái hiện tại

Ngày 11/10/2026: chủ hệ thống đã duyệt bản khóa nền và phát hành khi kiểm tra đạt. Đã áp dụng bản khóa nền và tám migration Hub trên production, đối soát 18 bảng bật RLS, không có quyền ghi trực tiếp authenticated/anon, bucket riêng tư 5 MB, trigger liên kết MKT tồn tại. Chưa tạo mẫu, công việc, tài khoản hoặc sửa số liệu nghiệp vụ. Trạng thái deploy web được ghi riêng trong báo cáo phát hành; không suy ra từ việc SQL thành công.

Code và migration Hub được kiểm thử trên dữ liệu giả. Production chưa được thay đổi. Hai GET chỉ đọc ngày 10/10/2026 xác nhận cột nền `tenants`, `profiles`, `branches`, `mkt_tasks` có trong API; hàm `mkt_is_lead` được quảng bá. API trả 5 owner hoạt động thuộc 3 tenant. Không suy ra tài khoản đang đăng nhập là CEO và không tự chọn tenant thay người quản trị.

Ngày 11/10/2026 đã đọc catalog production: chưa có bảng/hàm `ops_*` hoặc bucket minh chứng Hub. Phát hiện RLS đang tắt trên `profiles`, `branches`, `tenants`, trong khi `authenticated` có quyền cập nhật `profiles.role/tenant_id/is_active`. **Chặn kích hoạt Hub cho tới khi rà và khóa nền phân quyền bằng phương án được duyệt riêng.** Xem `DOI_CHIEU_PRODUCTION_2026_10_11.md`. Không tự sửa quyền production để vượt điều kiện này.

## Trình tự phát hành

Phân quyền Hub hiện dùng nhóm quyền chung OneBiz và phạm vi chi nhánh. Sau khi khóa nền bảo mật, người cấu hình phải cấp quyền Hub cần thiết rồi phân công chi nhánh; không chỉ thêm người vào Hub và không tự mở rộng quyền cho admin. Xem `PHAN_QUYEN_HUB_2026_10_11.md` và hướng dẫn CEO bản Markdown đã cập nhật.

1. Giữ bộ code hiện tại; tách các file Hub khỏi thay đổi ERP/POS của AI khác. Không chạy `git add .`, không gom `.tmp`, ảnh test hoặc tài liệu gốc người dùng vào commit.
2. Chạy preflight chỉ đọc, xác nhận đúng project/tenant và tài khoản CEO. Đối chiếu cột/kết quả hàm nền với migration, đặc biệt `profiles`, `mkt_tasks`, `get_user_tenant_id` và `mkt_is_lead`.
3. Xác nhận có bản sao lưu và cách khôi phục trước SQL production. Không coi bản dump fixture local là sao lưu production. Không hứa có point-in-time recovery ở tài khoản free.
4. Sau khi được phép, áp dụng đúng thứ tự `00301` đến `00308`; mỗi file có giao dịch. Nếu lỗi, dừng ngay, không chạy tiếp hoặc chạy lại toàn bộ mù quáng. File đã thành công phải ghi nhận riêng vì tám file không phải một giao dịch chung.
5. Kiểm tra lại catalog, RLS, quyền execute, bucket riêng tư và trigger liên kết MKT. Không tự sửa vai trò CEO hoặc sinh mẫu/công việc thật.
6. Nghiệm thu trên bản phát hành được phép, chưa mở rộng người dùng: login chung, đúng chi nhánh, không đọc chéo tenant, công việc → kết quả → xác minh → To-do → doanh thu → thưởng → chốt/điều chỉnh.
7. Chỉ khi được phép deploy mới đưa code lên môi trường thật và kích hoạt lịch nhắc. Phải có người kiểm tra vòng đầu và theo dõi lỗi.

## Tên miền và đăng nhập

- Có thể dùng `onebiz.com.vn/hub`, không cần mua/tạo tài khoản riêng.
- Code có hỗ trợ `hub.onebiz.com.vn`; tên miền này chỉ dùng sau khi DNS, certificate và Vercel mapping được xác nhận. Không tự cấu hình DNS trong lượt này.
- Cookie chung dùng `.onebiz.com.vn`. Cần nghiệm thu thật giữa ERP, Hub, MKT và FnB, bao gồm refresh và logout. Kết quả local không chứng minh cookie trên production.
- Liên kết MKT mở đúng module/host, không thay quy trình duyệt MKT.

## Lịch nhắc việc

Mẫu `operations-cron.activation.example.json`: `0 22 * * *` theo UTC, tức 05:00 ngày hôm sau theo giờ Việt Nam. Đây là chạy mỗi ngày, không phải nhắc tức thời theo từng deadline. Hộp thông báo được cập nhật khi tải; không tự gửi email/Zalo.

Khi kích hoạt cần **thêm** lịch vào `vercel.json`, không thay các lịch đối soát kho/cuối ngày hiện có. Kiểm tra `CRON_SECRET`, quyền service role, giới hạn và log trước khi bật. Không ghi khóa vào Git hoặc hướng dẫn CEO.

## Quay lại khi có lỗi

Ưu tiên dừng lịch Hub mới và quay về bản web trước đó; giữ nguyên bảng/bằng chứng Hub. Không drop bảng, xóa tệp, giảm quyền toàn ERP hoặc khôi phục cả database để xử lý một lỗi giao diện.

Nếu trigger liên kết MKT gây lỗi thật, chỉ đề nghị gỡ riêng trigger `operations_mkt_link_changed` sau khi xác nhận nguyên nhân và được duyệt. Không gỡ trigger MKT khác. Mọi sửa data phải có SQL kiểm tra trước và phê duyệt riêng.

## Phạm vi commit cần tách

File mới: `src/app/hub`, `src/app/api/operations`, `src/app/api/cron/operations`, `src/components/operations`, `src/lib/operations`, `src/__tests__/operations` và tám migration Hub.

File có thay đổi từ nhiều phía: middleware Supabase, trang tasks MKT, nav/permission dùng chung. Chỉ chọn hunk cần cho Hub sau review; không ghi đè hoặc revert thay đổi AI khác. Tài liệu bàn giao chọn riêng, không đưa tệp nguồn Word của CEO hoặc dữ liệu thử vào commit.

## Điều kiện dừng

Nền phân quyền production chưa được khóa, chưa xác định CEO/tenant, chưa xác nhận sao lưu, build/test lỗi hoặc chưa được phép phát hành thì dừng ở chuẩn bị. Preflight catalog đã có, nhưng chưa đồng nghĩa được phép kích hoạt. Không gọi đó là “đã live”. Không cần tạo tài khoản quản lý/bảo trì thật để hoàn thiện code.
