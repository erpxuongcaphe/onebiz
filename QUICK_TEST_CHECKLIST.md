# ✅ QUICK TEST CHECKLIST - Phase 2

**URL:** http://localhost:3000
**Time Needed:** ~15 phút
**Pre-requisites:** Login + Open shift

---

## 🚀 5-MINUTE SMOKE TEST

### 1️⃣ Visual Check (30 giây)
- [ ] Vào trang "Bán hàng POS"
- [ ] Thấy button **"Đóng Ca"** (màu vàng cam)
- [ ] Thấy button **"Tra Cứu Đơn"** (màu trắng)

### 2️⃣ Order Search (2 phút)
- [ ] Click **"Tra Cứu Đơn"**
- [ ] Modal hiện ra ✅
- [ ] Có search box + date filters
- [ ] Click X → Modal đóng
- [ ] **No console errors** (F12)

### 3️⃣ Close Shift (2 phút)
- [ ] Click **"Đóng Ca"**
- [ ] Modal hiện ra (hoặc disabled nếu chưa mở ca)
- [ ] Thấy shift info + payment breakdown
- [ ] Click X → Modal đóng
- [ ] **No console errors**

---

## 📊 15-MINUTE FULL TEST

### 4️⃣ Order Search - Filters (2 phút)
- [ ] Open modal
- [ ] Click "Hôm nay" → Shows today's orders
- [ ] Click "7 ngày" → Shows more orders
- [ ] Type in search box → Results filter
- [ ] Click order → Detail view opens

### 5️⃣ Order Reprint (2 phút)
- [ ] Find an order in search results
- [ ] Click 🖨️ Printer icon
- [ ] Modal closes + Print UI appears
- [ ] Correct order shown

### 6️⃣ Close Shift - Full Flow (5 phút)
- [ ] Mở ca nếu chưa có (500k opening cash)
- [ ] Bán vài sản phẩm (mix payment: cash, bank)
- [ ] Click "Đóng Ca"
- [ ] Thấy summary với breakdown
- [ ] **Test variance = 0:**
   - [ ] Nhập actual cash = expected
   - [ ] Variance = 0 (xanh)
   - [ ] No textarea
   - [ ] Click "Đóng Ca" → Success
- [ ] **Test variance ≠ 0:**
   - [ ] Mở ca mới
   - [ ] Nhập actual cash ≠ expected
   - [ ] Variance hiển thị (đỏ/xanh)
   - [ ] Textarea xuất hiện
   - [ ] Submit without notes → Error
   - [ ] Add notes → Success

### 7️⃣ Stock Refresh (2 phút)
- [ ] Note stock của 1 sản phẩm (VD: "Còn: 10")
- [ ] Bán 2 cái
- [ ] Đợi 1-2 giây
- [ ] Stock update → "Còn: 8" ✅

### 8️⃣ Error Handling (2 phút)
- [ ] Try "Đóng Ca" khi chưa mở ca → Disabled
- [ ] Search order không tồn tại → Empty state
- [ ] DevTools Offline → Error message

---

## ✅ PASS CRITERIA

**PASS nếu:**
- ✅ All modals open/close smoothly
- ✅ No console errors
- ✅ Data loads correctly
- ✅ Calculations accurate (variance)
- ✅ Validations work (required notes)
- ✅ Stock refreshes after sale

**FAIL nếu:**
- ❌ Modal không mở
- ❌ Console errors
- ❌ Data không load
- ❌ Calculation sai
- ❌ Can submit invalid data
- ❌ Stock không update

---

## 🐛 IF BUGS FOUND

1. **Screenshot** màn hình lỗi
2. **Copy** console error (F12 → Console)
3. **Note** steps to reproduce
4. **Tell** em để fix!

---

## 📞 QUICK HELP

**Modal không mở?**
→ Check console for import errors

**RPC error?**
→ Migration 066 chưa chạy (cần run `supabase db push`)

**Stock không refresh?**
→ Check Network tab, verify fetch request

**Button disabled?**
→ Check shift status or permissions

---

**Ready to test?** Open http://localhost:3000 ngay! 🚀
