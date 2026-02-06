# 🔧 HƯỚNG DẪN APPLY MIGRATION 066

**Status:** ⚠️ Migration chưa apply vào database
**Required:** Migration 066 cần được apply trước khi test Phase 2

---

## CÁCH 1: Apply qua Supabase Dashboard (KHUYÊN DÙNG)

### Bước 1: Mở Supabase Dashboard
1. Truy cập: https://supabase.com/dashboard/project/nppumpxtjoirwhwgbvoo
2. Login với tài khoản của anh
3. Chọn project **OneBiz ERP**

### Bước 2: Mở SQL Editor
1. Click menu bên trái: **SQL Editor**
2. Click **+ New query**

### Bước 3: Copy & Paste Migration SQL
1. Mở file: `E:\JD-erp\supabase\migrations\066_pos_shift_close_and_search.sql`
2. Copy toàn bộ nội dung (230 lines)
3. Paste vào SQL Editor

### Bước 4: Run Migration
1. Click nút **Run** (hoặc Ctrl+Enter)
2. Đợi ~5-10 giây
3. Kiểm tra kết quả:
   - ✅ "Success. No rows returned" → Thành công!
   - ❌ Error message → Copy lỗi và báo lại

### Bước 5: Verify Migration
Chạy query này để kiểm tra:
```sql
-- Check columns added
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'pos_shifts'
  AND column_name IN ('total_sales', 'actual_cash', 'cash_variance');

-- Check RPCs created
SELECT routine_name
FROM information_schema.routines
WHERE routine_name IN ('pos_get_shift_summary', 'pos_close_shift', 'pos_search_orders');
```

Kết quả mong đợi:
- 3 columns: total_sales, actual_cash, cash_variance
- 3 RPCs: pos_get_shift_summary, pos_close_shift, pos_search_orders

---

## CÁCH 2: Apply qua CLI (Nếu Cách 1 không được)

### Option A: Skip conflict migrations
```bash
cd E:\JD-erp

# Create a temporary copy of migration 066
copy supabase\migrations\066_pos_shift_close_and_search.sql supabase\migrations\20260203_pos_phase2.sql

# Apply only this one
npx supabase db push
```

### Option B: Apply SQL directly via psql
```bash
# Cần có connection string từ Supabase Dashboard
psql "postgresql://postgres:[PASSWORD]@db.nppumpxtjoirwhwgbvoo.supabase.co:5432/postgres" -f supabase/migrations/066_pos_shift_close_and_search.sql
```

---

## SAU KHI APPLY THÀNH CÔNG

### ✅ Checklist Migration
- [ ] 10 columns mới trong `pos_shifts` table
- [ ] Index `idx_pos_shifts_stats` created
- [ ] RPC `pos_get_shift_summary()` exists
- [ ] RPC `pos_close_shift()` exists
- [ ] RPC `pos_search_orders()` exists

### 🧪 Test Migration
Chạy test query này:
```sql
-- Test pos_get_shift_summary (should return empty or error "Shift không tồn tại")
SELECT * FROM pos_get_shift_summary('00000000-0000-0000-0000-000000000000');

-- Test pos_search_orders
SELECT * FROM pos_search_orders(
  (SELECT id FROM branches LIMIT 1),
  NULL,
  CURRENT_DATE,
  CURRENT_DATE,
  10
);
```

---

## 🚀 SAU KHI APPLY → BẮT ĐẦU TEST

App đã chạy ở: **http://localhost:3001**

### Test Flow:
1. Login vào system
2. Vào trang **Bán hàng POS**
3. Test 3 tính năng mới:
   - ✅ Button "Đóng Ca" (nếu đã mở ca)
   - ✅ Button "Tra Cứu Đơn"
   - ✅ Stock số lượng hiển thị trên product card

### Chi tiết test scenarios:
Xem file: `QUICK_TEST_CHECKLIST.md`

---

## ⚠️ NẾU GẶP LỖI

### Lỗi: "function does not exist"
→ Migration chưa apply, quay lại Bước 3

### Lỗi: "column does not exist"
→ ALTER TABLE chưa chạy, check Supabase logs

### Lỗi: "permission denied"
→ User chưa có quyền `pos.shift.update`, gán role trong Settings

---

**Liên hệ:** Nếu stuck, screenshot lỗi + báo lại để em hỗ trợ!
