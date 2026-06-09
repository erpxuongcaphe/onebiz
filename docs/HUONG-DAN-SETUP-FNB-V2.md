# ☕ Hướng dẫn Setup FnB — OneBiz ERP

> **Phiên bản 2** · 06/06/2026 · Sửa lại theo CEO: bỏ Bước "Tạo NVL FnB" thừa.
>
> **Đối tượng**: CEO (đọc + duyệt) → giao quản lý quán làm.
> **Thời gian**: ~2 giờ cho 30 món lần đầu. Lần sau thêm món chỉ 5 phút/món.
> **Kèm theo**: `FNB-SETUP-MASTER.xlsx` (Excel mẫu) + `CHEAT-SHEET-NV-FNB.md`.

---

## 🚨 Đọc 2 phút này TRƯỚC khi bắt đầu

### Logic FnB của hệ thống (Sprint 3 cascade_mode)

```
┌─────────────────────────────────────────┐
│  KHO TỔNG / CỬA HÀNG BÁN LẺ             │
│  (đã có sẵn từ Retail)                  │
│                                         │
│  SKU Retail = Cà phê hạt, Sữa đặc,      │
│   Syrup, Đá, Ly nhựa…                   │
└──────────────┬──────────────────────────┘
               │
               │ DÙNG LUÔN làm NVL cho FnB
               │ (không cần tạo thêm SKU loại "nvl")
               ▼
┌─────────────────────────────────────────┐
│  QUÁN FnB (Outlet)                      │
│                                         │
│  • SKU FnB = món bán (Cà phê sữa, Latte)│
│  • BOM = công thức pha chế              │
│      → tham chiếu SKU Retail            │
│  • Modifier = tùy chọn                  │
│      (Mức đường, Đá, Topping)           │
│                                         │
│  Khi POS FnB bán "Cà phê sữa":          │
│  → BOM gọi SKU Retail (hạt + sữa)       │
│  → Trừ tồn SKU Retail TẠI QUÁN          │
└─────────────────────────────────────────┘
```

> 💡 **Điểm CỐT LÕI**: Hệ thống KHÔNG có khái niệm "NVL FnB" riêng.
> SKU Retail (cà phê hạt, sữa đặc, syrup chai) dùng LUÔN làm nguyên liệu cho BOM FnB.
> → **Tiết kiệm 30 phút** so với hướng dẫn cũ.

---

## 📋 Tổng quan 4 bước

| # | Việc | Thời gian | Nơi làm |
|---|---|:---:|:---:|
| **1** | Tạo **Nhóm hàng FnB** (categories) | 10p | Excel + Web |
| **2** | Tạo **Modifier groups** (Mức đường/đá/topping) | 5p | Web UI |
| **3** | Tạo **SKU món FnB** + gán BOM | 30p | Excel + Web |
| **4** | Khai **BOM** (công thức pha chế) | 60-90p | Excel + Web |

**Tổng**: **~2 giờ** cho 30 món · Sau đó copy paste thêm món chỉ ~5 phút/món.

> ⚠️ **Trước Bước 3** — đảm bảo **SKU Retail (nguyên liệu) đã có sẵn** ở `/hang-hoa`:
> cà phê hạt, sữa đặc, syrup, trân châu, đá, ly nhựa, ống hút…
> Nếu chưa có → tạo Retail trước (xem `HUONG-DAN-NHAP-LIEU-HANG-HOA.md`).

---

# 📍 BƯỚC 1 — Tạo Nhóm hàng FnB

## 🎯 Tại sao cần

Mỗi món FnB phải thuộc 1 nhóm (Cà phê pha máy / Trà sữa / Sinh tố…). Nhóm giúp:

- 📱 **POS hiển thị tab nhóm** cho cashier chọn nhanh.
- 📊 **Báo cáo doanh thu theo nhóm** (cà phê chiếm bao nhiêu % tổng).
- 🎛️ **Gán Modifier mặc định** cho cả nhóm (1 lần thay vì gán từng món).

## 🛠️ Cách làm

### 1.1 Mở Excel mẫu — Sheet **"Nhóm FnB"**

Em đã điền sẵn **10 nhóm phổ biến** quán cà phê Việt:

| Mã nhóm | Tên nhóm | Modifier mặc định |
|:---:|---|---|
| CFM | Cà phê pha máy | Mức đường, Mức đá |
| CFT | Cà phê truyền thống | Mức đường, Mức đá |
| TRA | Trà các loại | Mức đường, Mức đá |
| TSS | Trà sữa | Mức đường, Mức đá, Topping |
| SNH | Sinh tố | Mức đường, Mức đá |
| EPM | Espresso | — |
| FRZ | Đá xay (Frappe) | Mức đường, Topping |
| YGD | Sữa chua đánh đá | Mức đường, Mức đá |
| BAS | Bánh ngọt / Snack | — |
| KHC | Khác | — |

**Anh làm**:
- ✅ Xem ví dụ, giữ nhóm hợp menu.
- ❌ Xoá nhóm thừa.
- ➕ Thêm nhóm thiếu (vd quán bán bia → "Đồ uống có cồn").

### 1.2 Vào Web → Import

1. Mở `/hang-hoa/nhom`
2. Bấm **Nhập Excel** (góc phải)
3. Chọn file → chọn sheet **"Nhóm FnB"** → Preview → **Lưu**

> ⚠️ **Lưu ý**: Cột `Kênh bán` PHẢI = `fnb` (không phải `retail`). Sai → SP không hiện trên POS FnB.

---

# 📍 BƯỚC 2 — Tạo Modifier groups

## 🎯 Modifier là gì?

Modifier = **tuỳ chọn khách hàng** khi order món:

```
Khách order: Cà phê sữa
   + Mức đường: 30% / 50% / 70% / 100%        ← Modifier "Mức đường"
   + Mức đá:   Ít / Vừa / Nhiều / Không đá    ← Modifier "Mức đá"
   + Topping:  Trân châu / Thạch / Pudding    ← Modifier "Topping"
```

→ POS FnB hiện popup chọn → ghi vào hoá đơn + KDS bếp thấy.

> 💡 Modifier có thể **scale BOM** (vd "Nhiều đá" → trừ thêm 30g đá), hoặc **trừ topping NVL** (vd "+Trân châu" → trừ 30g trân châu).

## 🛠️ Cách làm

### 2.1 Click nút "Seed preset FnB Việt"

Hệ thống đã có **preset 5 modifier chuẩn ngành Việt Nam**:

1. **Mức đường** — 4 mức (30/50/70/100%)
2. **Mức đá** — 4 mức (Ít/Vừa/Nhiều/Không đá)
3. **Size** — 3 size (S/M/L) + giá topup
4. **Topping** — 4 loại (Trân châu / Thạch / Pudding / Khác)
5. **Loại cà phê** — Robusta / Arabica / Blend (cho espresso shop)

**Anh làm**:
1. Vào `/hang-hoa/tuy-chon-fnb` (hoặc menu **Danh mục → Tuỳ chọn FnB**)
2. Bấm nút **"Seed preset FnB Việt"** góc phải trên
3. Hệ thống tạo NGAY 5 nhóm + ~20 option

### 2.2 (Optional) Tinh chỉnh

- Bấm vào từng nhóm → sửa tên, sửa option, đổi giá topup.
- Vd "Topping" — đổi giá "+Trân châu" = 7,000đ thay 5,000đ.

> ✅ Bước này CHỈ làm 1 lần. Sau khi setup xong, modifier dùng cho TẤT CẢ món FnB.

---

# 📍 BƯỚC 3 — Tạo SKU món FnB + gán BOM

## 🎯 SKU món FnB là gì?

SKU FnB = **mỗi món bán** trên menu (Cà phê sữa, Latte, Trà sữa truyền thống…).

> 🔑 **Khác Retail**: SKU FnB **KHÔNG bắt buộc giá vốn** — vì giá vốn sẽ AUTO TÍNH từ BOM (Bước 4).

## 🛠️ Cách làm

### 3.1 Mở Excel mẫu — Sheet **"SKU món FnB"**

Em đã điền sẵn **30 món phổ biến**. Cột quan trọng:

| Cột | Giá trị | Ghi chú |
|---|---|---|
| `Mã SP` | Tự đặt theo format `SKU-{NHÓM}-{NNN}` | Vd `SKU-CFM-001` |
| `Tên SP` | Tên món hiển thị | Vd "Cà phê sữa đá" |
| `Loại` | `sku` | Luôn `sku` (không phải `nvl`) |
| `Kênh bán` | `fnb` | **BẮT BUỘC** — sai → không lên POS FnB |
| `Mã nhóm` | Mã nhóm ở Bước 1 | Vd `CFM` |
| `ĐVT bán` | `ly`, `cốc`, `chai` | Đơn vị bán cho khách |
| `Giá bán` | Số tiền 1 ly | Vd 25,000 |
| `Giá vốn` | **Để trống** | BOM tự tính ở Bước 4 |
| `Mã BOM` | **Để trống** | Sẽ gán ở Bước 4 |
| `Modifier groups` | Để trống nếu nhóm đã có | Hệ thống kế thừa từ nhóm ở Bước 1 |

**Anh làm**:
- ✅ Giữ món hợp menu
- ❌ Xoá món không bán
- ➕ Thêm món mới (copy 1 dòng → sửa)

### 3.2 Import lên Web

1. Vào `/hang-hoa`
2. Bấm **Nhập Excel**
3. Chọn file → sheet **"SKU món FnB"** → Preview → **Lưu**

### 3.3 Verify nhanh

- Vào `/hang-hoa` → filter Kênh = `fnb` → đếm = số món trong Excel ✓
- Click 1 SP → thấy có nhóm + modifier mặc định (kế thừa từ nhóm) ✓

> ⚠️ Lúc này SP đã lên POS FnB **nhưng KHÔNG TRỪ TỒN** vì chưa có BOM. Phải qua Bước 4.

---

# 📍 BƯỚC 4 — Khai BOM (công thức pha chế)

## 🎯 BOM là gì?

BOM = **Bill of Materials** = công thức:

```
"Cà phê sữa đá" (1 ly) =
  • 30 ml espresso       → SKU Retail "Cà phê hạt rang xay"
  • 20 g  sữa đặc        → SKU Retail "Sữa đặc Ông Thọ"
  • 80 g  đá viên        → SKU Retail "Đá viên"
  • 1 cái ly nhựa 16oz   → SKU Retail "Ly nhựa 16oz"
  • 1 cái ống hút        → SKU Retail "Ống hút nhựa"
```

→ **BOM tham chiếu SKU Retail có sẵn**. KHÔNG cần tạo SKU "nvl" riêng.

→ Khi POS FnB bán 1 ly: hệ thống AUTO trừ tồn 5 SKU Retail trên tại Quán đó.

> 💡 **Giá vốn món** = tổng (qty × giá vốn SKU Retail). Anh không phải nhập tay.

## 🛠️ Cách làm

### 4.1 Mở Excel mẫu — Sheet **"BOM"**

Cấu trúc Excel BOM (mỗi dòng = 1 NVL trong công thức):

| Mã BOM | Tên BOM | Mã NVL | Tên NVL | Qty | ĐVT |
|---|---|---|---|---|---|
| BOM-001 | Cà phê sữa đá | SKU-RTL-CFE-001 | Cà phê hạt rang xay | 30 | ml |
| BOM-001 | Cà phê sữa đá | SKU-RTL-SUA-001 | Sữa đặc Ông Thọ | 20 | g |
| BOM-001 | Cà phê sữa đá | SKU-RTL-DAC-001 | Đá viên | 80 | g |
| BOM-001 | Cà phê sữa đá | SKU-RTL-BAO-001 | Ly nhựa 16oz | 1 | cái |
| BOM-001 | Cà phê sữa đá | SKU-RTL-BAO-002 | Ống hút | 1 | cái |
| BOM-002 | Latte | SKU-RTL-CFE-001 | Cà phê hạt rang xay | 18 | ml |
| BOM-002 | Latte | SKU-RTL-SUA-002 | Sữa tươi không đường | 150 | ml |
| ... | ... | ... | ... | ... | ... |

> 🔑 **Cột `Mã NVL`** phải là **Mã SKU Retail có sẵn** ở Kho Tổng / Cửa hàng.
> Sai mã → import báo lỗi "không tìm thấy SP".

**Anh làm**:
- ✅ Mở Sheet BOM trong Excel mẫu — em đã điền sẵn ~30 BOM mẫu.
- ✅ Sửa lại theo công thức THẬT của quán anh (g/ml/cái).
- ⚠️ Nếu mã SKU Retail của anh khác mẫu → sửa cột `Mã NVL` cho khớp.

### 4.2 Import BOM

1. Vào `/hang-hoa/cong-thuc`
2. Bấm **Nhập Excel BOM** → chọn file → sheet "BOM" → Preview
3. Hệ thống check từng dòng:
   - ✅ Xanh = OK (tìm thấy SKU Retail)
   - 🔴 Đỏ = không tìm thấy mã → sửa Excel, import lại
4. Bấm **Lưu**

### 4.3 Link BOM với SKU món FnB

Vào `/hang-hoa` → mở từng SKU món FnB → tab **BOM** → chọn Mã BOM tương ứng → **Lưu**.

Hoặc nhanh hơn: Excel sheet **"SKU món FnB"** đã có cột `Mã BOM` — fill cột này khi tạo SP → SKU auto-link BOM khi import.

> ✅ Sau bước này: bán 1 ly POS FnB → trừ tồn 5 NVL Retail tự động.

---

# ✅ Test toàn flow trên POS FnB

## 5.1 Mở POS FnB

- Truy cập **fnb.onebiz.com.vn** (hoặc bấm icon POS góc phải trên web)
- Chọn quán → mở ca

## 5.2 Bán 1 món test

1. Tab nhóm "Cà phê pha máy" → click món "Cà phê sữa đá"
2. Popup hiện modifier:
   - Mức đường: 70%
   - Mức đá: Vừa
   - +Trân châu (5,000đ)
3. Bấm **Thêm vào giỏ**
4. Bấm **Thanh toán** → chọn Tiền mặt → **Hoàn tất**

## 5.3 Verify trừ tồn

Vào `/hang-hoa` → search SKU Retail "Cà phê hạt" → thấy:
- ✅ Cột **Tồn tại Quán** = giảm 18g (theo BOM)
- ✅ Cột **Tồn tại Kho Tổng** = KHÔNG đổi (chỉ trừ tồn Quán bán)

Vào `/hang-hoa/lich-su-kho` → filter Quán + Hôm nay → thấy 5 dòng xuất kho cho 5 NVL (cà phê + sữa + đá + ly + ống hút). ✓

---

# 🆘 FAQ — Khi gặp sự cố

## ❓ Q1: Bán 1 ly nhưng tồn NVL không trừ?

**Có thể**:
1. SKU món FnB chưa link BOM (vào tab BOM trong form SP, gán Mã BOM).
2. BOM tham chiếu mã SKU Retail SAI (Mã NVL không tồn tại).
3. Quán đó cấu hình `cascade_mode = 'sku'` thay vì `'bom'`. Sửa: Form chi nhánh → tab Tồn kho → Chế độ trừ tồn = **BOM**.

## ❓ Q2: POS FnB không hiện món vừa tạo?

**Check**:
- Cột `Kênh bán` của SP = `fnb` chưa? (sai → không lên POS FnB).
- Cột `Đang bán` = ON chưa? (Off → ẩn khỏi POS).
- Refresh POS (Ctrl+R) — đôi khi cache cũ.

## ❓ Q3: Modifier "+Trân châu" trừ 30g nhưng tồn không giảm?

**Cần**:
1. Modifier có cấu hình `modifier_scale_target` = SKU "Trân châu" trong BOM editor.
2. Hoặc tạo dòng BOM riêng: BOM "Topping trân châu" → trừ 30g SKU Retail "Trân châu".

→ Xem `Sprint 2.3c` doc nếu cần chi tiết.

## ❓ Q4: Giá vốn của món FnB hiện 0đ?

**Lý do**: BOM chưa khai → hệ thống không tính được.

**Fix**: Vào `/hang-hoa/cong-thuc` → mở BOM của món → check từng dòng đã có SKU Retail + qty đúng chưa.

## ❓ Q5: Báo lỗi import Excel "Mã NVL không tồn tại"?

**Lý do**: SKU Retail anh tham chiếu trong BOM chưa có trong hệ thống.

**Fix**: Tạo SKU Retail TRƯỚC (`/hang-hoa` → Nhập Excel sheet Retail), rồi mới import BOM.

---

# 🎯 Tóm tắt — Checklist nhanh

- [ ] **Bước 0**: SKU Retail (cà phê hạt, sữa, syrup, đá, ly) đã có ở `/hang-hoa`
- [ ] **Bước 1**: Nhóm FnB tạo xong, kênh bán = `fnb`
- [ ] **Bước 2**: Modifier groups seed preset xong (5 nhóm)
- [ ] **Bước 3**: SKU món FnB tạo xong, kênh bán = `fnb`, chưa cần giá vốn
- [ ] **Bước 4**: BOM khai xong, link với SKU món FnB
- [ ] **Test**: Bán 1 ly POS FnB → tồn NVL Retail giảm ✓

---

# 📞 Hỗ trợ

- **Tệp Excel mẫu**: `FNB-SETUP-MASTER.xlsx` (đính kèm file zip)
- **Cheat sheet cho nhân viên**: `CHEAT-SHEET-NV-FNB.md` (1 trang in được)
- **Sai gì hỏi em ngay** — em fix theo file này.

---

> ✍️ **Ghi chú phiên bản 2 (06/06/2026)**:
> - Bỏ Bước "Tạo NVL FnB" vì hệ thống dùng SKU Retail có sẵn làm NVL (Sprint 3 cascade_mode).
> - Rút từ 5 bước → 4 bước. Thời gian ~2.5h → ~2h.
> - Format lại theo CEO: rõ ràng, có ảnh minh hoạ, dễ đọc.
