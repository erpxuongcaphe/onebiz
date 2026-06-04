# 📘 Hướng dẫn Setup FnB chi tiết — OneBiz ERP

**Phiên bản**: 03/06/2026 — Sprint 4
**Đối tượng**: CEO + Quản lý chuỗi (anh review trước khi giao nhân viên).
**File kèm theo**: `FNB-SETUP-MASTER.xlsx` (Excel mẫu) + `CHEAT-SHEET-NV-FNB.md` (1 trang cho NV).
**Thời gian setup 1 menu 30 món**: **~2-3 giờ** (lần đầu) → sau đó copy paste nhân thêm món chỉ vài phút.

---

## 🎯 Sơ đồ luồng FnB (đọc 2 phút này quyết định 80% thành công)

```
        ┌─────────────────────────────┐
        │     KHO TỔNG (Retail)       │
        │  • NVL gốc (hạt sống, sữa)  │
        │  • SKU đóng gói (gói cà phê)│
        └──────────┬──────────────────┘
                   │ Internal Sale: chuyển NVL/SKU vào Quán
                   ▼
        ┌─────────────────────────────┐
        │   QUÁN FnB (Outlet)         │
        │                             │
        │  Tồn NVL FnB ←─ nhập từ Kho │
        │      │                      │
        │      ▼                      │
        │  BOM món FnB ← khai công thức│
        │      │                      │
        │      ▼                      │
        │  POS FnB bán món ─→ trừ NVL │
        │  Cashier chọn modifier      │
        │  (Mức đường 70%, +Trân châu)│
        └─────────────────────────────┘
```

→ Mỗi món FnB = **1 SKU** + **1 BOM** (công thức) + **N modifier** (tuỳ chọn).

---

## 🧭 Tổng quan 5 bước

| Bước | Việc | Thời gian | Nơi làm |
|---|---|---|---|
| 1 | Tạo **Nhóm hàng FnB** (categories) | 10 phút | Excel + Web |
| 2 | Tạo **Modifier groups** (Mức đường/đá/topping) | 5 phút (preset) | Web UI only |
| 3 | Tạo **NVL FnB** (sữa, syrup, đá…) | 30 phút | Excel + Web |
| 4 | Tạo **SKU món FnB** + gán BOM | 30 phút | Excel + Web |
| 5 | Khai **BOM** (công thức pha chế) | 60-90 phút | Excel + Web |

**Tổng**: ~2.5 giờ cho 30 món.

---

## 📍 BƯỚC 1 — Tạo Nhóm hàng FnB

### Mục đích

Mỗi món FnB phải thuộc 1 nhóm (Cà phê pha máy / Trà sữa / Sinh tố…). Nhóm giúp:
- POS hiển thị tab theo nhóm cho cashier chọn nhanh.
- Báo cáo doanh thu theo nhóm.
- **Gán modifier mặc định** cho toàn bộ SP trong nhóm (1 lần thay vì gán từng SP).

### Cách làm

**1.1 Mở Excel `FNB-SETUP-MASTER.xlsx` → Sheet 2 "Nhóm FnB"**

Em đã điền sẵn **10 nhóm phổ biến**. Anh:
- Xem ví dụ.
- Giữ nhóm nào hợp với menu của anh.
- Xoá nhóm thừa.
- Thêm nhóm thiếu (vd quán bán bia → thêm "Đồ uống có cồn").

**Cột quan trọng**:
- `Loại`: luôn là `sku` (nhóm hàng bán, không phải NVL).
- `Tên nhóm`: hiển thị cho cashier (vd "Cà phê pha máy").
- `Mã nhóm`: 3-5 chữ in hoa (vd "CFM"). Web sẽ tự nhúng vào mã SP sau (vd `SKU-CFM-001`).
- `Kênh bán`: luôn là `fnb` (nhóm món pha chế tại quán).
- `Nhóm tuỳ chọn FnB`: tên các modifier mặc định, phân cách bằng dấu phẩy (vd `Mức đường, Mức đá`). **Để trống nếu chưa có modifier — quay lại điền sau khi xong Bước 2**.

**1.2 Lưu file → Vào web**

1. Mở web → menu `Danh mục > Sản phẩm > Nhóm hàng` (URL: `/hang-hoa/nhom`).
2. Bấm nút **"Nhập từ Excel"** (góc phải trên).
3. Chọn file `FNB-SETUP-MASTER.xlsx`.
4. Web hỏi chọn sheet → chọn **"2. Nhóm FnB"**.
5. Preview hiện ra → check không có lỗi đỏ → bấm **"Lưu"**.

✅ Xong Bước 1 — anh đã có 10 nhóm trong hệ thống.

---

## 📍 BƯỚC 2 — Tạo Modifier groups (PHẢI làm qua UI)

### Mục đích

**Modifier** = tuỳ chọn khách chọn khi gọi món:
- Mức đường (Không / Ít / 70% / Bình thường / Nhiều).
- Mức đá (Không / Ít / Bình thường / Nhiều).
- Topping (Trân châu / Thạch / Pudding) — có thể có giá thêm.
- Size (S / M / L).

### ⚠️ Tại sao KHÔNG có Excel?

Modifier có cấu trúc phức tạp (option lồng group + scaleFactor + linkedProductId)
→ Excel khó biểu diễn. Em build UI form gọn — chỉ 1 lần làm.

### Cách làm

**2.1 Vào `/hang-hoa/tuy-chon-fnb`**

**2.2 Cách nhanh nhất — Bấm "Preset FnB Việt"**

Web có sẵn nút này — bấm 1 lần tạo 4 nhóm chuẩn:
- ✅ Mức đường (5 options với scaleFactor 0 → 1.3).
- ✅ Mức đá (4 options).
- ✅ Topping (5 topping mẫu, anh thêm/sửa giá).
- ✅ Size (3 size).

→ Em **strongly recommend** bấm preset thay vì tự tạo.

**2.3 Sau khi có 4 nhóm — quay về Excel Bước 1**

- Sheet 2 "Nhóm FnB" → cột "Nhóm tuỳ chọn FnB (CSV)" → điền tên modifier (vd `Mức đường, Mức đá, Topping`).
- Re-import sheet 2 (web upsert sẽ update modifier groups cho nhóm).

→ Mọi SP trong nhóm sẽ TỰ THỪA KẾ các modifier — không cần gán từng SP.

✅ Xong Bước 2.

---

## 📍 BƯỚC 3 — Tạo NVL FnB

### Mục đích

**NVL** = nguyên vật liệu pha chế (sữa lon, đường, syrup, trân châu, đá, ly nhựa…).
NVL sẽ bị trừ tồn mỗi khi cashier bán món (qua BOM cascade).

### ⚠️ Lưu ý quan trọng — NVL FnB lấy đâu?

**2 case**:

**Case A — Anh mua trực tiếp về Quán** *(đơn giản nhất, khuyến nghị)*:
- NVL nằm hẳn tại Quán → tạo NVL trực tiếp ở Quán đó.
- VD: trân châu, syrup, ly nhựa, ống hút — mua từ Lazada/Shopee, NCC chỉ giao cho Quán.

**Case B — Mua qua Kho Tổng, chuyển xuống Quán** *(quy mô lớn)*:
- NVL tồn ở Kho Tổng → Internal Sale chuyển xuống Quán → tồn NVL ở Quán.
- VD: cà phê rang xay từ Xưởng Rang chuyển xuống quán.

→ Excel mẫu em làm theo **Case A** cho gọn. Sau này anh muốn Case B → tạo NVL ở Kho rồi chuyển xuống.

### Cách làm

**3.1 Mở Sheet 4 "NVL FnB" trong Excel mẫu**

Em đã điền **15 NVL phổ biến**:
- Cà phê rang xay (Robusta + Arabica).
- Sữa đặc Ông Thọ, sữa tươi có/không đường.
- Đường (cát trắng + nâu).
- Syrup (Caramel + Vanilla).
- Topping (Trân châu đen/trắng, thạch dừa, pudding).
- Đá.
- Ly + nắp + ống hút (bộ).

**Cột quan trọng**:
- `Mã SP`: tự đặt theo format `NVL-{NHÓM}-{NNN}` (vd `NVL-CPH-001`).
- `Tên SP`: tên hiển thị.
- `Loại`: luôn `nvl`.
- `Kênh bán`: **để trống** (NVL không bán ra ngoài).
- `Mã nhóm`: mã nhóm NVL (vd `CFE` cho cà phê).
- `ĐVT`: đơn vị NHỎ NHẤT khi dùng pha chế (g, ml, bộ). **Quan trọng vì BOM tham chiếu**.
- `Đóng gói`: đơn vị mua từ NCC (lon, lít, kg, chai).
- `Hệ số quy đổi`: vd 1 lon = 380 ml → đóng gói "lon", quy đổi 380.
- `Giá vốn`: giá NVL (anh chỉnh theo NCC thực).
- `Tồn ban đầu`: tồn lúc setup (để 0 nếu chưa có hàng).

**3.2 Tạo nhóm NVL trước (nếu chưa có)**

- Vào `/hang-hoa/nhom`.
- Tạo các nhóm NVL theo `Mã nhóm` trong Excel: `CFE` (Cà phê), `SUA` (Sữa), `DUO` (Đường), `SYR` (Syrup), `TPV` (Topping), `DAC` (Đá), `BAO` (Bao bì).
- Loại: `nvl`, Kênh bán: để trống.

**3.3 Import NVL**

1. Mở `/hang-hoa`.
2. Bấm **"Nhập từ Excel"**.
3. Chọn file → chọn sheet **"4. NVL FnB"**.
4. Preview → check → Lưu.

✅ Xong Bước 3.

---

## 📍 BƯỚC 4 — Tạo SKU món FnB

### Mục đích

Mỗi món bán = 1 SKU có `productType=sku`, `channel=fnb`, `has_bom=true` (vì có công thức).

### Cách làm

**4.1 Mở Sheet 5 "SKU món" trong Excel mẫu**

Em đã điền **10 món mẫu**:
1. Cà phê đen đá
2. Cà phê sữa đá
3. Bạc xỉu nóng
4. Cà phê sữa nóng
5. Trà sữa trân châu
6. Trà sữa thạch dừa
7. Trà đào cam sả
8. Đá xay socola
9. Sinh tố bơ
10. Caramel Macchiato

**Anh thay theo menu thật của anh** — chỉ giữ format, không cần giữ tên.

**Cột quan trọng**:
- `Mã SP`: format `SKU-FNB-NNN` (vd `SKU-FNB-001`).
- `Tên SP`: tên hiển thị trên POS (vd "Cà phê sữa đá").
- `Loại`: luôn `sku`.
- `Kênh bán`: luôn `fnb`.
- `Mã nhóm`: gắn vào nhóm nào (vd `CFM` = Cà phê pha máy).
- `ĐVT`: thường là `ly`.
- `Mã BOM`: mã công thức tham chiếu — em đặt theo format `BOM-{KÝ HIỆU MÓN}-001` (vd `BOM-CSD-001` = Cà phê Sữa Đá). **Mã này phải khớp với Sheet 6 BOM**.
- `Giá bán`: giá khách trả (đã bao gồm VAT nếu có).
- `Giá vốn`: anh nhập manual (em không auto-tính).
- `VAT %`: thường 0 hoặc 10.

**4.2 Import SKU món**

Cùng cách như Bước 3 — vào `/hang-hoa` → "Nhập từ Excel" → chọn sheet **"5. SKU món"**.

⚠️ **Lưu ý**: lúc này SKU đã tạo nhưng **chưa có BOM gắn vào** (vì BOM chưa import). Anh sẽ làm Bước 5 tiếp theo.

✅ Xong Bước 4.

---

## 📍 BƯỚC 5 — Khai BOM (công thức pha chế)

### Mục đích

BOM = công thức món. Khi cashier bán 1 ly → POS đọc BOM → trừ NVL theo công thức.

### Cấu trúc BOM trong Excel

**Mỗi NVL trong công thức = 1 dòng**. Master info (Mã BOM, Tên BOM) lặp lại ở mỗi dòng.

VD công thức "Cà phê đen đá":
```
BOM-CDD-001 | Cà phê đen đá | NVL-CPH-001 | 18 g  | Cà phê
BOM-CDD-001 | Cà phê đen đá | NVL-DUO-001 | 10 g  | Đường
BOM-CDD-001 | Cà phê đen đá | NVL-DAC-001 | 100 g | Đá
BOM-CDD-001 | Cà phê đen đá | NVL-COC-001 | 1 bộ  | Ly+nắp+ống
```

→ 4 dòng cho 1 công thức "Cà phê đen đá".

### Cột "Scale theo modifier" (KEY feature)

Khi cashier chọn modifier "70% đường" → POS sẽ **scale tự** lượng đường trong BOM.

- Cột `Scale theo modifier (Tên nhóm)` = tên nhóm modifier tham chiếu (vd `Mức đường`).
- POS đọc scaleFactor option (vd 0.7) → trừ 7g đường thay vì 10g.

→ Khai cho item Đường, Đá thường gắn modifier. Cà phê + sữa thường không scale.

### Cách làm

**5.1 Mở Sheet 6 "BOM" trong Excel mẫu**

Em đã điền **30+ dòng BOM cho 10 món mẫu**. Mỗi món 3-5 NVL.

Anh:
- Xem cấu trúc → hiểu cách điền.
- Thay theo menu thật + công thức của anh.

**5.2 Import BOM**

1. Mở `/hang-hoa/cong-thuc`.
2. Bấm **"Nhập từ Excel"**.
3. Chọn file → chọn sheet **"6. BOM"**.
4. Preview → check không có lỗi → Lưu.

**5.3 Link BOM vào SKU (NẾU SKU chưa có bom_code)**

Nếu Bước 4 anh đã điền cột `Mã BOM` thì system tự link rồi → skip bước này.
Nếu chưa → vào `/hang-hoa` → mở từng SP → tab BOM → chọn `Mã BOM` → Lưu.

✅ Xong Bước 5 — toàn bộ menu đã có công thức.

---

## ✅ Bước 6 — Test 1 ly thật

### Cách test (không hư data)

1. Trên POS FnB → chọn 1 món anh vừa tạo (vd "Bạc xỉu nóng").
2. Chọn modifier (vd Mức đường 70%, Mức đá: Bình thường).
3. Thanh toán 1 ly với giá thật.
4. Sau khi lưu hoá đơn → vào `/hang-hoa/lich-su-kho` → check:
   - Tồn NVL Cà phê giảm 12g (theo BOM).
   - Tồn NVL Đường giảm 3.5g (vì 70% = 5 × 0.7).
   - Tồn NVL Sữa giảm 40ml.
   - **Bạc xỉu (SKU) KHÔNG giảm tồn** (vì has_bom=true).

→ Nếu đúng → setup thành công.

---

## ❓ 10 lỗi thường gặp + cách fix

| Lỗi | Triệu chứng | Fix |
|---|---|---|
| 1. **Mã nhóm chưa tồn tại** | Import SP báo lỗi "Category không tồn tại" | Làm Bước 1 trước, hoặc tạo nhóm qua UI rồi import lại |
| 2. **NVL chưa tồn tại** | Import BOM báo lỗi "Material không tồn tại" | Làm Bước 3 trước Bước 5 |
| 3. **Mã BOM trùng** | Lỗi "BOM code already exists" | Đổi mã BOM (vd thêm hậu tố `-v2`) |
| 4. **ĐVT NVL không khớp BOM** | NVL "Sữa lon" ĐVT="lon", BOM khai "25 ml" | Đổi ĐVT NVL sang ml + quy đổi 1 lon = 380 ml. Hoặc khai BOM theo lon (0.065 lon) |
| 5. **Modifier chưa tạo trước khi gán** | Cột "Scale theo modifier" báo lỗi | Làm Bước 2 (Modifier UI) trước Bước 5 |
| 6. **POS không hiện món** | Quán không thấy món vừa tạo | Check: SP có `channel=fnb`? Nhóm có `channel=fnb`? Branch có cấu hình đúng? |
| 7. **Bán 1 ly mà NVL không giảm** | Tồn NVL không thay đổi sau khi bán | Check SP có `has_bom=true` không? BOM có items không? |
| 8. **NVL "Đường" trừ quá nhiều** | 1 ly 70% đường trừ 10g thay vì 7g | Item Đường trong BOM chưa gán "Mức đường" ở cột Scale |
| 9. **Topping không trừ NVL** | Khách chọn Trân châu nhưng NVL Trân châu không giảm | Option Topping trong UI Modifier chưa link tới NVL (cần điền `linkedProductId`) |
| 10. **Số tồn NVL âm** | Tồn NVL bị âm dù vẫn còn hàng | Tồn ban đầu nhập sai. Vào `/hang-hoa/kiem-kho` cân bằng lại |

---

## 🎯 Checklist sau setup

- [ ] Tất cả 10 nhóm FnB hiện trong `/hang-hoa/nhom`.
- [ ] 4 nhóm modifier hiện trong `/hang-hoa/tuy-chon-fnb`.
- [ ] 15+ NVL trong `/hang-hoa` (filter Loại=NVL).
- [ ] 10+ SKU món trong `/hang-hoa` (filter Channel=FnB).
- [ ] BOM tương ứng cho mỗi SKU món (filter "Có BOM").
- [ ] Test bán 1 ly đầu → NVL giảm đúng.
- [ ] Nhân viên nhận `CHEAT-SHEET-NV-FNB.md` (cheat sheet 1 trang).

---

## 📚 Tài liệu liên quan

- `FNB-SETUP-MASTER.xlsx` — Excel mẫu 6 sheet.
- `CHEAT-SHEET-NV-FNB.md/.pdf` — 1 trang cho nhân viên.
- `HUONG-DAN-TAO-SKU-FNB-CU-THE.md` — hướng dẫn trước (legacy, đã include vào doc này).
- `HUONG-DAN-MENU.md` — cấu trúc menu hệ thống.
- `VERIFY-SQL-Sprint3.md` — verify migration đã apply.

---

**Phiên bản**: 03/06/2026 — Sprint 4 (Claude Opus 4.7 + CEO).
**Hỏi gì → báo Claude**, em xử lý ngay.
