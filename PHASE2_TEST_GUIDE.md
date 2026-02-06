# 🧪 PHASE 2 - MANUAL TEST GUIDE

**Ngày:** 2026-02-03
**Tính năng:** Close Shift Modal + Order Search Modal + Stock Refresh
**Trạng thái:** ✅ Code Integration Complete - Ready for Manual Testing

---

## 📊 PRE-TEST CHECKLIST

### ✅ Code Verification (Automated - Already Passed)
- [x] TypeScript build successful (no errors)
- [x] All files created:
  - `components/pos/CloseShiftModal.tsx` (~350 lines)
  - `components/pos/OrderSearchModal.tsx` (~400 lines)
  - `supabase/migrations/066_pos_shift_close_and_search.sql` (~230 lines)
- [x] POS.tsx integration:
  - [x] Import statements added (lines 8-9)
  - [x] State variables added (lines 66-67)
  - [x] Buttons replaced (lines 395-409)
  - [x] Modals added (lines 1003-1026)
  - [x] Stock refresh useEffect (lines 298-312)
- [x] Helper functions in lib/pos.ts:
  - [x] `fetchShiftSummary()`
  - [x] `closeShiftWithReconciliation()`
  - [x] `searchPosOrders()`

### ⏳ Database Migration (Need to verify)
- [ ] Migration 066 applied to database
- [ ] New columns exist in `pos_shifts` table
- [ ] RPCs created: `pos_get_shift_summary`, `pos_close_shift`, `pos_search_orders`

---

## 🚀 MANUAL TEST SCENARIOS

### 📋 TEST 1: Order Search Modal - UI Rendering (2 min)

**Objective:** Verify modal displays correctly without errors

**Prerequisites:**
- App running at http://localhost:3000
- User logged in with POS access

**Steps:**
1. Navigate to "Bán hàng POS" page
2. Look at top-right corner - verify 2 buttons exist:
   - ✅ "Đóng Ca" button (amber/yellow color)
   - ✅ "Tra Cứu Đơn" button (white/gray color)
3. Click **"Tra Cứu Đơn"** button
4. Verify modal appears with:
   - ✅ Title: "Tra Cứu Đơn Hàng" with Search icon
   - ✅ Close button (X) in top-right
   - ✅ Search input box (placeholder: "Tìm theo số đơn hoặc tên khách hàng...")
   - ✅ "Tìm" button (blue)
   - ✅ 4 date filter buttons:
     - "Hôm nay" (selected by default, blue)
     - "7 ngày"
     - "30 ngày"
     - "Tùy chọn"
   - ✅ Results count text: "Tìm thấy X đơn hàng"
   - ✅ Empty results table (if no orders) or table with orders

**Expected Results:**
- ✅ Modal opens smoothly
- ✅ No console errors (press F12 → Console tab to check)
- ✅ All UI elements visible and styled correctly
- ✅ Click X button → Modal closes

**Test Data:**
- N/A (UI test only)

**Status:** ⏳ PENDING MANUAL TEST

---

### 📋 TEST 2: Order Search - Date Filters (3 min)

**Objective:** Verify date filtering works correctly

**Prerequisites:**
- At least 5 POS orders created in database:
  - 2 orders today
  - 2 orders last week
  - 1 order last month

**Steps:**
1. Open "Tra Cứu Đơn" modal
2. Click **"Hôm nay"** filter
   - ✅ Verify: Shows only today's orders
   - ✅ Verify: Results count correct
3. Click **"7 ngày"** filter
   - ✅ Verify: Shows orders from last 7 days
   - ✅ Verify: Count increases
4. Click **"30 ngày"** filter
   - ✅ Verify: Shows all 5 orders
5. Click **"Tùy chọn"** filter
   - ✅ Verify: 2 date pickers appear (From / To)
   - ✅ Select custom date range
   - ✅ Click "Áp dụng"
   - ✅ Verify: Results filtered by custom range

**Expected Results:**
- ✅ Each filter correctly limits results
- ✅ Date range calculation correct
- ✅ "Loading" state shows during search
- ✅ Results update smoothly

**Status:** ⏳ PENDING MANUAL TEST

---

### 📋 TEST 3: Order Search - Text Search (2 min)

**Objective:** Verify search by order number and customer name

**Prerequisites:**
- Orders exist with known order numbers and customer names

**Steps:**
1. Open "Tra Cứu Đơn" modal
2. **Test order number search:**
   - Type order number in search box (e.g., "POS-00123")
   - Press Enter or click "Tìm"
   - ✅ Verify: Finds exact order
3. **Test customer name search:**
   - Clear search box
   - Type customer name (e.g., "Nguyễn")
   - Press Enter
   - ✅ Verify: Shows all orders for customers with "Nguyễn" in name
4. **Test combined search:**
   - Keep search text
   - Change date filter
   - ✅ Verify: Results filtered by both text AND date

**Expected Results:**
- ✅ Search finds correct orders
- ✅ Partial match works for customer name
- ✅ Enter key triggers search
- ✅ Empty search shows all orders

**Status:** ⏳ PENDING MANUAL TEST

---

### 📋 TEST 4: Order Reprint (2 min)

**Objective:** Verify reprint functionality works

**Prerequisites:**
- At least 1 completed order exists

**Steps:**
1. Open "Tra Cứu Đơn" modal
2. Find an order in results table
3. Hover over order row
   - ✅ Verify: Row highlights
4. Click **Eye icon** (👁️) - View button
   - ✅ Verify: Order detail view opens
   - ✅ Verify: Shows order info (number, customer, payment, total, time)
   - ✅ Click "Đóng" → Returns to list
5. Click **Printer icon** (🖨️) - Reprint button
   - ✅ Verify: Modal closes
   - ✅ Verify: Print UI appears at bottom of POS page
   - ✅ Verify: Shows correct order for printing

**Expected Results:**
- ✅ Order detail view displays correct info
- ✅ Reprint triggers print UI
- ✅ lastOrderId state updated correctly

**Status:** ⏳ PENDING MANUAL TEST

---

### 📋 TEST 5: Close Shift Modal - UI Rendering (2 min)

**Objective:** Verify close shift modal displays correctly

**Prerequisites:**
- Open shift exists (click "Mở Ca" if needed)
- User has `pos.shift.update` permission

**Steps:**
1. Navigate to POS page
2. Verify shift is open:
   - ✅ "Mở Ca" button shows "Ca đang mở" (disabled) OR
   - ✅ "Đóng Ca" button is enabled (amber color)
3. Click **"Đóng Ca"** button
4. Verify modal appears with:
   - ✅ Title: "Đóng Ca Làm Việc" with Dollar icon
   - ✅ Close button (X)
   - ✅ **Section 1: Tóm Tắt Ca** (blue background)
     - Mã ca
     - Thu ngân
     - Giờ mở / Giờ đóng
     - Tổng đơn
     - Doanh thu
   - ✅ **Section 2: Chi Tiết Thanh Toán** (6 boxes)
     - Tiền mặt
     - Chuyển khoản
     - Thẻ
     - MoMo
     - ZaloPay
     - Khác
   - ✅ **Section 3: Đối Soát Tiền Mặt**
     - Tiền mở ca (display)
     - Tiền mặt bán hàng (display)
     - **Tiền mặt dự kiến** (blue, bold)
     - **Input: Tiền thực tế đếm được** (yellow box, required)
     - **Chênh lệch** (calculated, color-coded)
   - ✅ **Section 4: Ghi chú chênh lệch** (textarea, shown if variance > 0)
   - ✅ **Buttons:**
     - [Hủy]
     - [In Báo Cáo]
     - [Đóng Ca] (blue, primary)

**Expected Results:**
- ✅ Modal opens if shift is open
- ✅ Button disabled if no shift open
- ✅ All data loaded from RPC `pos_get_shift_summary`
- ✅ Loading state shows during data fetch
- ✅ No console errors

**Status:** ⏳ PENDING MANUAL TEST

---

### 📋 TEST 6: Close Shift - Cash Reconciliation (3 min)

**Objective:** Verify cash reconciliation calculation and validation

**Prerequisites:**
- Open shift with transactions:
  - Opening cash: 500,000 VND
  - 2 cash sales: 100,000 + 150,000 = 250,000
  - Expected cash: 750,000

**Steps:**
1. Open "Đóng Ca" modal
2. Verify calculations:
   - ✅ Opening cash: 500,000
   - ✅ Cash sales: 250,000
   - ✅ Expected cash: 750,000 (blue, bold)
3. **Test exact match:**
   - Enter actual cash: 750,000
   - ✅ Variance: 0 (green background)
   - ✅ Notes textarea NOT shown
   - Click "Đóng Ca"
   - ✅ Success message
   - ✅ Modal closes
   - ✅ Shift status = 'closed' in DB
4. **Test cash over (thừa tiền):**
   - Reopen shift (create new one)
   - Enter actual cash: 800,000
   - ✅ Variance: +50,000 (blue background, positive)
   - ✅ Notes textarea appears (required)
   - Try submit without notes
   - ✅ Error: "Vui lòng nhập ghi chú khi có chênh lệch tiền"
   - Enter notes: "Khách trả lẻ"
   - Click "Đóng Ca"
   - ✅ Success
5. **Test cash short (thiếu tiền):**
   - Reopen shift
   - Enter actual cash: 700,000
   - ✅ Variance: -50,000 (red background, negative)
   - ✅ Notes textarea appears (required)
   - Enter notes: "Thiếu tiền lẻ"
   - Click "Đóng Ca"
   - ✅ Success

**Expected Results:**
- ✅ Variance calculation correct: actual - expected
- ✅ Color coding works (green=0, blue=positive, red=negative)
- ✅ Validation enforces notes when variance exists
- ✅ Shift closes successfully with reconciliation data

**Status:** ⏳ PENDING MANUAL TEST

---

### 📋 TEST 7: Close Shift - Print Report (1 min)

**Objective:** Verify shift report printing

**Steps:**
1. Open "Đóng Ca" modal with shift data loaded
2. Click **"In Báo Cáo"** button
3. Verify:
   - ✅ Print window opens
   - ✅ Report contains:
     - Shift info (code, cashier, time)
     - Sales summary (orders, revenue)
     - Payment breakdown
     - Cash reconciliation (if entered)
     - Variance notes (if any)
   - ✅ Format: Clean HTML table layout
   - ✅ Can print or cancel

**Expected Results:**
- ✅ Print window opens via `window.open()`
- ✅ Report formatted correctly
- ✅ All data displayed accurately

**Status:** ⏳ PENDING MANUAL TEST

---

### 📋 TEST 8: Stock Refresh After Sale (2 min)

**Objective:** Verify stock updates automatically after sale

**Prerequisites:**
- Product with known stock (e.g., "Coca Cola" has stock = 10)

**Steps:**
1. Navigate to POS page
2. Find product "Coca Cola"
3. Note current stock badge: **"Còn: 10"**
4. Add 2 items to cart
5. Complete sale (click "Thanh toán")
6. **Wait 1-2 seconds** (stock refresh delay)
7. Verify:
   - ✅ Stock badge updates to **"Còn: 8"**
   - ✅ No page reload required
   - ✅ Console shows: "Fetching catalog..." (if checking)

**Expected Results:**
- ✅ Stock decreases by quantity sold
- ✅ Update happens automatically after ~1 second
- ✅ Only triggers in online mode
- ✅ Works after completing sale (lastOrderId changes)

**Status:** ⏳ PENDING MANUAL TEST

---

### 📋 TEST 9: Permission & Edge Cases (2 min)

**Objective:** Verify permission checks and error handling

**Steps:**
1. **Test without shift open:**
   - Ensure no shift open
   - ✅ "Đóng Ca" button is disabled
   - ✅ Tooltip or visual indication shows why
2. **Test without permission:**
   - Login as user without `pos.shift.update`
   - ✅ "Đóng Ca" button disabled
3. **Test network error:**
   - Open DevTools → Network → Set to "Offline"
   - Try open "Tra Cứu Đơn"
   - ✅ Error message shows
   - ✅ No crash
4. **Test empty results:**
   - Search for non-existent order "XYZ999"
   - ✅ "Không tìm thấy đơn hàng" message
   - ✅ Empty state icon displayed

**Expected Results:**
- ✅ Permission checks work
- ✅ Graceful error handling
- ✅ Clear user feedback

**Status:** ⏳ PENDING MANUAL TEST

---

## 📊 TEST RESULTS SUMMARY

| Test # | Test Name | Status | Pass/Fail | Notes |
|--------|-----------|--------|-----------|-------|
| 1 | Order Search UI | ⏳ Pending | - | - |
| 2 | Date Filters | ⏳ Pending | - | - |
| 3 | Text Search | ⏳ Pending | - | - |
| 4 | Order Reprint | ⏳ Pending | - | - |
| 5 | Close Shift UI | ⏳ Pending | - | - |
| 6 | Cash Reconciliation | ⏳ Pending | - | - |
| 7 | Print Report | ⏳ Pending | - | - |
| 8 | Stock Refresh | ⏳ Pending | - | - |
| 9 | Edge Cases | ⏳ Pending | - | - |

---

## 🐛 BUG TRACKING

### Known Issues
- None yet (pending manual test)

### Bugs Found During Testing
| Bug # | Description | Severity | Status | Fix |
|-------|-------------|----------|--------|-----|
| - | - | - | - | - |

---

## ✅ ACCEPTANCE CRITERIA

Phase 2 is **COMPLETE** when ALL tests pass:

**Close Shift:**
- [ ] Cashier can view shift summary with payment breakdown
- [ ] Cashier can enter actual cash and see variance
- [ ] Variance notes required for discrepancies
- [ ] Shift closes successfully and status updates
- [ ] Cannot create orders after shift closed
- [ ] Print report works

**Order Search:**
- [ ] Can search orders by number (exact match)
- [ ] Can search orders by customer name (partial)
- [ ] Can filter by date range (today, week, month, custom)
- [ ] Can reprint any past receipt
- [ ] Search results limited to 50, fast (<500ms)

**Stock Display:**
- [ ] Stock count visible on product cards
- [ ] Stock updates after successful sale
- [ ] Cannot add more to cart than available stock
- [ ] Offline mode shows cached stock with warning
- [ ] Backend prevents negative stock (atomic check)

---

## 🚀 NEXT STEPS AFTER TESTING

1. **If all tests pass:**
   - ✅ Mark Phase 2 as complete
   - ✅ Update todo list
   - ✅ Deploy to staging for UAT
   - ✅ Prepare for Phase 3 (Refunds & Discounts)

2. **If bugs found:**
   - 🐛 Document in Bug Tracking section
   - 🐛 Prioritize fixes (critical vs minor)
   - 🐛 Fix bugs and re-test
   - 🐛 Update code as needed

---

## 📝 TESTING NOTES

**Tester:** [Tên người test]
**Date:** [Ngày test]
**Environment:** Development (http://localhost:3000)
**Browser:** Chrome/Firefox/Safari
**Database:** [Supabase project URL]

**General Observations:**
- [Ghi chú chung về quá trình test]

**Performance Notes:**
- Modal load time: [X] ms
- Search response time: [X] ms
- Stock refresh delay: [X] seconds

---

## 🔧 TROUBLESHOOTING

### Issue: Modal không hiện
**Solution:**
- Check console for errors
- Verify button onClick handler
- Check state variable `showCloseShiftModal` or `showOrderSearchModal`

### Issue: RPC error "function does not exist"
**Solution:**
- Migration 066 chưa chạy
- Chạy: `supabase db push` hoặc apply manual via Dashboard

### Issue: Stock không refresh
**Solution:**
- Check `lastOrderId` state changes after sale
- Check useEffect dependencies
- Check console for fetch errors

---

**📞 Support:** Nếu gặp vấn đề, báo lại em với:
1. Screenshot lỗi
2. Console error log (F12 → Console)
3. Test case number đang chạy
