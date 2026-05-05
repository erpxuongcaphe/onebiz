# 🚨 Emergency Runbook — Quick Reference

> **In ra giấy + dán cạnh máy. Lưu PDF trong điện thoại CEO.**
> Khi sự cố — đừng panic, đọc tờ này trước.

---

## ⏸ STEP 0 — DỪNG TRƯỚC

1. **Đóng POS** ở tất cả chi nhánh (báo cashier qua Zalo/điện thoại)
2. **Screenshot màn hình lỗi** + mở DevTools F12 → Console → screenshot
3. **Note giờ phát hiện** (dùng cho restore PITR sau)

---

## 🔍 STEP 1 — XÁC ĐỊNH SCOPE

| Triệu chứng | Section |
|---|---|
| 1 đơn / vài đơn biến mất | A |
| Cả bảng (vd "Khách hàng" rỗng) | B |
| App báo "column not found" sau deploy | C |
| Data thay đổi bất thường (giá sai, KH lạ) | D |
| Toàn bộ web không vào được | E |
| Web mới deploy hỏng nhiều chức năng | F |

---

## A. 1 đơn biến mất

```
Supabase Dashboard → SQL Editor → Run:

SELECT * FROM audit_log
WHERE action = 'delete' AND entity_type = 'invoice'
ORDER BY created_at DESC LIMIT 20;
```
→ Tìm row, copy `old_data` JSON, INSERT lại tay.

**Nếu không có audit_log**: dùng PITR (Pro plan) hoặc daily backup (Free).

---

## B. Cả bảng biến mất / corrupt

```
Supabase Dashboard → Database → Backups
→ Chọn backup gần nhất → Restore
→ Đợi 5-30 phút → verify SELECT COUNT(*)
```

⚠️ **Mất data** từ lúc backup đến hiện tại. Audit log có thể recover 1 phần.

---

## C. Migration sai → schema corrupt

```
1. Mở migration file vừa apply
2. Viết SQL ngược lại (DROP COLUMN nếu vừa ADD)
3. Run trong Supabase SQL Editor
4. Resume
```

Nếu không thể rollback (đã DROP COLUMN có data) → **Restore daily backup (B)**.

---

## D. Hack / Data lạ

```
1. Đổi password ngay:
   - Supabase: Settings → Database → Reset password
   - Vercel: Account → Security → Change password
2. Revoke API key:
   - Supabase: Settings → API → Reset anon key + service key
3. PITR đến trước thời điểm hack (Pro plan)
   HOẶC restore daily backup (Free)
4. Email tất cả admin + cashier
```

---

## E. Web không vào được

```
1. Check https://onebiz.com.vn/api/health
   → Nếu 503 db error: Supabase down → check status.supabase.com
   → Nếu 404 / không response: Vercel down → check vercel-status.com
   → Nếu 200 ok nhưng UI lỗi: code bug → STEP F
2. Check https://supabase.com/dashboard
   → Nếu project không hiện: account/Recently Deleted → Restore
```

---

## F. Code mới có bug — Vercel rollback

```
Vercel Dashboard → Deployments
→ Tìm deployment TRƯỚC deployment hiện tại
→ ⋯ (3 chấm) → Promote to Production
→ Confirm → 30s sau cashier reload thấy version cũ
```

⚠️ Nếu deploy mới có **migration DB** đi kèm → rollback Vercel xong vẫn lỗi. Phải rollback cả DB (B).

---

## ✅ STEP 2 — VERIFY SAU RESTORE

```sql
-- Check số row các bảng quan trọng
SELECT 'invoices' AS t, COUNT(*) FROM invoices
UNION SELECT 'customers', COUNT(*) FROM customers
UNION SELECT 'products', COUNT(*) FROM products
UNION SELECT 'stock_movements', COUNT(*) FROM stock_movements;
```

Đối chiếu với số liệu trước sự cố (CEO nhớ hoặc check báo cáo gần nhất).

---

## 📞 STEP 3 — RESUME + REPORT

1. Mở POS lại
2. Báo cashier qua Zalo: "Đã khắc phục, tiếp tục bán bình thường"
3. Email CEO/Co-founder report:
   - Sự cố gì xảy ra
   - Khi nào (giờ:phút)
   - Đã fix bằng cách nào
   - Mất bao nhiêu data
   - Action item phòng ngừa
4. Cập nhật `docs/operations/incidents.md` (nếu có) với incident mới

---

## 🆘 LIÊN HỆ KHẨN

| Đối tác | Cách liên hệ |
|---|---|
| Supabase support | support@supabase.io |
| Vercel support | https://vercel.com/help |
| Sentry support | https://sentry.io/support |
| Status page | status.supabase.com / vercel-status.com |

---

## ⚙️ SUPABASE LOGIN

URL: https://supabase.com/dashboard
Project: **OneBiz ERP** (ID lưu trong .env)

---

## 🌐 VERCEL LOGIN

URL: https://vercel.com/dashboard
Project: **onebiz** (hoặc tên project anh đặt)

---

> **Hít thở sâu. Đừng vội. Dữ liệu Supabase tự backup hằng ngày — sẽ khôi phục được. Theo từng bước.**
