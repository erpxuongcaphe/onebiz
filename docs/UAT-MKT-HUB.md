# UAT MKT Hub — Kịch bản nghiệm thu (chạy trên STAGING)

Mục tiêu: xác minh toàn bộ quy trình + guardrail trước khi rollout production.
Chạy sau khi đã apply migration `00167 → 00168 → 00169 → 00170` và `seed_mkt_hub_staging.sql`
lên Supabase **staging**. Đánh dấu ✅/❌ từng mục.

## Chuẩn bị
- [ ] Apply 3 migration + seed lên staging.
- [ ] Chạy `supabase/verify_mkt_hub_security.sql` (Phần A + B) — tất cả cột `pass = true`.
- [ ] Gán quyền: 1 user **MKT Lead** (role template), 1 user **MKT Executor**, CEO = owner.
- [ ] Truy cập `https://<staging-host>/mkt` hoặc subdomain `mkthub.<staging>`.

## Kịch bản nghiệp vụ (đăng nhập bằng Lead trừ khi ghi rõ)

1. [ ] **Tạo chiến dịch không checklist** → mức Sẵn sàng hiển thị **0%** (không phải 100%).
2. [ ] Thêm 3–4 mục readiness (Ops/Kế toán/CEO/Kho). Đăng nhập đúng vai trò xác nhận được;
       **user sai vai trò bấm Xác nhận → báo lỗi INSUFFICIENT_ROLE**.
3. [ ] Bấm **Chạy chiến dịch** khi readiness < 100% → bị chặn, hiện dialog Override.
       - Lead **không có** quyền override → không chạy được.
       - CEO (owner) nhập lý do → chạy được; kiểm tra **Exception Log** có dòng `is_exception`.
4. [ ] Tab **Kênh triển khai** → Thêm kênh → **Chia Task Ngay** (builder công đoạn).
       Task nối tuần tự: task sau ở trạng thái **Blocked** cho tới khi task trước Done.
5. [ ] Đăng nhập **Executor** → **Việc của tôi**: thấy task được giao ở "Chờ tôi xác nhận".
       - **Nhận việc** đúng người → chuyển To Do.
       - (Kiểm tra chéo) Executor **KHÔNG** thấy task của người khác ở mọi màn.
6. [ ] Executor **Từ chối** / **Cần trao đổi** (bắt buộc lý do) → task lên **Leader Queue**
       + Lead nhận **thông báo Telegram trong vài giây** (nếu đã liên kết).
7. [ ] Task có phụ thuộc: **Bắt đầu** bị chặn khi task trước chưa Done; xong task trước → mở khoá.
8. [ ] Executor **Nộp duyệt** (nhập link) → tạo version mới, nội dung sang **Pending Review**,
       reviewer nhận Telegram.
9. [ ] **Duyệt nội dung**: yêu cầu sửa 3 lần → nội dung xuất hiện ở Leader Queue (**REVISION_OVER_LIMIT**).
10. [ ] Nội dung **rủi ro cao (High/Critical)**: user chỉ có `review_content` bấm Duyệt → **403**;
        CEO (có override) duyệt được.
11. [ ] Task **Publish**: bị chặn hoàn tất khi nội dung chưa Approved (CONTENT_NOT_APPROVED).
12. [ ] Leader Queue: **Giao lại** (chọn người + lý do) / **Huỷ** / **Ép hoàn tất** (lý do → Exception Log).
13. [ ] Task kẹt phụ thuộc **chỉ vào Leader Queue sau > 2 ngày** (giả lập bằng cách sửa `created_at`
        của task blocked về quá khứ trên staging).
14. [ ] **Telegram**: /mkt/settings → Kết nối → mở bot → `/start link_...` → "Đã liên kết".
        Token dùng 1 lần (bấm liên kết cũ lần 2 → không hợp lệ). Ngắt liên kết được.

## Bảo mật (SQL Editor staging)
- [ ] `verify_mkt_hub_security.sql` Phần C1: Executor `set request.jwt.claims` → chỉ thấy task của mình.
- [ ] Phần C2: Executor gọi `mkt_record_audit(...)` → **permission denied**.
- [ ] Phần C3: role `anon` gọi `get_mkt_campaign_readiness_score` → **permission denied**.

## Kết luận
- [ ] Tất cả mục ✅ → sẵn sàng rollout production (xem `docs/ROLLOUT-MKT-HUB.md`).
