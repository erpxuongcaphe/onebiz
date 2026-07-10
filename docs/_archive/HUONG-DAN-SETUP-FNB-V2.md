# ☕ Hướng dẫn Setup FnB — OneBiz ERP

> **Phiên bản 2.2** · 09/06/2026 · Khảo sát data THẬT tenant Xưởng Cà Phê hôm nay.
>
> **Đối tượng**: CEO (đọc + duyệt) → giao quản lý quán làm.
> **Thời gian**: ~2 giờ cho 30 món lần đầu. Lần sau thêm món chỉ 5 phút/món.
> **Kèm theo**: `FNB-SETUP-MASTER.xlsx` (Excel mẫu) + `CHEAT-SHEET-NV-FNB.md`.

---

## 📊 HIỆN TRẠNG TENANT ANH HÔM NAY (09/06/2026)

Em vừa khảo sát thực tế prod để viết hướng dẫn ĐÚNG, không chế:

### ✅ Đã có sẵn (skip — không cần làm gì)

| Mục | Số lượng | Chi tiết |
|---|:---:|---|
| **Chi nhánh** | 5 | 1 Kho Tổng + 1 VP + 3 cửa hàng FnB (XDX, XPR, XTB) |
| **Nhóm NVL** | 13 nhóm | NVL-CPH, NVL-SUA, NVL-BOT, NVL-TOP, NVL-SST, NVL-TRA, NVL-LTT, NVL-BBI, NVL-TCA, NVL-DCU, NVL-DCV, NVL-VPP, NVL-KHO |
| **NVL items** | 269 NVL | Cà phê hạt 7 · Sữa 2 · Bột/đường 10 · Syrup 20 · Trà 6 · Topping 5 · Ly/tách 33 · Bao bì 20 · Trái cây 16... |
| **Nhóm SKU Retail** | 13 nhóm | SKU-CPH (25 SP), SKU-TRA (8), SKU-LTT (33)... — tổng 290 SP |
| **SKU Retail** | 290 SP | Mỗi SP tự sinh 1 BOM (290 BOM 1:1) |
| **Nhóm SKU FnB** | 8 nhóm | CPT, PCF, TSU, HTR, TOL, GKH, DXA, NEP — **đang rỗng, ẩn khỏi POS** |

### ❌ Còn thiếu (anh sắp làm)

| Mục | Trạng thái | Việc cần làm |
|---|:---:|---|
| **Modifier groups** | **0 nhóm** | Bấm "Tạo bộ tuỳ chọn mẫu" → sinh 4 nhóm chuẩn |
| **Modifier gán cho 8 nhóm FnB** | Chưa gán | Mở từng nhóm → tick modifier mặc định |
| **SP món FnB** | 0 món | Tạo từng món vào 8 nhóm CPT/TSU/PCF... |
| **BOM cho SP FnB** | 0 BOM | Khai công thức pha chế (reference NVL có sẵn) |

> 🎯 **Khoá vấn đề**: 8 nhóm FnB đã có khung sẵn, 269 NVL đã sẵn — chỉ cần seed modifier + tạo SP + khai BOM. Hết.

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

### 2.1 Click nút "Tạo bộ tuỳ chọn mẫu"

Hệ thống đã có **preset 5 modifier chuẩn ngành Việt Nam**:

1. **Mức đường** — 4 mức (30/50/70/100%)
2. **Mức đá** — 4 mức (Ít/Vừa/Nhiều/Không đá)
3. **Size** — 3 size (S/M/L) + giá topup
4. **Topping** — 4 loại (Trân châu / Thạch / Pudding / Khác)
5. **Loại cà phê** — Robusta / Arabica / Blend (cho espresso shop)

**Anh làm**:
1. Vào `/hang-hoa/tuy-chon-fnb` (hoặc menu **Danh mục → Tuỳ chọn FnB**)
2. Bấm nút **"Tạo bộ tuỳ chọn mẫu"** góc phải trên
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

# 📎 PHỤ LỤC A — WALKTHROUGH TỪNG CÚ CLICK

> Phần này dành cho anh khi setup món **ĐẦU TIÊN** — em ngồi cạnh anh chỉ từng cú click.
> **Kịch bản mẫu**: Tạo món `Cà phê sữa đá` có 2 size M+L, modifier Mức đường/Mức đá, BOM scale theo Mức đường.
> **Thời gian**: ~14 phút cho 1 món lần đầu. Sau đó nhân rộng các món khác chỉ ~3 phút/món.

## ⏱️ 5 việc nhỏ — ~14 phút

| # | Việc | Thời gian | URL |
|---|---|:---:|---|
| A1 | Tạo bộ tuỳ chọn mẫu (1 lần dùng forever) | 30s | `/hang-hoa/tuy-chon-fnb` |
| A2 | Gán modifier vào nhóm SP FnB | 4p | `/hang-hoa/nhom` |
| A3 | Tạo BOM size M + size L | 6p | `/hang-hoa/cong-thuc` |
| A4 | Tạo SP "Cà phê sữa đá" + tab Quy cách | 3p | `/hang-hoa` |
| A5 | Bán thử trên POS verify | 30s | `/pos` |

---

## 🚀 A1 — Tạo bộ tuỳ chọn mẫu (~30 giây)

### Vào trang
URL: `onebiz.com.vn/hang-hoa/tuy-chon-fnb`
Hoặc: sidebar **Danh mục → Sản phẩm → Tuỳ chọn món FnB**.

### Bấm "✨ Tạo bộ tuỳ chọn mẫu" (góc trên phải)

Popup confirm → **OK** → sau ~1 giây hệ thống tạo:

| Nhóm | Loại | Options |
|---|---|---|
| **Size** | Bắt buộc | M / L / XL |
| **Mức đường** | Chọn 1 | 0% / 30% / 50% / 70% / 100% |
| **Mức đá** | Chọn 1 | Không / Ít / Vừa / Nhiều |
| **Topping** | Chọn nhiều | (rỗng — thêm khi cần) |

### Xoá nhóm cũ trùng (nếu có)

Vd nếu anh có sẵn "Mức ngọt" (0 options) → bấm 🗑 đỏ → confirm OK.

### ✅ Check
Anh phải thấy đủ **4 nhóm chuẩn**: Size · Mức đường · Mức đá · Topping.

---

## 🏷️ A2 — Gán modifier vào nhóm SP FnB (~4 phút)

### Vào trang
URL: `onebiz.com.vn/hang-hoa/nhom`
Sidebar: **Danh mục → Sản phẩm → Nhóm hàng**.

### Chuyển sang tab "Hàng bán (SKU)" + filter "FnB"

→ Hiện 8 nhóm FnB rỗng: Cà phê tươi (CPT), Trà Sữa (TSU), Giải khát (GKH), Premium Coffee (PCF), Đá xay (DXA), Hồng Trà (HTR), Trà Ô Lông (TOL), Nước ép (NEP).

### Sửa từng nhóm — tick modifier mặc định

Bấm icon ✏️ trên dòng nhóm → popup mở ra. Tick các ô tương ứng:

| Nhóm | Size | Mức đường | Mức đá | Topping |
|---|:---:|:---:|:---:|:---:|
| **Cà phê tươi** (CPT) | ✅ | ✅ | ✅ | ❌ |
| **Trà Sữa** (TSU) | ✅ | ✅ | ✅ | ✅ |
| **Giải khát** (GKH) | ✅ | ✅ | ✅ | ❌ |
| **Premium Coffee** (PCF) | ✅ | ✅ | ✅ | ❌ |
| **Đá xay** (DXA) | ✅ | ✅ | ✅ | ❌ |
| **Hồng Trà** (HTR) | ✅ | ✅ | ✅ | ✅ |
| **Trà Ô Lông** (TOL) | ✅ | ✅ | ✅ | ✅ |
| **Nước ép** (NEP) | ✅ | ✅ | ✅ | ❌ |

→ Bấm **Cập nhật** sau mỗi nhóm.

### ✅ Check
Mỗi SP anh tạo trong các nhóm này từ giờ **TỰ THỪA KẾ** modifier — không phải gán lại từng SP.

---

## 🧪 A3 — Tạo BOM Size M + L (~6 phút)

### Vào trang
URL: `onebiz.com.vn/hang-hoa/cong-thuc`
Sidebar: **Danh mục → Sản xuất → Công thức (BOM)**.

### Tra Mã NVL CHÍNH XÁC từ tenant anh (mở tab khác)

> 📌 **Quan trọng**: BOM FnB tham chiếu **NVL có sẵn** (anh đã có 269 NVL trong 13 nhóm). KHÔNG cần tạo SKU Retail riêng cho mỗi NVL.

Mở tab khác `/hang-hoa` → tab **"Nguyên vật liệu"** → search/filter theo nhóm:

| Loại NVL | Nhóm | Mã pattern | Ví dụ thực tế |
|---|---|---|---|
| Cà phê đã rang xay | NVL-CPH (7 SP) | `NVL-CPH-001..007` | Anh chọn loại phù hợp (Xưởng đặc biệt, Gu Việt...) |
| Sữa đặc | NVL-SUA (2 SP) | `NVL-SUA-001`, `NVL-SUA-002` | |
| Đường trắng/nâu | NVL-BOT (10 SP) | `NVL-BOT-001..010` | |
| Đá viên | NVL-KHO (12 SP) | search "đá" trong NVL-KHO | |
| Ly nhựa size M | NVL-LTT (33 SP) | `NVL-LTT-001..033` | `NVL-LTT-014` "Nắp cầu - phi 93 - ly size M" |
| Ống hút | NVL-LTT | trong nhóm trên | |

→ **Anh phải tra mã CHÍNH XÁC** trên trang `/hang-hoa` → tab Nguyên vật liệu → ghi ra giấy 4 mã trước khi sang bước tiếp.

> ⚠️ Mã NVL của tenant anh do hệ thống auto-gen theo thứ tự nhập — em không tự đoán được mã chính xác cho "Cà phê hạt" mà anh muốn dùng cho công thức Cà phê sữa đá. Anh tra trên web.

### Tạo BOM Size M

Bấm **+ Tạo công thức** (góc phải trên, nút xanh).

| Trường | Giá trị |
|---|---|
| Mã BOM | `BOM-CPT-001-M` |
| Tên BOM | `Cà phê sữa đá M` |
| Chi nhánh áp dụng | *(để trống — áp dụng mọi chi nhánh)* |
| Năng suất | `1` |
| ĐVT năng suất | `ly` |

Bấm **+ Thêm NVL** 4 lần (mã NVL anh tra ở bước trên):

| # | Mã NVL | Số lượng | ĐVT | **Scale theo modifier** ⭐ |
|---|---|---|---|---|
| 1 | NVL-CPH-... (Cà phê hạt rang xay anh chọn) | `15` | g | *(trống)* |
| 2 | NVL-SUA-001 hoặc 002 (Sữa đặc) | `25` | ml | *(trống)* |
| 3 | **NVL-BOT-... (Đường)** | **`10`** | **g** | **chọn "Mức đường"** ⭐ |
| 4 | NVL-LTT-... (Ly nhựa size M) | `1` | cái | *(trống)* |

> ⭐ **KEY**: Dòng Đường → cột "Scale theo modifier" → chọn "Mức đường".
> Khi khách chọn 30% đường → POS auto trừ 10g × 0.3 = 3g. Khi 100% → trừ đủ 10g.

Bấm **Lưu**.

### Tạo BOM Size L (lặp lại)

Mã: `BOM-CPT-001-L`. Tăng liều:

| # | Mã NVL | Số lượng | ĐVT | Scale |
|---|---|---|---|---|
| 1 | NVL-CPH-... (cùng cà phê size M) | `20` | g | (trống) |
| 2 | NVL-SUA-... (cùng sữa size M) | `40` | ml | (trống) |
| 3 | **NVL-BOT-...** | **`15`** | **g** | **Mức đường** |
| 4 | NVL-LTT-... (Ly nhựa size L) | `1` | cái | (trống) |

### ✅ Check
Vào `/hang-hoa/cong-thuc` → thấy 2 BOM `BOM-CPT-001-M` và `BOM-CPT-001-L`. Cả 2 có dòng Đường gắn cờ "Scale theo Mức đường".

---

## ☕ A4 — Tạo SP "Cà phê sữa đá" (~3 phút)

### Vào `/hang-hoa` → bấm "+ Tạo mới"

Popup mở → mặc định tab **Nguyên vật liệu (NVL)** → switch sang **Hàng bán (SKU)**.

### Tab 1 — "Thông tin"

| Trường | Giá trị | Lưu ý |
|---|---|---|
| Tên hàng | `Cà phê sữa đá` | |
| **Nhóm hàng** ⭐ | **Cà phê tươi** (CPT) | Quan trọng — để thừa kế modifier |
| Kênh bán | **fnb** (auto chọn) | |
| Đơn vị tính | `ly` | |

→ Mã SP gợi ý: `SKU-CPT-001` (auto-gen, không sửa).

### Tab 2 — "Giá & Tồn kho"

| Trường | Giá trị |
|---|---|
| Giá bán | `25000` (giá size M mặc định) |
| Giá vốn | **để trống** (POS tự tính từ BOM) |
| Tồn ban đầu | `0` (có BOM → không lưu tồn, chỉ trừ NVL) |
| VAT | `0` |

### Tab 3 — "Tuỳ chọn FnB"

Anh thấy:
```
🌳 Thừa kế từ nhóm hàng
   ✓ Size       (3)
   ✓ Mức đường  (5)
   ✓ Mức đá     (4)

[● Thừa kế từ nhóm]  [○ Override riêng]
```

✅ **Không cần làm gì** — chế độ "Thừa kế" đã đúng.

### Tab 4 — "Quy cách" ⭐ (QUAN TRỌNG NHẤT)

Bấm **+ Thêm quy cách** → fill 2 row:

| # | Tên | Giá bán | Giá vốn | **Mã BOM riêng** ⭐ | Mặc định |
|---|:---:|---|---|---|:---:|
| 1 | M | `25000` | *(trống)* | `BOM-CPT-001-M` | ⦿ |
| 2 | L | `30000` | *(trống)* | `BOM-CPT-001-L` | ○ |

Bấm **Lưu** (góc dưới phải popup).

### ✅ Check
Search "Cà phê sữa đá" trong `/hang-hoa` → thấy SP có:
- Mã: SKU-CPT-001
- Kênh bán: FnB
- Có BOM: ✓

---

## 🛒 A5 — Bán thử POS verify (~30 giây)

### Mở POS FnB → tab "Cà phê tươi" → tap "Cà phê sữa đá"

Dialog hiện ra:
```
Cà phê sữa đá
Kích cỡ: [● M 25,000đ]  [○ L 30,000đ]
Mức đường: 0% / 30% / 50% / ● 70% / 100%
Mức đá: Không / Ít / ● Vừa / Nhiều
```

### Test scenario
1. Chọn Size **L** → giá tự update 30,000đ
2. Mức đường **100%**
3. Mức đá **Ít đá**
4. Bấm **Thêm vào đơn** → cart phải
5. **Gửi bếp** → KDS hiện "▸ Mức đường: 100% · Mức đá: Ít đá"
6. **Thanh toán** → tiền mặt → 30,000đ

### Verify tồn NVL
Mở `/hang-hoa` tab "Nguyên vật liệu" → search NVL Đường (NVL-BOT-...):
- Trước bán: vd `1000g`
- Sau bán: `985g` (= 1000 − 15g BOM L × 1.0 scale 100%)

Bán thêm 1 ly với **30% đường** → trừ tiếp `15g × 0.3 = 4.5g` → còn `980.5g`. ✓

### ✅ DONE
Anh đã setup 1 món FnB hoàn chỉnh có size + modifier + BOM scale. Nhân rộng các món khác cùng pattern.

---

## 🔁 Nhân rộng cho nhiều món

| Món | Nhóm | BOM M/L | Giá M | Giá L |
|---|---|---|---|---|
| Cà phê sữa đá | CPT | BOM-CPT-001-M/L | 25k | 30k |
| Cà phê đen đá | CPT | BOM-CPT-002-M/L | 22k | 27k |
| Bạc xỉu | CPT | BOM-CPT-003-M/L | 28k | 33k |
| Trà sữa truyền thống | TSU | BOM-TSU-001-M/L | 35k | 40k |
| Trà sữa trân châu | TSU | BOM-TSU-002-M/L (có Topping) | 42k | 47k |

> 💡 **Menu 30+ món**: dùng **Excel bulk import** ở `/hang-hoa/cong-thuc` → "Tải mẫu" → fill nhiều BOM → "Nhập Excel". Tương tự `/hang-hoa` cho SKU.

---

# 📎 PHỤ LỤC B — MÔ HÌNH "TRUNG TÂM PHÂN PHỐI"

> **Áp dụng cho tenant anh** (5 chi nhánh thực: 1 Kho Tổng + 3 cửa hàng FnB + 1 VP).
> Bỏ qua phần này nếu setup tenant mới chỉ 1 quán.

## 🏢 5 chi nhánh thực tế tenant anh (verify hôm nay)

| Mã | Tên | Loại | cascade_mode |
|---|---|---|---|
| **BOF-002** | Xưởng Cà Phê - Kho Tổng (mặc định) | Kho tổng | **production** |
| **BOF-001** | Xưởng Cà Phê - Văn phòng | Văn phòng | outlet |
| **CNH-XDX** | Xưởng Cà Phê - Xưởng Đồng Xoài | Cửa hàng FnB | outlet |
| **CNH-XPR** | Xưởng Cà Phê - Xưởng Premium | Cửa hàng FnB | outlet |
| **CNH-XTB** | Xưởng Cà Phê - Xưởng Tư Búa | Cửa hàng FnB | outlet |

> 📌 **cascade_mode**: em suy theo logic default (warehouse=production, store=outlet). Anh **verify lại** bằng cách vào `/he-thong/chi-nhanh` → click ✏️ từng chi nhánh → tab Tồn kho → cột "Chế độ trừ tồn".

## 🧭 Mô hình chuỗi cà phê đa chi nhánh

```
KHO TỔNG (Retail)                     QUÁN FNB (Outlet)
─────────────────                     ─────────────────
NVL gốc (hạt sống, sữa NVL)           SKU đóng gói (nhập từ Kho tổng)
       ↓                                     ↓
SKU đóng gói (Cà phê rang 1kg,        SKU món pha chế (Bạc xỉu, Cà phê sữa)
              Sữa lon, gói bột...)            ↓ BOM tham chiếu SKU đóng gói
       ↓                              POS FnB bán món → trừ SKU đóng gói
POS Retail (bán khách ngoài)
   Cascade BOM → trừ NVL

Internal Sale Kho tổng → Quán:
   • Chuyển 5 lon SKU-SUA-001
   • Leg-OUT Kho tổng: cascade BOM → trừ 5 lon NVL-SUA-001 ✅
   • Leg-IN Quán A:    +5 lon SKU-SUA-001 tồn Quán
```

## ⚙️ Setup Chế độ tồn kho cho mỗi chi nhánh (CỰC QUAN TRỌNG)

Vào `/cai-dat/chi-nhanh` → chỉnh **Chế độ tồn kho**:

| Loại chi nhánh | Chế độ | Hành vi khi bán SKU |
|---|---|---|
| 🏭 Kho tổng / Xưởng rang | **Kho/Xưởng sản xuất** | Cascade BOM → trừ NVL gốc |
| 🏪 Quán cà phê / Cửa hàng | **Quán/Outlet** | Trừ tồn SKU trực tiếp |

> ⚠️ Migration 00123 tự set mặc định: `warehouse/factory` = production, `store/office` = outlet. Anh chỉ verify hoặc override nếu sai.

## 📦 3 loại SKU Retail — setup khác nhau

### Loại 1 — Production SKU *(chế biến thực sự)*
**Vd**: Cà phê hạt sống → rang xay đóng gói.
- 2 mã: `NVL-CPH-001` "Hạt sống" + `SKU-CPH-001` "Rang xay 1kg".
- SKU `has_bom=false`, có tồn riêng.
- Mỗi đợt rang: Xuất NVL + Nhập SKU.

### Loại 2 — Repackaging SKU *(đóng gói lại từ NVL)*
**Vd**: Sữa đặc Ông Thọ — 1 thùng = 24 lon.
- 1 NVL + nhiều SKU: `NVL-SUA-001` + `SKU-SUA-001` (1 lon) + `SKU-SUA-002` (thùng 24).
- SKU `has_bom=true`, BOM: 1 SKU = X lon NVL.
- POS Retail Kho tổng: cascade BOM → trừ NVL ✅
- POS Retail Quán (takeaway): trừ tồn SKU trực tiếp ✅
- Internal Sale Kho → Quán: leg-OUT cascade BOM, leg-IN tăng tồn SKU ✅

### Loại 3 — Trade-only SKU *(mua nguyên bán nguyên)*
**Vd**: Nước Lavie, snack, mì gói.
- 1 mã: `SKU-XXX-001` `has_bom=false`, có tồn riêng.
- POS Retail bán → trừ tồn SKU.

## 📊 G3 — Khả dụng theo BOM trên POS Retail

POS Retail tại Kho tổng (cascade_mode=production) hiện:

```
┌─ Card SKU "Sữa đặc 1 lon" ──────┐
│  💰 35,000đ                     │
│  ≈ 240  ← tính từ NVL "Sữa đặc"  │
└─────────────────────────────────┘
```

→ Cashier thấy bán được bao nhiêu mặc dù `branch_stock(SKU) = 0`.
Hover: *"Khả dụng tính từ NVL 'Sữa đặc Ông Thọ'"*.

## 🎯 Checklist sau khi apply migration 00123

- [ ] `/cai-dat/chi-nhanh` — cột "Chế độ tồn kho" đúng:
  - Kho tổng = 🏭 Sản xuất
  - Quán FnB = 🏪 Outlet
- [ ] POS Retail Kho tổng: SKU `has_bom=true` hiện badge "≈ X" khả dụng
- [ ] Internal Sale Kho → Quán: NVL Kho tổng giảm đúng theo BOM × số lượng
- [ ] POS FnB Quán bán món: trừ SKU đóng gói thành phần
- [ ] POS FnB Quán bán takeaway (1 lon sữa): trừ tồn SKU trực tiếp

## ❓ Triệu chứng sai

| Triệu chứng | Nguyên nhân | Fix |
|---|---|---|
| Bán SKU tại Kho tổng mà NVL không giảm | Branch `cascade_mode='outlet'` sai | `/cai-dat/chi-nhanh` → chỉnh sang **production** |
| Bán món Bạc xỉu tại Quán mà tồn SKU sữa không giảm | BOM Bạc xỉu chỉ ở `branch_id=NULL` | Tạo BOM riêng cho `branch_id` Quán |
| Quán bán takeaway báo "NVL hết hàng" | Branch `cascade_mode='production'` sai | `/cai-dat/chi-nhanh` → chỉnh sang **outlet** |

---

> ✍️ **Ghi chú phiên bản 2.1 (09/06/2026)**:
> - **Merge** từ file cũ `HUONG-DAN-TAO-SKU-FNB-CU-THE.md` vào Phụ lục A (walkthrough từng cú click).
> - **Merge** Pattern Trung tâm phân phối vào Phụ lục B (cho chuỗi ≥2 chi nhánh).
>
> ✍️ **Ghi chú phiên bản 2 (06/06/2026)**:
> - Bỏ Bước "Tạo NVL FnB" vì hệ thống dùng SKU Retail có sẵn làm NVL (Sprint 3 cascade_mode).
> - Rút từ 5 bước → 4 bước. Thời gian ~2.5h → ~2h.
> - Format lại theo CEO: rõ ràng, có ảnh minh hoạ, dễ đọc.
