# Rollout MKT Hub lên Production

Làm **tuần tự**. Mỗi bước xong mới sang bước sau. Project Vercel: **onebiz-erp**.

## 0. Trước khi bắt đầu
- [ ] PR đã CI xanh, đã review.
- [ ] UAT staging (`docs/UAT-MKT-HUB.md`) pass 100%.
- [ ] Có bot Telegram (BotFather) → lấy `TELEGRAM_BOT_TOKEN` + username bot.
- [ ] Tự đặt 1 chuỗi bí mật `TELEGRAM_WEBHOOK_SECRET` (vd 32 ký tự ngẫu nhiên).

## 1. Backup Supabase production
- [ ] Supabase Dashboard → Database → Backups → tạo backup/point-in-time checkpoint **trước** khi migrate.

## 2. Apply migration (một người chạy)
```bash
supabase link --project-ref <PROD_REF>
supabase migration list            # đối chiếu các migration chưa apply
supabase db push                   # apply theo thứ tự: 00168, 00170, 00171, 00172, 00174
```
- [ ] Xác nhận các migration MKT 00168, 00170, 00171, 00172 và 00174 apply thành công; 00169 (order_code) và 00173 (invoice soft-delete) là migration ERP độc lập.
- [ ] Chạy `supabase/verify_mkt_hub_security.sql` (Phần A + B) trên SQL Editor prod — mọi `pass = true`.
- [ ] KHÔNG chạy seed staging trên production.

## 3. Env production (Vercel → onebiz-erp → Settings → Environment Variables → Production)
Thêm/ý xác nhận đã có:
- [ ] `TELEGRAM_BOT_TOKEN` = token từ BotFather
- [ ] `TELEGRAM_BOT_USERNAME` = username bot (không có @)
- [ ] `TELEGRAM_WEBHOOK_SECRET` = chuỗi bí mật tự đặt
- [ ] `MKT_HUB_BASE_URL` = `https://mkthub.onebiz.com.vn`
- [ ] `ONEBIZ_BASE_URL` = `https://onebiz.com.vn`
- [ ] `CRON_SECRET` = (đã có — xác nhận)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` = (đã có — xác nhận)
> Lưu ý: KHÔNG có `NEXT_PUBLIC_BYPASS_AUTH`. `BYPASS_AUTH` phải để trống/false trên production.

## 4. Kết nối domain `mkthub.onebiz.com.vn`
Làm **giống hệt** cách `fnb.onebiz.com.vn` đã cấu hình (subdomain đã chạy → pattern đã đúng).

**4a. Trên Vercel** (Dashboard → project onebiz-erp → Settings → Domains):
- [ ] Add Domain → nhập `mkthub.onebiz.com.vn` → Add.
- [ ] Vercel hiển thị bản ghi DNS cần tạo (thường là **CNAME → `cname.vercel-dns.com`**). Ghi lại đúng giá trị Vercel yêu cầu (có thể khác tuỳ cấu hình).

**4b. Tại nhà cung cấp tên miền** (nơi quản lý DNS của `onebiz.com.vn`):
- [ ] Tạo bản ghi:
  - Type: **CNAME**
  - Name/Host: **mkthub**
  - Value/Target: **cname.vercel-dns.com** (hoặc đúng giá trị Vercel hiển thị ở 4a)
  - TTL: mặc định
- [ ] Đối chiếu bản ghi `fnb` sẵn có — `mkthub` phải cùng kiểu trỏ.

**4c. Chờ + xác minh:**
- [ ] Quay lại Vercel Domains, đợi trạng thái `mkthub.onebiz.com.vn` chuyển **Valid Configuration** (vài phút đến vài giờ tuỳ DNS).
- [ ] Mở `https://mkthub.onebiz.com.vn` → phải hiện trang đăng nhập OneBiz, đăng nhập xong vào thẳng MKT Hub.
> Middleware đã tự nhận `mkthub.*` (giống `fnb.*`) và cookie đăng nhập dùng chung `.onebiz.com.vn` — không cần đổi code.

## 5. Đăng ký webhook Telegram
Sau khi có domain + env, gọi 1 lần (thay `<TOKEN>` và `<SECRET>`):
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://onebiz.com.vn/api/telegram/webhook",
    "secret_token": "<SECRET>",
    "allowed_updates": ["message"],
    "drop_pending_updates": true
  }'
```
- [ ] Nhận `{"ok":true}`.
- [ ] Kiểm tra: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` → đúng URL + `has_custom_certificate:false`.
> Webhook trỏ domain chính `onebiz.com.vn` (không phải mkthub) — API dùng chung, không phụ thuộc subdomain.

## 6. Merge + Deploy
- [ ] Merge PR vào `main` (CI xanh) → Vercel tự deploy production.
- [ ] Vercel → Deployments: xác nhận deploy Ready.
- [ ] Vercel → Settings → Cron Jobs: đúng **2 job** (`stock-reconciliation`, `end-of-day`). MKT dùng `after()` + sweeper trong `end-of-day` (Hobby chỉ cho 2 cron).

## 7. Smoke test production
- [ ] Đăng nhập qua `mkthub.onebiz.com.vn` → vào MKT Hub theo đúng vai trò.
- [ ] `/api/health` OK.
- [ ] Tạo 1 chiến dịch thử → chia việc → 1 người nhận → nhận **Telegram trong ~10 giây** (sau khi đã liên kết ở /mkt/settings).
- [ ] Kiểm audit_log ghi các hành động MKT.
- [ ] User không có quyền `mkt.view` → không thấy menu MKT Hub, vào /mkt báo "chưa được cấp quyền".

## 8. Gán quyền thật
- [ ] Cài đặt → Phân quyền: tạo vai trò từ template **MKT Lead / MKT Executor / MKT Reviewer**, gán nhân sự.
- [ ] Quyền duyệt nội dung **rủi ro cao (High/Critical)** = `mkt.override_campaign` → chỉ CEO/owner giữ.

## Rollback (nếu cần)
- Code: revert commit merge trên `main` → Vercel tự deploy lại bản trước.
- DB: khôi phục từ backup bước 1 (migration MKT chỉ THÊM bảng `mkt_*`, không sửa bảng ERP cũ → rủi ro thấp).
