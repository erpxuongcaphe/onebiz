# HƯỚNG DẪN SETUP FnB END-TO-END

> CEO 01/06/2026 — OneBiz ERP Coffee Chain. Doc này hướng dẫn anh setup 1 quán cà phê từ trống tới bán được, có size + tuỳ chọn + báo cáo. Đọc theo thứ tự, đừng skip.

---

## 🎯 Tổng quan kiến trúc (đọc 2 phút)

```
┌─────────────────────────────────────────────────────────────────┐
│ DỮ LIỆU NỀN (1 lần setup)                                       │
├─────────────────────────────────────────────────────────────────┤
│  Chi nhánh ─→ Nhà cung cấp ─→ Đơn vị tính ─→ Nhóm hàng         │
│                                                                  │
│                          ↓                                        │
│  NVL (Đường, Cà phê, Trân châu, Ly...) ─→ Nhập kho ban đầu     │
│                          ↓                                        │
│  BOM (Công thức) ─→ Sản phẩm bán (SKU FnB)                      │
│                          ↓                                        │
│  Variants (Size M/L/XL) ─→ Tuỳ chọn (Mức đường, Topping)        │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ VẬN HÀNH (hằng ngày)                                            │
├─────────────────────────────────────────────────────────────────┤
│  POS FnB ─→ Cashier tap món → pick size + tuỳ chọn → Gửi bếp   │
│         ↓                                                         │
│  KDS bếp pha chế ─→ Thanh toán ─→ Tự trừ tồn NVL theo BOM       │
│         ↓                                                         │
│  Báo cáo (Doanh thu, Top món, Tuỳ chọn bán chạy, Tồn NVL)      │
└─────────────────────────────────────────────────────────────────┘
```

**3 khái niệm CHỦ ĐẠO** anh cần phân biệt:

| Khái niệm | Là gì | Vd |
|---|---|---|
| **NVL** (Nguyên vật liệu) | Đầu vào, nội bộ, không bán trực tiếp | Cà phê hạt, Đường, Trân châu đen, Ly nhựa |
| **SKU FnB** (Hàng bán) | Món bán trên POS, có công thức (BOM) | Bạc xỉu, Cà phê sữa đá, Trà sữa trân châu |
| **Modifier** (Tuỳ chọn) | Lựa chọn khách chọn lúc đặt | Mức đường (0/30/50/70/100%), Topping (Trân châu +7k) |

---

## 📋 PHASE 0 — Setup dữ liệu nền (làm 1 lần, ~30 phút)

### 0.1 Chi nhánh
Vào **`/cai-dat/chi-nhanh`** → Tạo mới:
- Mã (vd `Q1`, `Q2`) + Tên + Địa chỉ.
- Đánh dấu 1 chi nhánh là mặc định (default).

### 0.2 Nhà cung cấp
Vào **`/hang-hoa/nha-cung-cap`** → 2 cách:
- **UI**: Tạo từng NCC (Cà phê Trung Nguyên, Sữa Vinamilk...).
- **Excel**: Bấm "Tải mẫu" → fill bulk → "Nhập Excel".

### 0.3 Đơn vị tính
Vào **`/hang-hoa/don-vi-tinh`** → tạo các đơn vị nền:
- Khối lượng: `g`, `kg`, `tấn`.
- Thể tích: `ml`, `lít`.
- Đếm: `ly`, `cái`, `lon`, `chai`, `gói`, `bao`, `thùng`.

### 0.4 Nhóm hàng

Vào **`/hang-hoa/nhom`** → 2 cách:

**Cách A — UI từng nhóm**:
- Tab **Nguyên vật liệu**:
  - `NVL-CPH` Cà phê hạt
  - `NVL-SUA` Sữa
  - `NVL-BOT` Bột & đường
  - `NVL-TPV` Topping (Trân châu, thạch)
  - `NVL-LY` Ly cốc bao bì
- Tab **Hàng bán (SKU)** → Kênh **FnB**:
  - `CFS` Cà phê pha sẵn
  - `TRA` Trà sữa
  - `GIA` Giải khát
  - `BAN` Bánh ngọt

**Cách B — Excel bulk** (👈 recommend nếu setup chuỗi):
1. Bấm **"Tải mẫu"** → file `Nhom-hang.xlsx`.
2. Fill các nhóm cần tạo.
3. **CỘT MỚI Sprint 2** — `Nhóm tuỳ chọn FnB (CSV)`:
   - Để trống lần đầu.
   - Sau khi tạo modifier (Phase 2 dưới), điền lại để gán bulk.
   - Vd: `Mức đường, Mức đá, Topping`.
4. Bấm **"Nhập Excel"**.

---

## 📦 PHASE 1 — Setup NVL (~30 phút cho ~50 NVL)

### 1.1 Tạo NVL

Vào **`/hang-hoa`** → tab **Nguyên vật liệu** → 2 cách:

**Cách A — UI**: Bấm "Tạo mới" → fill từng NVL.

**Cách B — Excel** (👈 recommend):
1. Bấm **"Tải mẫu"** → `San-pham.xlsx`.
2. Tab "NVL" — fill các cột:
   - `code` (vd `NVL-CPH-001`)
   - `name` (Cà phê Robusta hạt)
   - `productType` = `nvl`
   - `categoryCode` (CPH)
   - `unit` (kg)
   - `costPrice` (giá nhập)
3. Bấm **"Nhập Excel"**.

### 1.2 Nhập kho ban đầu

Vào **`/hang-hoa/ton-kho-dau-ky`** (nếu có) hoặc **`/hang-hoa/nhap-hang`**:
- Tạo phiếu nhập đầu kỳ với tồn ban đầu cho mỗi NVL.
- LƯU Ý: phải có tồn NVL trước khi bán SKU có BOM.

---

## 🧪 PHASE 2 — Setup Tuỳ chọn FnB (Modifier) — **NEW SPRINT 2**

Phương án Toast inheritance — chuẩn POS quốc tế.

### 2.1 Tạo nhanh bằng PRESET (👈 99% case)

Vào **`/hang-hoa/tuy-chon-fnb`** → bấm **"Tạo preset FnB Việt"** → confirm. Hệ thống sinh sẵn:

| Nhóm | Quy tắc | Options |
|---|---|---|
| **Size** | Chọn 1 — bắt buộc | M (mặc định, +0đ) / L (+5k) / XL (+10k) |
| **Mức đường** | Chọn 1 — tuỳ chọn | 0% / 30% / 50% / 70% (mặc định) / 100% — **scale BOM** |
| **Mức đá** | Chọn 1 — tuỳ chọn | Không / Ít / Vừa (mặc định) / Nhiều |
| **Topping** | Chọn nhiều | (TRỐNG — anh tự thêm) |

### 2.2 Tinh chỉnh options

Vào từng nhóm → bấm "Sửa" hoặc "+ Thêm option":
- **Mức đường** → `scale_factor` quan trọng (0/0.3/0.5/0.7/1.0) — POS sẽ scale BOM theo đó.
- **Topping** → cho mỗi option:
  - `priceDelta` (phí cộng, vd 7000 cho Trân châu).
  - `linkedProductId` = NVL topping (gõ mã `NVL-TPV-001` để link). POS sẽ trừ tồn NVL này khi cashier chọn.

### 2.3 Gán nhóm tuỳ chọn cho NHÓM SẢN PHẨM (Toast inheritance)

**Không cần gán từng SP** — gán cho cả nhóm là xong:

Vào **`/hang-hoa/nhom`** → tab **Hàng bán (SKU)** → Sửa nhóm `Cà phê pha sẵn` → section **"Tuỳ chọn mặc định cho nhóm"** → tick `Mức đường` + `Mức đá` + `Size` → Lưu.

Mọi SP trong nhóm `Cà phê pha sẵn` sẽ TỰ THỪA KẾ. Anh **không cần** gán cho từng SP.

**Hoặc bulk qua Excel** (Phase 0.4 — cột `Nhóm tuỳ chọn FnB (CSV)`).

---

## 🍹 PHASE 3 — Setup SP bán + BOM (~1h cho menu 30 món)

### 3.1 Tạo BOM trước (công thức)

Vào **`/hang-hoa/cong-thuc`** → "Tải mẫu" → file `Cong-thuc-BOM.xlsx`.

Fill mỗi BOM = 1 hoặc nhiều row (mỗi row 1 NVL):

| Mã BOM | Tên BOM | Mã NVL | Số lượng | ĐVT | Scale theo modifier (Tên nhóm) ⭐ |
|---|---|---|---|---|---|
| BOM-CFS-001-M | Bạc xỉu M | NVL-CPH-001 | 18 | g | (trống) |
| BOM-CFS-001-M | Bạc xỉu M | NVL-SUA-001 | 50 | ml | (trống) |
| BOM-CFS-001-M | Bạc xỉu M | **NVL-BOT-001 (Đường)** | 10 | g | **Mức đường** ⭐ |
| BOM-CFS-001-M | Bạc xỉu M | NVL-LY-001 | 1 | cái | (trống) |
| BOM-CFS-001-L | Bạc xỉu L | NVL-CPH-001 | 25 | g | (trống) |
| BOM-CFS-001-L | Bạc xỉu L | NVL-SUA-001 | 70 | ml | (trống) |
| BOM-CFS-001-L | Bạc xỉu L | **NVL-BOT-001** | 15 | g | **Mức đường** ⭐ |

⭐ **CỘT MỚI Sprint 2** — `Scale theo modifier (Tên nhóm)`:
- Điền `Mức đường` cho NVL Đường → khi cashier chọn 70%, POS scale `15g × 0.7 = 10.5g`.
- Để trống cho NVL bình thường (cà phê, sữa, ly) — trừ cố định theo công thức.

Bấm **"Nhập Excel"**.

### 3.2 Tạo SKU FnB

Vào **`/hang-hoa`** → tab **Hàng bán** → bấm "Tạo mới" → tab **Hàng bán (SKU)**:

#### Tab "Thông tin"
- Tên: `Bạc xỉu`
- Nhóm: `Cà phê pha sẵn` (CFS)
- Kênh bán: **fnb**
- ĐVT: `ly`

#### Tab "Giá & Tồn kho"
- Giá bán: 35000 (giá size M mặc định)

#### Tab "Công thức (BOM)"
- Bật toggle **"Có công thức (BOM)"**.
- Cách 1: Gõ Mã BOM `BOM-CFS-001-M` (link với BOM đã tạo) → preview NVL hiện ra.
- Cách 2: Thêm NVL inline + Số lượng.
- ⭐ Cột **"Scale theo modifier"** trong từng row NVL — dropdown chọn nhóm modifier nếu muốn scale.

#### Tab "Tuỳ chọn FnB" — **NEW Sprint 2**
- Section trên (Thừa kế): hiển thị Mức đường + Mức đá + Size đã gán cho nhóm CFS (read-only).
- Section dưới: mặc định **"Thừa kế từ nhóm"**. Chỉ bật **"Override riêng"** nếu SP này khác nhóm (vd có Topping riêng).

#### Tab "Quy cách" — **NEW Sprint 2** (👈 quan trọng cho FnB)
- Bấm "Thêm quy cách":

| Tên | Giá bán | Giá vốn | Mã BOM riêng | Mặc định |
|---|---|---|---|---|
| M | 35000 | 0 | BOM-CFS-001-M | ⦿ |
| L | 41000 | 0 | BOM-CFS-001-L | ○ |
| XL | 47000 | 0 | BOM-CFS-001-XL | ○ |

⭐ **Mã BOM riêng** cho mỗi size — POS sẽ dùng BOM của size cashier chọn (M = 18g cà phê, L = 25g).

Bấm **Lưu**.

---

## 🛒 PHASE 4 — Bán thử + Verify (~5 phút)

### 4.1 Vào POS FnB

`/pos` (FnB) → tap món `Bạc xỉu`:

Dialog hiện ra:
- **Size**: M / L / XL (radio, bắt buộc chọn 1).
- **Mức đường**: 0/30/50/70/100% (mặc định 70%).
- **Mức đá**: Không/Ít/Vừa/Nhiều.
- **Topping**: tick (nếu có).
- **Ghi chú**: free text.

Chọn L + 70% đường + Ít đá + Trân châu → **Thêm vào đơn** → **Gửi bếp** → **Thanh toán**.

### 4.2 Verify đúng

| Check | Mong đợi |
|---|---|
| Tồn NVL Cà phê | Giảm **25g** (theo BOM-CFS-001-L) |
| Tồn NVL Đường | Giảm **10.5g** (15 × 0.7 = 10.5) ⭐ |
| Tồn NVL Trân châu | Giảm **1** đơn vị |
| Doanh thu | 41000 + 7000 (Trân châu) = **48000đ** |
| Bếp KDS | Hiển thị `▸ Mức đường: 70% • Mức đá: Ít • Topping: Trân châu` (tone xanh) |
| Phiếu in bếp | Cùng dòng modifier nổi bật |

Vào **`/kho`** check tồn NVL — nếu đúng = 🎉 SUCCESS.

---

## 📊 PHASE 5 — Báo cáo (xem hằng ngày/tuần)

| Báo cáo | URL | Insight |
|---|---|---|
| Tổng quan F&B | `/phan-tich/fnb` | Doanh thu, đơn, avg ticket, top món |
| **Tuỳ chọn FnB** ⭐ NEW | `/phan-tich/fnb-modifier` | 70% đường bán bao nhiêu, Topping nào chạy |
| Shipper FnB | `/phan-tich/fnb-shipper` | Số đơn / phí thu hộ / avg time per shipper |
| Tồn kho NVL | `/kho` | NVL nào sắp hết, cần đặt thêm |
| Sổ quỹ | `/so-quy` | Tiền mặt vào ra theo ca |

---

## ⚠️ Troubleshooting thường gặp

### "Mã BOM chưa tồn tại" khi import Excel SP
→ Import BOM **TRƯỚC** Excel SP. Order: Categories → NVL → BOM → SKU.

### "Nhóm modifier chưa tồn tại" khi import BOM/Categories Excel
→ Vào `/hang-hoa/tuy-chon-fnb` → bấm "Tạo preset FnB Việt" → có 4 nhóm chuẩn. Sau đó import lại.

### POS bán nhưng tồn NVL không trừ
→ Check `products.has_bom = true` + `products.bom_code` có link đúng BOM. Sửa SP → tab Công thức → verify Mã BOM.

### Cashier không thấy tuỳ chọn dynamic khi tap món
→ Verify `category_modifier_groups` đã có. Vào `/hang-hoa/nhom` → sửa nhóm SKU FnB → tick các nhóm tuỳ chọn → Lưu. Refresh POS.

### Báo cáo `/phan-tich/fnb-modifier` rỗng
→ Đây là báo cáo dựa data **sau Sprint 2** (modifier_selections lưu trong order). Đơn cũ trước Sprint 2 không có data → cần bán đơn mới sau khi setup modifier.

### Đường trừ tồn cố định (không scale theo %)
→ BOM item NVL Đường chưa gán `modifier_scale_target`. Sửa BOM → cột "Scale theo modifier" → chọn `Mức đường` → Lưu.

---

## 📚 Tài liệu liên quan

- `HUONG-DAN-NHAP-LIEU-HANG-HOA.md` — Nhập liệu chi tiết NVL/SKU.
- `HUONG-DAN-NVL-SKU-BOM.md` — Mô hình NVL + BOM + Variant + Modifier.
- `/hang-hoa/tuy-chon-fnb` — Quản lý nhóm tuỳ chọn.
- `/hang-hoa/cong-thuc` — Quản lý BOM.
- `/phan-tich/fnb-modifier` — Báo cáo lựa chọn của khách.

---

**Phiên bản**: Sprint 2 + 2.5 (CEO 01/06/2026).
**Đầy đủ chuỗi**: Variant + Modifier + Scale BOM + Topping NVL + KDS/Print + Analytics.
