# 🗺️ Research: Floor Plan Editor cho POS FnB OneBiz

**Phiên bản**: 04/06/2026 — Sprint 5
**Người viết**: Claude Opus 4.7 + CEO OneBiz
**Mục tiêu**: Build sơ đồ bàn tùy chỉnh được, đẹp giống thật ở quán cà phê.

---

## 🎯 Tóm tắt 30 giây

**Vấn đề**: Hiện POS FnB chỉ hiển thị bàn dạng GRID đơn giản (3-5 cột). CEO muốn:
- **Tùy chỉnh được**: kéo thả bàn vị trí thật trong quán.
- **Đẹp giống thật**: bàn tròn / vuông / dài / sofa, có sảnh / sân vườn / quầy.
- **Nhận diện nhanh**: nhân viên 1 nhìn biết bàn nào ở đâu.

**Đề xuất**: build Floor Plan Editor 3 phase:
- 🟢 **Phase A** (1 tuần): Drag-drop canvas + 8 shape preset + multi-zone.
- 🟡 **Phase B** (3-5 ngày): Background image quán + decoration objects (cửa, cây, bar counter).
- 🟢 **Phase C** (sau): Multi-floor + animation + print PDF.

---

## 📊 Phần 1 — Hiện trạng OneBiz

### ✅ Đã có

| Thành phần | Trạng thái | Note |
|---|---|---|
| `restaurant_tables` table | ✅ migration 00016 | Có cột `position_x`, `position_y` (chưa dùng) |
| `zone` text column | ✅ | Free text, chưa entity riêng |
| Status colors (4 trạng thái) | ✅ | green/blue/amber/gray |
| Group by zone | ✅ | table-floor-plan.tsx line 89 |
| Timer occupied | ✅ | formatElapsed |
| Capacity per table | ✅ | int default 4 |
| `branches.settings` JSONB | ✅ migration 00052 | pos_zone_order, pos_layout_mode, pos_canvas_width, pos_canvas_height |

### ❌ Chưa có

| Thiếu | Mức độ cần |
|---|---|
| Drag-drop canvas absolute (position_x/y chưa dùng) | 🔴 P0 |
| Custom shapes (chỉ button vuông) | 🔴 P0 |
| Resize / Rotate | 🟡 P1 |
| Background image quán | 🟡 P1 |
| Decoration objects (cửa, cây, bar) | 🟡 P1 |
| Multi-floor / Multi-zone tabs | 🟡 P1 |
| Editor mode toggle (Sửa / Xem) | 🔴 P0 |
| Grid snap | 🟡 P1 |
| Color zone overlay | 🟢 P2 |

---

## 🏆 Phần 2 — Industry benchmark

### 🌍 Toast POS Floor Plan (US, premium $$$)

**Strong points**:
- Drag-drop canvas absolute (1080×800 default).
- 8+ shape preset: round-2/4/6, square-2/4, rect-4/6, booth, sofa-corner.
- Resize 4 góc handle + rotate icon.
- **Background image upload** — chụp ảnh quán dán làm guide.
- **Decoration objects**: door, plant, bar counter, restroom, stairs, window — drag từ palette.
- **Multi-floor**: Tầng 1 / Tầng 2 / Sân thượng — tab switch.
- Grid snap 16px / 32px / off.
- Zones color-coded.
- Real-time sync (WebSocket).

**Weak points**: Phức tạp, học mất 30 phút. Tốn $$$.

### 🌍 Square for Restaurants

**Strong points**:
- Simpler — pre-built shapes only, không custom.
- Drag-drop OK.

**Weak points**: Không có background image, không có decoration.

### 🌍 Lightspeed Restaurant

**Strong points**:
- Full editor + background image.
- Capacity rules per shape (vd table 4 ghế tự max 4 khách).

**Weak points**: UI nặng nề.

### 🌍 TouchBistro (premium)

**Strong points**: Vector shapes, animation status (đỏ-xanh đổi mượt), best practices industry.

### 🇻🇳 KiotViet FnB

**Strong points**: Đơn giản, dễ học.

**Weak points**: Chỉ grid auto, không drag-drop, không custom — y hệt OneBiz hiện tại.

### 🇻🇳 Sapo FnB

Tương tự KiotViet.

### 🇻🇳 MISA CukCuk

**Strong points**: Có drag-drop nhưng giới hạn 4 shape.

**Weak points**: Không có background image.

### 🌐 Open Source — react-konva / react-rnd / fabric.js

- **react-konva**: Canvas 2D mạnh, dùng để build editor.
- **react-rnd**: Resize + drag + rotate HTML element.
- **fabric.js**: Full SVG editor — nặng nhưng đầy đủ.

→ Em recommend **react-konva** cho OneBiz (lighter, perf tốt, well-maintained).

---

## 🎨 Phần 3 — 7 Design Principles cho Floor Plan Editor

### 1. Edit mode tách rời Display mode

```
View mode (mặc định cashier):
┌────────────────────┐
│  [🟢 Bàn 1]        │
│       [🟢 Bàn 2]   │  ← chỉ tap để chọn bàn
│  [🔵 Bàn 3]        │
└────────────────────┘

Edit mode (admin/manager):
┌────────────────────┐
│ ┌──Bàn 1──┐  [+]  │
│ │  ⌗⌗⌗   │ palette│  ← drag-drop, resize, rotate
│ │ [resize]│  shape │
│ └─────────┘  trash │
└────────────────────┘
```

→ Cashier không thấy edit handle (tránh xóa nhầm).

### 2. Pre-built shapes — không cần vẽ từ đầu

```
🟢 round-2     bàn tròn 2 ghế
🟢 round-4     bàn tròn 4 ghế
🟢 round-6     bàn tròn 6 ghế
⬜ square-2    vuông 2 ghế
⬜ square-4    vuông 4 ghế
▭ rect-4      chữ nhật 4 ghế
▭ rect-6      chữ nhật 6 ghế
🛋️ sofa-corner sofa góc
```

→ Drag từ palette vào canvas. Capacity auto-set theo shape.

### 3. Grid snap — đặt thẳng hàng dễ hơn

```
Bật grid 16px → bàn auto snap khi gần line.
Bật grid 32px → snap thưa hơn cho quán lớn.
Off → free position (cho hình bất quy tắc).
```

### 4. Background image quán

```
1. CEO chụp ảnh quán từ trên xuống (hoặc vẽ sketch).
2. Upload làm background canvas.
3. Đặt bàn lên đúng vị trí thật.
4. Cashier mới vào dễ định vị "bàn 5 ở góc gần cửa".
```

→ Tăng trải nghiệm "đẹp giống thật".

### 5. Decoration objects — pre-built

```
🚪 door          cửa ra vào
🌿 plant         cây cảnh
🍸 bar-counter   quầy bar
🚻 restroom      toilet
🪟 window        cửa sổ
📺 tv            tivi
🪜 stairs        cầu thang
```

→ Drag từ palette để định vị "bàn 1 cạnh cây cảnh".

### 6. Multi-zone tab switcher

```
┌────────────────────────────────┐
│ [Sảnh 1] [Sân vườn] [Tầng 2]+ │ ← tabs
├────────────────────────────────┤
│   (canvas của zone đang chọn) │
└────────────────────────────────┘
```

→ Nhiều khu vực không lẫn lộn.

### 7. Real-time status sync

Khi bàn 1 chuyển từ "trống" → "đang dùng" (cashier ghi đơn):
- Mọi máy POS / KDS / Admin đang xem floor plan tự update màu.
- Supabase Realtime subscription đã có sẵn.

---

## 🔧 Phần 4 — 5 Improvements cụ thể

### #1 — Edit mode + Drag-drop canvas

**Files**:
- Migration: `restaurant_tables` add `shape`, `width`, `height`, `rotation`.
- `src/app/(main)/cai-dat/ban-khu-vuc/page.tsx` — thêm nút "Sửa sơ đồ".
- `src/components/shared/floor-plan-editor.tsx` (mới) — Konva canvas.
- `src/app/pos/fnb/components/table-floor-plan.tsx` — đọc shape + position render absolute.

**Effort**: 3-4 ngày.

### #2 — 8 pre-built shapes + palette

**Files**:
- `src/components/shared/floor-plan-shapes.tsx` (mới) — shape definitions SVG.
- Palette drag từ aside vào canvas.

**Effort**: 1d.

### #3 — Multi-zone tabs (zone entity riêng)

**Files**:
- Migration mới: `floor_plan_zones` table (id, branch_id, name, sort_order, settings).
- Hoặc dùng `branches.settings.pos_zones[]` JSONB (đã có pos_zone_order).
- UI tab switcher trong editor.

**Effort**: 1d.

### #4 — Background image upload

**Files**:
- Storage bucket Supabase `floor-plans` (đã có images bucket).
- `floor_plan_zones.background_url` text.
- UI: nút "Tải ảnh nền" trong editor.

**Effort**: 0.5d.

### #5 — Decoration objects

**Files**:
- `floor_plan_decorations` table hoặc `branches.settings.pos_decorations[]` JSONB.
- 7 preset shapes SVG.
- Drag-drop từ palette giống bàn.

**Effort**: 1d.

---

## 📐 Phần 5 — Schema mới

### Migration đề xuất

```sql
-- 1. Extend restaurant_tables (P0)
ALTER TABLE restaurant_tables
  ADD COLUMN shape text NOT NULL DEFAULT 'round'
    CHECK (shape IN ('round','square','rect','sofa','booth','bar-seat')),
  ADD COLUMN width int NOT NULL DEFAULT 80,
  ADD COLUMN height int NOT NULL DEFAULT 80,
  ADD COLUMN rotation int NOT NULL DEFAULT 0
    CHECK (rotation BETWEEN 0 AND 359),
  ADD COLUMN color text;  -- override màu mặc định (optional)

-- 2. New floor_plan_zones table (P1)
CREATE TABLE floor_plan_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL,           -- "Sảnh 1", "Sân vườn", "Tầng 2"
  sort_order int NOT NULL DEFAULT 0,
  canvas_width int NOT NULL DEFAULT 1024,
  canvas_height int NOT NULL DEFAULT 720,
  background_url text,           -- ảnh quán làm guide
  background_opacity int DEFAULT 30,  -- 0-100
  grid_size int DEFAULT 16,      -- snap pixel
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Update restaurant_tables.zone → zone_id FK
ALTER TABLE restaurant_tables
  ADD COLUMN zone_id uuid REFERENCES floor_plan_zones(id) ON DELETE SET NULL;

-- 3. New floor_plan_decorations table (P1)
CREATE TABLE floor_plan_decorations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES floor_plan_zones(id) ON DELETE CASCADE,
  kind text NOT NULL,            -- 'door','plant','bar','restroom','window','tv','stairs'
  position_x int NOT NULL DEFAULT 0,
  position_y int NOT NULL DEFAULT 0,
  width int NOT NULL DEFAULT 60,
  height int NOT NULL DEFAULT 60,
  rotation int NOT NULL DEFAULT 0,
  label text                     -- "Cửa chính", "Cây sồi", optional
);
```

---

## 📊 Phần 6 — Mockup UI

### Editor mode (admin)

```
┌────────────────────────────────────────────────────────────┐
│ ☰  Sơ đồ bàn — Quán Cà Phê Q1   [Save] [Cancel]           │
├──────────┬─────────────────────────────────────────────────┤
│ PALETTE  │ [Sảnh 1] [Sân vườn] [Tầng 2] [+ Khu vực]       │
│          ├─────────────────────────────────────────────────┤
│ BÀN      │                                                  │
│ ⚪ round-2 │       ⌗ ⌗ ⌗ ⌗ (grid 16px)                       │
│ ⚪ round-4 │    ┌────────┐                                   │
│ ⚪ round-6 │    │ Bàn 1  │ ← drag từ palette vào            │
│ ⬜ square2 │    │  ⚪ 4   │   resize handle 4 góc            │
│ ⬜ square4 │    └────────┘   rotate icon                    │
│ ▭ rect-4  │                                                  │
│ 🛋️ sofa    │       ┌──────────┐                              │
│          │       │  Bàn 5    │                              │
│ ĐỒ TRANG │       │  ⚪ 6      │                              │
│ TRÍ      │       └──────────┘                              │
│ 🚪 door   │                                                  │
│ 🌿 plant  │ ┌─ bar counter ──────────────────────┐         │
│ 🍸 bar    │ └────────────────────────────────────┘         │
│ 🚻 wc     │                                                  │
│          │ 🌿  🌿                                            │
│ Grid:    │                                                  │
│ [16px▼]  │                                                  │
│          │ [📷 Ảnh nền]  [Opacity 30%]                     │
└──────────┴─────────────────────────────────────────────────┘
```

### View mode (cashier)

```
┌────────────────────────────────────────────────────────────┐
│ 🟢 Trống (5)  🔵 Đang phục vụ (3)  🟠 Đặt trước (1)        │
├────────────────────────────────────────────────────────────┤
│ [Sảnh 1] [Sân vườn] [Tầng 2]                              │
├────────────────────────────────────────────────────────────┤
│  ⌗ background image quán mờ ⌗                            │
│   ┌───────┐         ┌───────┐                             │
│   │🟢 Bàn1│         │🔵 Bàn2│  ← tap để mở đơn             │
│   │  4 ghế│         │ 15'   │                             │
│   └───────┘         └───────┘                             │
│                                                            │
│   ┌─────────────────┐                                     │
│   │🟢 Bàn 5 (sofa) │                                      │
│   │  6 ghế          │                                      │
│   └─────────────────┘                                     │
│                                                            │
│   🌿                          🚪 Cửa chính                 │
│   ┌─ Quầy bar ─────────────────────┐                      │
│   └───────────────────────────────┘                      │
└────────────────────────────────────────────────────────────┘
```

---

## 🎯 Phần 7 — Implementation Plan

### Phase A — Foundation 🟢 (1 tuần, em recommend làm trước)

| # | Việc | Effort |
|---|---|---|
| A1 | Migration 00125: extend restaurant_tables (shape/width/height/rotation) + floor_plan_zones table | 0.5d |
| A2 | Service `floor-plan.ts`: CRUD zones + tables | 0.5d |
| A3 | `floor-plan-editor.tsx` (Konva canvas + drag-drop) | 2d |
| A4 | 8 pre-built shapes (round-2/4/6, square-2/4, rect-4/6, sofa) | 0.5d |
| A5 | Multi-zone tab switcher | 0.5d |
| A6 | Toggle "Sửa sơ đồ" / "Xem" với permission gate | 0.5d |
| A7 | Update `table-floor-plan.tsx` đọc shape + position absolute | 1d |
| A8 | Test + responsive (tablet ưu tiên — editor không cho điện thoại) | 1d |

**Tổng**: 6.5 ngày dev.

### Phase B — Customize 🟡 (3-5 ngày, làm khi anh muốn đẹp hơn)

| # | Việc | Effort |
|---|---|---|
| B1 | Background image upload + opacity slider | 1d |
| B2 | floor_plan_decorations table + 7 preset SVG | 1d |
| B3 | Decoration palette + drag-drop | 1d |
| B4 | Grid snap toggle (16px / 32px / off) | 0.5d |
| B5 | Rotate handle UI | 0.5d |

**Tổng**: 4 ngày dev.

### Phase C — Polish 🟢 (sau khi anh dùng + feedback)

| # | Việc | Effort |
|---|---|---|
| C1 | Multi-floor (Tầng 1/2/3) | 1d |
| C2 | Color zone overlay | 0.5d |
| C3 | Animation status change (đỏ↔xanh mượt) | 0.5d |
| C4 | Print floor plan PDF | 0.5d |
| C5 | Mobile responsive (xem only, không edit) | 1d |

**Tổng**: 3.5 ngày dev.

---

## 🛠️ Phần 8 — Tech stack

| Layer | Library | Lý do |
|---|---|---|
| Canvas | **react-konva** | Best perf cho canvas 2D, well-maintained |
| Drag-drop | react-konva built-in | Đỡ phụ thuộc lib khác |
| Resize | react-konva Transformer | 4-góc handle + lock aspect ratio |
| State | Existing Zustand / React state | Không thêm lib |
| Storage | Supabase Storage bucket `floor-plans` | Background image |
| Realtime | Supabase Realtime (đã có) | Status sync |

**Bundle size**: react-konva ~80KB gzip. OK với mục tiêu performance.

---

## 📞 Em hỏi anh 2 điều chốt scope

### Câu 1 — Phase nào làm trước?

| Option | Em làm |
|---|---|
| 🅰️ **Chỉ Phase A** (1 tuần) — drag-drop + shapes + multi-zone | Đủ cho 80% nhu cầu. Anh dùng thực, feedback rồi quyết B. |
| 🅱️ **Phase A + B** (~2 tuần) — đầy đủ background + decoration | "Đẹp giống thật" như anh nói. |
| 🅲 **Phase A + B + C** (~3 tuần) — premium | Full toast/touchbistro style. |

🎯 **Em recommend 🅰️** — ship nhanh để anh thấy + sửa theo cảm nhận thật. Anh đồng ý làm B sau khi dùng được vài hôm.

### Câu 2 — Editor cho ai dùng?

| Option | Permission |
|---|---|
| 🅰️ **Chỉ admin/owner** | An toàn — không ai sửa nhầm. |
| 🅱️ **Manager/quản lý quán** | Mỗi quán quản lý sơ đồ riêng. |
| 🅲 **Cả 2** — admin global, manager per branch | Linh hoạt nhất (em recommend). |

---

## 📚 Tài liệu liên quan

- `src/app/pos/fnb/components/table-floor-plan.tsx` — view hiện tại.
- `src/lib/types/fnb.ts` — RestaurantTable type.
- `supabase/migrations/00016_fnb_tables.sql` — schema.
- `supabase/migrations/00052_branches_settings.sql` — pos_zone_order trong settings.
- `RESEARCH-MOBILE-POS-UX.md` — research POS mobile (Sprint 5).

---

**Phiên bản**: 04/06/2026 — Claude Opus 4.7.
**Em chờ anh chốt Câu 1 + 2 rồi start build.**
