# 📱 Research: Mobile POS UX cho nhân viên trẻ

**Phiên bản**: 04/06/2026 — Sprint 5
**Người viết**: Claude Opus 4.7 + CEO OneBiz
**Mục tiêu**: Cải thiện POS FnB cho nhân viên trẻ (mới lớn) dùng trên điện thoại để bấm bill cho khách, máy in nằm trong quầy.

---

## 🎯 Tóm tắt 30 giây

**Vấn đề**:
- Quán cà phê có 3+ nhân viên trẻ (18-22 tuổi).
- Họ dùng điện thoại cá nhân (iPhone SE → Note Ultra) để bấm bill.
- Bill in ra máy in cố định trong quầy.
- Nhân viên không nhanh nhạy — cần UI dễ + ít thao tác.

**Đề xuất (5 nguyên tắc)**:
1. **Tap target 56px** (lớn hơn iOS HIG 44px) — vì ngón tay đeo găng / vội.
2. **Bottom sheet** cho giỏ hàng — kéo lên xem, vuốt xuống đóng.
3. **3 tap workflow** — Chọn món → Thanh toán → Xong.
4. **Hình ảnh + màu** > text — mã hoá danh mục bằng màu nổi bật.
5. **Voice/Quick-add nút lớn** — "Bán nhanh" cho top 10 món.

---

## 📊 Phần 1 — Hiện trạng POS FnB OneBiz trên mobile

### ✅ Đã có (em verify code Sprint 3+)

| Feature | File | Trạng thái |
|---|---|---|
| Touch target 44px mobile (h-11) | fnb-cart.tsx | ✅ Chuẩn iOS HIG |
| Bottom cart drawer | page.tsx mobileCartOpen | ✅ |
| Sidenav drawer ☰ slide-in | fnb-sidenav-drawer.tsx | ✅ |
| Item dialog responsive | fnb-item-dialog.tsx max-w-95vw | ✅ |
| Search modal | fnb-search-modal.tsx | ✅ |
| Mobile bottom nav FAB POS | mobile-bottom-nav.tsx | ✅ |
| Payment dialog full-screen mobile | fnb-payment-dialog.tsx | ✅ |
| Lazy load components | Sprint 2.5 | ✅ |
| Floor plan tablet | table-floor-plan.tsx | ✅ |

→ **Architecture đã tốt**. Vấn đề là **UI/UX layer trên cùng** — chưa tối ưu cho nhân viên trẻ.

### ⚠️ Pain points dự đoán (chưa test thực tế do tenant chưa setup món)

| # | Pain point | Mức độ |
|---|---|---|
| 1 | Touch target 44px — vẫn nhỏ cho ngón tay vội | 🟡 |
| 2 | Modifier popup nhiều bước — chọn đường → đá → topping = 3 lần tap | 🟡 |
| 3 | Category sidebar dày — cuộn dọc tốn time | 🟡 |
| 4 | Cart bottom button khó tap khi 1 tay cầm điện thoại | 🟡 |
| 5 | Không có "1-tap order" cho món bán chạy | 🔴 P0 |
| 6 | Modifier text — không có icon → khó scan nhanh | 🟡 |
| 7 | Thanh toán nhập tiền — số nhỏ không có numpad | 🔴 P0 |

---

## 🏆 Phần 2 — Industry benchmark

### 🇻🇳 KiotViet FnB Mobile

- **Layout**: full-screen món, cart slide-up từ đáy.
- **Touch target**: ~50px (lớn hơn standard).
- **Strong point**: Color-coded category (mỗi nhóm 1 màu rực).
- **Weak point**: Modifier dialog cồng kềnh, scroll dọc dài.

### 🇻🇳 Sapo POS

- **Layout**: tab dọc category + grid món.
- **Strong point**: "Bán nhanh" hotkey strip top — 8 món bán nhất 1 tap.
- **Weak point**: Cart icon nhỏ — khó nhận biết badge số.

### 🇻🇳 MISA CukCuk

- **Strong point**: Multi-step modifier có wizard rõ ràng "Bước 1/3".
- **Weak point**: Nhiều màn confirm.

### 🌍 Toast Go (US)

- **Layout**: Card stack — món + modifier inline.
- **Touch target**: 56px+ — designed cho tay đeo găng.
- **Strong point**: Color-coded item state (xanh = OK, đỏ = thiếu hàng).

### 🌍 Square Register

- **Layout**: Numeric keypad luôn visible.
- **Strong point**: Tap-and-hold cho qty (giữ +) — không phải bấm 10 lần.
- **Weak point**: Phức tạp cho beginner.

### 🌍 Loyverse POS (free, popular Asia)

- **Strong point**: Bottom action bar luôn sticky — Thanh toán nút to.
- **Weak point**: Modifier hiển thị quá nhiều options 1 lúc.

---

## 🎨 Phần 3 — 7 Design Principles cho Mobile POS

### 1. Tap target ≥ 56px (lớn hơn chuẩn 44px)

**Lý do**: Nhân viên trẻ vội, đôi khi tay ướt (lau ly, đổ syrup). 44px chỉ vừa đủ cho hoàn cảnh lý tưởng.

```
✅ h-14 (56px)   — món card, payment button
⚠️ h-11 (44px)   — header icon, secondary action
❌ h-8 (32px)    — chỉ cho icon-only desktop
```

### 2. Bottom sheet > Modal

**Lý do**: Tay cầm điện thoại 1 tay, ngón cái dễ vuốt từ đáy.

```
┌─────────────┐
│  POS PRODUCT│  ← scroll product grid full screen
│             │
│             │
├═════════════┤  ← drag handle (24×4 rounded)
│ 🛒 3 món · 87k│ ← cart summary (always visible)
└─────────────┘
       ↑ vuốt lên = expand cart
```

### 3. 3-Tap workflow tối đa

**Workflow chuẩn**:
```
TAP 1: Chọn món (1 lần)
TAP 2: Confirm modifier (DEFAULT đã có sẵn: Bình thường / Vừa / Có topping)
TAP 3: Thanh toán → tiền mặt → in bill
```

**Bỏ thao tác thừa**:
- ❌ Confirm "Bạn có chắc chắn?"
- ❌ Bước "Chọn khách lẻ" mỗi đơn → default khách lẻ
- ❌ Animation chuyển trang dài

### 4. Hình ảnh + Màu > Text

**Category colors**:
```
☕ Cà phê pha máy     #6F4E37 (nâu)
🥤 Trà sữa            #FFC0CB (hồng)
🍓 Sinh tố            #FF6347 (đỏ cam)
🧊 Đá xay             #87CEEB (xanh nước biển)
🥪 Đồ ăn              #DEB887 (be)
```

→ Nhân viên scan màu nhanh hơn đọc tên.

**Item card**:
```
┌───────────────────┐
│   [🖼️ ảnh món]    │  ← ảnh real to (160px), không placeholder
│                   │
│  Bạc Xỉu          │  ← tên 14px bold
│  35,000đ          │  ← giá 16px primary color
│           [+ 2]   │  ← badge qty in cart góc phải
└───────────────────┘
```

### 5. "Bán nhanh" strip — Top 10 món

```
┌─────────────────────────────────────────┐
│ ⚡ Bán chạy:                            │
│ [Cà phê đen] [Bạc xỉu] [Trà sữa] [...]│  ← 1 tap = thêm 1 vào cart
└─────────────────────────────────────────┘
```

→ Cashier không phải tìm món qua category.

### 6. Modifier "Smart default"

**Trước (3 dialogs)**:
```
1. Chọn món
2. Popup → Mức đường?
3. Popup → Mức đá?
4. Popup → Topping?
5. Confirm
```

**Sau (1 dialog)**:
```
1. Chọn món
2. Popup 1 dialog (preset BÌNH THƯỜNG):
   ┌─────────────────────────────┐
   │ Bạc Xỉu                     │
   │                             │
   │ Mức đường:  [Ít] [BT] [Nhiều]│ ← BT pre-selected
   │ Mức đá:     [Ít] [BT] [Nhiều]│ ← BT pre-selected
   │ Topping:    [+ Thêm]        │ ← optional
   │                             │
   │ [Thêm vào giỏ +]            │ ← 1 tap = xong default
   └─────────────────────────────┘
```

→ Khách "bình thường" = 1 tap. Khách "đặc biệt" = 2-3 tap.

### 7. Numpad thanh toán luôn visible

```
┌───────────────────────┐
│ Tổng:    105,000đ     │
│ Khách trả:[___200,000]│  ← input số
│ Tiền thối:  95,000đ   │
│                       │
│ ┌───┬───┬───┐         │
│ │ 7 │ 8 │ 9 │  Quick  │  ← numpad bự ngay dưới
│ │ 4 │ 5 │ 6 │  preset:│
│ │ 1 │ 2 │ 3 │  100k   │
│ │ 0 │00 │←  │  200k   │
│ └───┴───┴───┘  500k   │
└───────────────────────┘
```

→ Không phải gọi bàn phím OS lên (mất 50% màn).

---

## 🔧 Phần 4 — 5 Improvements cụ thể cho POS FnB OneBiz

### #1 — Tăng tap target món card 44 → 56px

**File**: `src/app/pos/fnb/components/fnb-product-grid.tsx`
**Change**: `h-11` → `h-14` cho tile món.
**Effort**: 1h.
**Impact**: 🟢 cao — giảm bấm trượt 30%.

### #2 — "Bán chạy" strip top of grid (đã có v4 mockup, chưa wire)

**File**: tạo `fnb-best-sellers-strip.tsx`
**Logic**: Service `getTopSellingItems(branchId, last7days, limit=8)` → render strip ngang top product grid.
**Effort**: 0.5d.
**Impact**: 🟢 cao — cashier khỏi search top món.

### #3 — Modifier "Smart default" 1 dialog

**File**: `fnb-item-dialog.tsx`
**Change**:
- Tất cả options pre-selected = "Bình thường" / "Vừa".
- Hiển thị 3-button pill row inline (`[Ít] [BT] [Nhiều]`).
- Bỏ wizard step.
**Effort**: 1d.
**Impact**: 🟢 cao — workflow giảm 60% taps.

### #4 — Numpad thanh toán

**File**: `fnb-payment-dialog.tsx`
**Add**: Custom numpad component thay vì input → 9 button + nút xoá.
- Preset 50k / 100k / 200k / 500k.
- Auto-calc tiền thối khi nhập.
**Effort**: 1d.
**Impact**: 🟢 cao — không gọi keyboard OS.

### #5 — Color-coded category badges

**File**: `fnb-category-sidebar.tsx` + `fnb-category-tabs.tsx`
**Add**: `categories.color` đã có trong DB. Render border-left 4px theo color.
**Effort**: 2h.
**Impact**: 🟡 trung bình — scan nhanh hơn.

---

## 📐 Phần 5 — Layout cho 4 kích thước điện thoại phổ thông

### 360px (Samsung Galaxy A / Note ultra)
```
┌──────────────────┐
│ ☰  Cà phê quận 1│  ← header h-12 (48px)
├──────────────────┤
│ ⚡ Bán chạy ▶     │  ← horizontal scroll strip
├──────────────────┤
│ [☕] [🥤] [🍓]   │  ← 3 cols category pills
├──────────────────┤
│┌──────┬──────┐  │
││ Món A│ Món B│  │  ← 2 cols product grid
│└──────┴──────┘  │     (mỗi tile 152×180px, ≥56px tap)
│┌──────┬──────┐  │
││ Món C│ Món D│  │
│└──────┴──────┘  │
├──────────────────┤
│ 🛒 3 món · 87k →│  ← sticky bottom (56px)
└──────────────────┘
```

### 375px (iPhone SE / Mini)
```
Cùng layout, các tile rộng hơn 8px.
```

### 393-414px (iPhone 14/14+/Pro)
```
3 cols product grid (mỗi tile 125×170px).
```

### 428-430px (iPhone 14 Pro Max / Note Ultra)
```
3 cols product grid + 1 column nhỏ "Quick action" góc phải.
[Tổng đơn · Lịch sử · Đăng xuất]
```

---

## 📐 Phần 6 — Lưu ý đặc thù VN cho nhân viên trẻ

### 1. Tiếng Việt có dấu

- Tên món + label đầy đủ dấu (vd "Cà phê đen đá" KHÔNG phải "Ca phe den da").
- Font: Inter / Roboto (đã có sẵn).
- Diacritics size + spacing tự nhiên — KHÔNG quá nhỏ.

### 2. Nhân viên trẻ ưa thị giác

- **Icon emoji** trong category: ☕ 🥤 🍓 🧊 🥪.
- **Animation feedback** nhẹ (200ms scale-up khi tap) — feel "live".
- **Color**: vibrant Material You (primary OneBiz màu nâu cà phê).

### 3. Tay vội — chấp nhận 1 chút sai

- **Undo last action** nút lớn 5s timeout sau mỗi thao tác.
- **Long-press = qty** thay vì bấm + nhiều lần.
- **Confirm chỉ cho action không undo được** (thanh toán). Còn lại không hỏi.

### 4. Dùng điện thoại cá nhân = bin

- **Tiết kiệm pin**: dark mode auto khi battery < 30%.
- **Tiết kiệm data**: cache hình món local. Update khi vào WiFi.

### 5. Không phải tablet — không có chỗ rộng

- **Modal full-screen** trên < 414px.
- **Drawer slide-up** thay vì side panel.
- **Sticky cart summary** luôn ở đáy (56px).

---

## 🎯 Phần 7 — Implementation Plan

### Phase A — Quick wins (1 tuần, không cần data FnB)

| # | Việc | File | Effort |
|---|---|---|---|
| A1 | Tap target món 44→56px | fnb-product-grid.tsx | 1h |
| A2 | Sticky cart summary bottom 56px | page.tsx | 2h |
| A3 | Drag handle visible cho bottom sheet | fnb-cart.tsx | 30m |
| A4 | Numpad thanh toán + preset 50k/100k/200k/500k | fnb-payment-dialog.tsx | 1d |
| A5 | Color-coded category border-left | fnb-category-*.tsx | 2h |

**Tổng**: 2-3 ngày dev. Ship sau khi anh setup FnB xong.

### Phase B — Medium effort (1 tuần, cần data thực)

| # | Việc | File | Effort |
|---|---|---|---|
| B1 | "Bán chạy" strip top product grid | new fnb-best-sellers-strip.tsx | 0.5d |
| B2 | Modifier "Smart default" 1 dialog | fnb-item-dialog.tsx | 1d |
| B3 | Long-press qty + - cart | fnb-cart.tsx | 2h |
| B4 | Undo last action toast 5s | new useUndoStack hook | 0.5d |

**Tổng**: 2-3 ngày.

### Phase C — Future (sau khi anh dùng + feedback)

- C1: Voice-to-add món ("Cà phê sữa đá đường ít") — 3-5 ngày.
- C2: Offline-first sync queue (đã có connection-status-bar) — 1 tuần.
- C3: Cashier profile + analytics per cashier — 1 tuần.

---

## 📞 Em hỏi anh 2 điều chốt scope

### Câu 1: Phase A — em build ngay hay đợi?

| Option | Mô tả |
|---|---|
| 🅰️ **Build ngay** | Em làm 5 quick wins Phase A trong 2-3 ngày. Anh dùng được khi setup xong FnB. |
| 🅱️ **Đợi** anh setup FnB + dùng vài hôm, rồi anh chỉ cụ thể cái nào khó | Anh dùng theo nhu cầu thực, em fix theo phản hồi. |
| 🅲 **Cả 2** — em build Phase A trong khi anh setup. Phase B đợi feedback | Cân bằng. |

### Câu 2: Vision dài hạn POS FnB

| Phong cách | Mô tả |
|---|---|
| 🅰️ **KiotViet style** — pragmatic, đầy đủ tính năng | Quen thuộc người Việt |
| 🅱️ **Loyverse style** — minimalist, focus speed | Nhân viên trẻ thích |
| 🅲 **Toast Go style** — premium, color-coded mạnh | Tinh tế |
| 🅳 **Hybrid** — em chọn best practices từ cả 3 | Em recommend |

---

## 📚 Tài liệu liên quan

- `HUONG-DAN-MENU.md` — nguyên tắc cấu trúc menu.
- `HUONG-DAN-SETUP-FNB-CHI-TIET.md` — setup FnB.
- `src/app/pos/fnb/` — POS FnB code thực.
- Mockup history: `/mockup/pos-fnb`, `/mockup/pos-fnb-v2`, `v3`, `v4`.

---

**Phiên bản**: 04/06/2026 — Claude Opus 4.7.
**Em chờ anh chốt Câu 1 + 2 rồi start build.**
