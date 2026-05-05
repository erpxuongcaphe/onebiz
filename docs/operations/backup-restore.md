# Backup & Disaster Recovery — OneBiz ERP

> **Sprint LT-4** (CEO 04/05/2026)
> Tài liệu hướng dẫn khôi phục dữ liệu khi sự cố. Đọc kỹ khi setup, in ra để dán cạnh máy hoặc lưu trên điện thoại để dùng khi khẩn cấp.

---

## 1. Tóm tắt nhanh — khi sự cố xảy ra

| Tình huống | Hành động đầu tiên | Section |
|---|---|---|
| Xoá nhầm 1 row / vài row | Restore 1 record từ audit log hoặc PITR | §5.1 |
| Xoá nhầm cả bảng (DROP TABLE) | Restore từ daily backup hoặc PITR | §5.2 |
| Migration sai → schema hỏng | Rollback migration + restore | §5.3 |
| Hack / SQL injection | Cô lập + restore + thông báo | §5.4 |
| Toàn bộ project bị xoá | Liên hệ Supabase support | §5.5 |
| Code Vercel mới có bug | Rollback deployment | §6 |

**Checklist khẩn cấp** (dán cạnh máy):
1. ⏸ Ngừng nhận đơn (đóng POS)
2. 📞 Báo cashier tạm dừng
3. 🔍 Xác định scope (1 row? 1 bảng? toàn DB?)
4. 📸 Screenshot trước khi sửa
5. ⚙️ Theo procedure tương ứng
6. ✅ Verify sau khi restore
7. 📞 Báo cashier resume

---

## 2. Supabase backup — cơ chế tự động

### Free Plan (current)
- **Auto backup hằng ngày** (3:00 AM UTC = 10:00 AM giờ VN)
- **Retention 7 ngày** — chỉ giữ 7 backup gần nhất
- **No PITR** (Point-In-Time Recovery)
- Truy cập: Supabase Dashboard → Database → **Backups**

### Pro Plan ($25/tháng) — đề xuất nếu chuỗi mở rộng
- Auto backup hằng ngày, retention **14 ngày**
- **PITR** — restore tới giây bất kỳ trong **7 ngày** gần nhất
- Backup retention up to 30 ngày
- Nâng cấp: Supabase Dashboard → Settings → Subscription

### Tự backup thêm (recommended)
Mỗi tuần CEO/admin tự download 1 bản backup về máy local:
1. Supabase Dashboard → Database → Backups
2. Click vào backup ngày gần nhất → **Download** (file .sql ~10-100MB)
3. Lưu vào Google Drive / Dropbox / ổ cứng riêng (tách khỏi Supabase)
4. Naming convention: `onebiz-backup-YYYY-MM-DD.sql`

Lý do: nếu Supabase project bị xoá nhầm hoặc account bị hack → vẫn còn bản local.

---

## 3. Vercel deployment — cơ chế

- Vercel **giữ tất cả deployment cũ** (không có giới hạn thời gian)
- Mỗi commit push → 1 deployment riêng → có thể rollback bất cứ lúc nào
- Truy cập: Vercel Dashboard → Project → **Deployments** → click deployment cũ → **Promote to Production**

---

## 4. Khi nào nên restore?

**KHÔNG restore vội** trong 30 phút đầu sau sự cố. Trước khi restore:

1. **Xác định scope chính xác**:
   - 1 row hay 1 bảng hay toàn DB?
   - Khi nào dữ liệu bị mất / bị sai?
   - Có ai đó vẫn đang ghi data không?
2. **Screenshot hiện trạng**:
   - Lỗi gì hiện ra
   - Page nào, user nào báo
   - Console error (F12)
3. **Đóng POS tạm thời** (nếu data bị corrupt):
   - Tránh cashier tiếp tục bán → tạo data mới chen vào → khó restore sạch
4. **Quyết định**:
   - Có thể fix tay không? (vd 1 customer bị xoá nhầm — re-add tay)
   - Hay cần restore? (vd 100+ row mất)

→ Restore là phương án cuối — sẽ mất data từ lúc backup đến lúc restore. Vd: backup 10:00 sáng, restore lúc 5:00 chiều → mất 7 giờ giao dịch.

---

## 5. Recovery procedures

### 5.1 Xoá nhầm 1-vài row

**Phát hiện**:
- Customer/Cashier báo "không tìm thấy đơn hôm trước"
- KPI giảm bất thường
- Audit log show DELETE

**Phương án 1 — Restore từ audit log (best, không mất data khác)**:

```sql
-- 1. Tìm bản ghi đã xoá trong audit_log
SELECT * FROM public.audit_log
WHERE action = 'delete'
  AND entity_type = 'invoice'  -- hoặc 'customer', 'product'...
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 50;

-- 2. Lấy old_data của row đã xoá
SELECT old_data FROM public.audit_log
WHERE id = 'AUDIT_LOG_UUID_FROM_STEP_1';

-- 3. INSERT lại từ old_data (manual, copy field từ JSON)
INSERT INTO public.invoices (id, code, customer_name, total, ...)
VALUES (...);
```

**Phương án 2 — Restore từ PITR (Pro plan only)**:

1. Supabase Dashboard → Database → **Backups** → tab **Point In Time**
2. Chọn timestamp TRƯỚC khi xoá (vd 5 phút trước sự cố)
3. **Restore to new project** (KHÔNG restore in-place — mất data hiện tại)
4. Sau khi project mới có, copy tay row cần khôi phục từ project mới sang project chính
5. Xoá project tạm

### 5.2 Xoá nhầm cả bảng (DROP TABLE)

**Phát hiện**:
- Trang admin báo "table not found"
- Tất cả data của 1 entity biến mất

**Procedure**:

1. **NGỪNG mọi thao tác** — đóng POS toàn bộ chi nhánh
2. Vào Supabase Dashboard → Database → **Backups**
3. Chọn backup gần nhất (24h gần nhất)
4. Click **Restore** → confirm
5. Đợi 5-30 phút (tuỳ size DB)
6. Verify: chạy query `SELECT COUNT(*) FROM <table>` → đúng số row
7. Báo cashier resume

⚠️ **Mất data** từ lúc backup đến lúc xoá nhầm. Vd: backup 10:00, xoá 3:00 chiều → mất 5 giờ giao dịch. Audit log có thể giúp re-create 1 phần.

### 5.3 Migration sai → schema corrupt

**Phát hiện**:
- App báo lỗi `column "xxx" does not exist` hoặc `type mismatch`
- Sau khi anh apply 1 migration mới

**Procedure**:

1. **Rollback migration**:
   - Migration là 1 SQL file. Đảo lại các thay đổi (vd `ALTER TABLE ADD COLUMN x` → `ALTER TABLE DROP COLUMN x`)
   - Chạy SQL rollback trong Supabase SQL Editor
2. Nếu không thể rollback (vd đã DROP COLUMN có data):
   - Restore từ daily backup (§5.2)
   - Hoặc PITR (Pro plan, §5.1 phương án 2)
3. Fix migration script + test trên staging trước khi apply lại
4. Resume

### 5.4 Hack / SQL injection / unauthorized data modification

**Phát hiện**:
- Data bị thay đổi bất thường (giá sai, đơn lạ)
- Audit log có user lạ
- Sentry có error suspicious

**Procedure**:

1. **Cô lập**:
   - Đổi password Supabase (Dashboard → Settings → Database → Reset password)
   - Revoke tất cả API keys (Settings → API → Reset)
   - Đổi password Vercel + Sentry account
2. **Audit damage**:
   - Query audit_log trong 24-72h trước
   - Identify user_id của attacker (nếu có)
   - List entities bị modify
3. **Restore**:
   - PITR đến trước thời điểm hack (Pro plan)
   - Hoặc restore daily backup (Free)
4. **Báo cáo**:
   - Email/Zalo CEO + tất cả admin
   - Nếu có thông tin khách bị lộ → thông báo khách
5. **Hardening**:
   - Review RLS policies — có policy nào cho phép unauthenticated access không?
   - Check API key có lộ ở đâu không (GitHub public, screenshot...)
   - Setup 2FA cho Supabase + Vercel + Sentry account

### 5.5 Toàn bộ project bị xoá

**Phát hiện**:
- Supabase Dashboard không thấy project
- App báo connection failed

**Procedure**:

1. **KHÔNG hoảng** — Supabase giữ deleted projects 1 thời gian
2. Vào https://supabase.com/dashboard/account → **Recently Deleted**
3. Click **Restore** trong vòng 7 ngày
4. Nếu quá 7 ngày → liên hệ support@supabase.io ngay (có thể recover nhưng không guarantee)
5. Cùng lúc, restore từ bản local backup (§2 — tự backup)
6. Update env var `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` trên Vercel nếu URL đổi
7. Redeploy Vercel

---

## 6. Vercel rollback (code mới có bug)

**Phát hiện**:
- Cashier báo "web vừa update, hỏng X chức năng"
- Sentry tăng đột biến error sau 1 deploy

**Procedure**:

1. Vercel Dashboard → Project → **Deployments**
2. Tìm deployment **trước** deployment hiện tại (commit cũ hơn)
3. Click vào deployment đó → **⋯** (3 dấu chấm) → **Promote to Production**
4. Confirm — Vercel switch traffic sang version cũ trong 30 giây
5. Cashier reload web → version cũ
6. Sau khi rollback xong, fix bug → push commit mới → deploy lại

⚠️ Nếu code mới có **migration DB không backward compatible** với code cũ → rollback Vercel xong vẫn lỗi vì DB schema đã đổi. Cần rollback cả DB (§5.3) hoặc fix forward.

---

## 7. Test schedule (recommended)

| Hành động | Tần suất | Người làm |
|---|---|---|
| Tự download backup local | Hàng tuần | CEO/Admin |
| Test restore 1 row từ audit log | Hàng tháng | CEO + dev |
| Test restore daily backup vào staging | Hàng quý | Dev |
| Test full disaster recovery (xoá staging + restore) | Hàng năm | CEO + dev |

→ Test thường xuyên = procedure này có hiệu lực thật. Không test = chỉ là giấy.

---

## 8. Liên hệ khẩn cấp

| Service | Support URL | Response time |
|---|---|---|
| **Supabase** | support@supabase.io | 24-48h (free) / <8h (pro) |
| **Vercel** | https://vercel.com/help | 24h (hobby) / <4h (pro) |
| **Sentry** | https://sentry.io/support | 48h (free) / <24h (paid) |

**Internal**:
- Owner CEO: [phone/Zalo]
- IT/Dev: [Claude qua chat hoặc email]

---

## 9. Checklist pre-deploy (code mới)

Trước khi push commit có migration:
- [ ] `npx tsc --noEmit` pass
- [ ] `npx vitest run` pass
- [ ] Migration SQL test trên staging Supabase (nếu có)
- [ ] Backup local trước khi apply migration prod
- [ ] Schedule push vào giờ ít user (sáng sớm hoặc tối muộn)
- [ ] Có người monitor Sentry trong 30p sau deploy

---

## 10. Phụ lục — Useful queries

### Đếm số row mỗi bảng (verify sau restore)
```sql
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
```

### Audit log gần nhất
```sql
SELECT
  created_at, action, entity_type, entity_id, user_id
FROM public.audit_log
ORDER BY created_at DESC
LIMIT 100;
```

### Check disk usage
```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
```

---

> Last updated: 2026-05-05 — Sprint LT-4
> Next review: Hàng quý (CEO + dev)
