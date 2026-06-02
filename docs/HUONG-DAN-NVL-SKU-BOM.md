# Hướng dẫn kết hợp NVL + SKU + BOM — ERP OneBiz

> Tài liệu **tổng hợp** cách kết hợp 3 entity cốt lõi của ERP chuỗi cà phê: **Nguyên Vật Liệu (NVL)**, **Hàng bán (SKU)** và **Công thức sản xuất (BOM)**.
>
> Dành cho: CEO, kế toán kho, quản lý chi nhánh, nhân viên nhập liệu.
> Cập nhật: 20/05/2026 (sau Sprint BOM Decouple — BOM tồn tại độc lập).

---

## Mục lục

1. [Khái niệm cốt lõi](#1-khái-niệm-cốt-lõi)
2. [Mối quan hệ NVL — SKU — BOM](#2-mối-quan-hệ-nvl--sku--bom)
3. [Workflow setup ban đầu (qua Excel)](#3-workflow-setup-ban-đầu-qua-excel)
4. [Workflow vận hành hằng ngày](#4-workflow-vận-hành-hằng-ngày)
5. [Ví dụ thực tế: "Bạc xỉu"](#5-ví-dụ-thực-tế-bạc-xỉu)
6. [Khi nào tạo BOM theo chi nhánh](#6-khi-nào-tạo-bom-theo-chi-nhánh)
7. [Trouble shooting](#7-trouble-shooting)

---

## 1. Khái niệm cốt lõi

### 🥄 NVL (Nguyên Vật Liệu)

- **Là gì**: Nguyên liệu thô — cà phê hạt, sữa, đường, ly, ống hút, bao gói...
- **KHÔNG bán cho khách** trên POS
- **Trừ kho** khi: nhập kho từ NCC (+), xuất sản xuất (−), xuất huỷ (−)
- **Mã tự sinh**: `NVL-{NHÓM}-{NNN}` (vd `NVL-CPH-001`, `NVL-SUA-002`)

### 🥤 SKU (Hàng bán)

- **Là gì**: Sản phẩm bán cho khách — ly cà phê, gói cà phê rang, bánh ngọt...
- **BÁN trên POS** (FnB tại quán hoặc Retail bán lẻ/sỉ)
- **Trừ kho** khi: bán SKU (−), sản xuất từ NVL (+)
- **Mã tự sinh**: `SKU-{NHÓM}-{NNN}` (vd `SKU-CFS-001`, `SKU-CFR-001`)

### 📋 BOM (Công thức sản xuất)

- **Là gì**: Công thức định nghĩa "Để sản xuất 1 SKU thì cần bao nhiêu NVL"
- **Tồn tại độc lập** (model mới CEO 20/05): 1 BOM có thể share nhiều SKU
- **Mã tự đặt**: `BOM-{NHÓM}-{NNN}` (vd `BOM-CFS-001`)
- **Trừ NVL tự động** khi bán SKU có gắn BOM
- **Áp dụng**:
  - Global (mọi chi nhánh dùng cùng công thức) — mặc định
  - Theo chi nhánh (quán Q1 dùng khác Q2) — override

---

## 2. Mối quan hệ NVL — SKU — BOM

```
                          ┌──────────────────────────────┐
                          │      📋 BOM (Công thức)       │
                          │                              │
                          │  Mã BOM: BOM-CFS-001         │
                          │  Tên: Bạc xỉu chuẩn          │
                          │                              │
                          │  Items:                      │
                          │   - NVL-CPH-001 × 18g        │
                          │   - NVL-SUA-001 × 80ml       │
                          │   - NVL-DUO-001 × 10g        │
                          └──────────────────────────────┘
                                    ▲
                                    │ link qua "Mã BOM"
                          ┌─────────┼─────────┐
                          │         │         │
                ┌─────────▼──┐  ┌───▼────┐  ┌─▼──────────┐
                │   🥤 SKU   │  │ 🥤 SKU │  │   🥤 SKU   │
                │  CFS-001   │  │CFS-005 │  │  CFS-009   │
                │ "Bạc xỉu"  │  │"Bạc xỉu│  │ "Bạc xỉu   │
                │            │  │ size L"│  │  cold brew"│
                └────────────┘  └────────┘  └────────────┘

                Tất cả 3 SKU dùng CÙNG BOM-CFS-001
                Sửa BOM 1 lần → cả 3 SKU update theo
```

**Nguyên tắc**:

| Quan hệ | Mô tả |
|---|---|
| 1 BOM | **Chứa nhiều NVL items** (multi-line — công thức) |
| 1 BOM | **Có thể được dùng bởi nhiều SKU** (1-N) |
| 1 SKU | **Có 1 Mã BOM** trỏ về (hoặc null = SKU không có công thức, mua bán đơn thuần) |
| 1 NVL | **Có thể xuất hiện trong nhiều BOM** (vd cà phê rang dùng cho cả bạc xỉu + cà phê đen) |
| BOM theo chi nhánh | **1 BOM riêng cho 1 quán** — override global khi cần khác công thức |

---

## 3. Workflow setup ban đầu (qua Excel)

> Áp dụng khi anh **lần đầu setup data** cho hệ thống (270 NVL + 50 SKU + 30 BOM chuỗi cà phê). Sau setup, chuyển sang workflow vận hành.

### Bước 1️⃣ — Tạo NVL (Excel)

**Đường dẫn**: `/hang-hoa` → tab **"Nguyên vật liệu (NVL)"** → bấm **"Tải mẫu"**

**File Excel SP** (chỉ điền dòng NVL, để cột Mã BOM trống):

| Mã SP | Tên SP | Loại | Đơn vị tính | Đóng gói | Hệ số quy đổi | Giá vốn |
|---|---|---|---|---|---|---|
| NVL-CPH-001 | Cà phê Robusta sống | nvl | Kg | Bao | 60 | 145.000 |
| NVL-SUA-001 | Sữa Vinamilk | nvl | Lon | Thùng | 24 | 26.000 |
| NVL-DUO-001 | Đường mía Biên Hoà | nvl | Kg | Bao | 25 | 24.000 |

→ Bấm **"Nhập Excel"** → preview lỗi → "Xác nhận import" → 270 NVL tạo xong.

### Bước 2️⃣ — Tạo SKU (Excel)

**Cùng file Excel SP**, điền thêm dòng SKU:

| Mã SP | Tên SP | Loại | Kênh | Đơn vị tính | Giá bán | Giá vốn | Mã BOM |
|---|---|---|---|---|---|---|---|
| SKU-CFS-001 | Bạc xỉu | sku | fnb | Ly | 35.000 | _(tự tính từ BOM)_ | _(tạm trống)_ |
| SKU-CFS-002 | Cà phê sữa đá | sku | fnb | Ly | 32.000 | | |
| SKU-CFR-001 | Cà phê rang 1kg | sku | retail | Kg | 280.000 | | |

→ Import → 50 SKU tạo xong (chưa có BOM, cột Mã BOM trống).

### Bước 3️⃣ — Tạo BOM (Excel)

**Đường dẫn**: `/hang-hoa/cong-thuc` → bấm **"Tải mẫu"** → file Excel BOM riêng.

**File Excel BOM** (1 sheet phẳng, repeat Mã BOM cho cùng 1 BOM):

| Mã BOM | Tên BOM | Mã chi nhánh | Mã NVL | Số lượng | ĐVT |
|---|---|---|---|---|---|
| `BOM-CFS-001` | Bạc xỉu chuẩn | _(trống = global)_ | NVL-CPH-001 | 18 | g |
| `BOM-CFS-001` | Bạc xỉu chuẩn | | NVL-SUA-001 | 80 | ml |
| `BOM-CFS-001` | Bạc xỉu chuẩn | | NVL-DUO-001 | 10 | g |
| `BOM-CFS-002` | Cà phê sữa đá | | NVL-CPH-001 | 20 | g |
| `BOM-CFS-002` | Cà phê sữa đá | | NVL-SUA-001 | 60 | ml |

→ Bấm **"Nhập Excel"** trên `/hang-hoa/cong-thuc` → 30 BOM tạo xong (chưa gắn SKU nào).

### Bước 4️⃣ — Link BOM vào SKU

**Cách A** ⭐ — Re-import Excel SP với cột "Mã BOM" điền giá trị:

| Mã SP | Tên SP | ... | Mã BOM |
|---|---|---|---|
| SKU-CFS-001 | Bạc xỉu | ... | `BOM-CFS-001` |
| SKU-CFS-002 | Cà phê sữa đá | ... | `BOM-CFS-002` |
| SKU-CFR-001 | Cà phê rang 1kg | ... | `BOM-CFR-001` |

→ Re-import Excel SP → hệ thống verify Mã BOM + link SKU ↔ BOM.

**Cách B** — Vào từng SKU sửa thủ công:
1. `/hang-hoa` → click row SKU → mở dialog Sửa
2. Tab **"Công thức (BOM)"** → tick "Có công thức sản xuất (BOM)"
3. Nhập **"Mã BOM"** (vd `BOM-CFS-001`) → onBlur verify ✓
4. Lưu

→ **Hoàn tất setup**. Hệ thống biết SKU nào dùng BOM nào để trừ NVL khi bán.

### ✅ Verify sau setup

```
1. /hang-hoa → SKU-CFS-001 có badge "Có BOM" ✓
2. /hang-hoa/cong-thuc → BOM-CFS-001 hiển thị + items đúng
3. POS thử bán SKU-CFS-001 1 ly → toast hiện NVL bị trừ (18g + 80ml + 10g)
4. /hang-hoa/ton-kho → tồn NVL giảm tương ứng
```

---

## 4. Workflow vận hành hằng ngày

### Tạo SP mới có BOM cùng lúc (form)

1. `/hang-hoa` → "+ Tạo mới" → chọn loại "Hàng bán (SKU)"
2. Điền thông tin SKU (tên, nhóm, đơn vị, giá bán)
3. Tab **"Công thức (BOM)"** → tick "Có công thức sản xuất (BOM)"
4. **2 lựa chọn**:
   - **Link BOM có sẵn** — gõ Mã BOM (vd `BOM-CFS-001`) — verify ✓
   - **Tạo BOM mới inline** — bỏ trống Mã BOM, điền items NVL bên dưới
5. Lưu → SKU + (link BOM hoặc tạo BOM mới) trong 1 click

### Sửa BOM (cập nhật công thức)

**Khi NCC đổi tỷ lệ hoặc tối ưu công thức**:

1. `/hang-hoa/cong-thuc` → click row BOM cần sửa
2. Detail panel → "Sửa items"
3. Cập nhật số lượng / thêm / xoá NVL
4. Lưu

→ **Mọi SKU đang dùng BOM đó tự cập nhật** (vì link qua Mã BOM, không clone).

### Tạo BOM theo chi nhánh (override)

Nếu Quán Q2 muốn pha khác Q1 + Q3:

1. `/hang-hoa/cong-thuc` → tạo BOM mới
2. **Mã BOM**: `BOM-CFS-001-Q2` (hoặc tự đặt)
3. **Áp dụng cho chi nhánh**: Q2
4. Items: 20g cà phê (thay 18g), 100ml sữa (thay 80ml)
5. Lưu

→ Hệ thống tự ưu tiên BOM riêng Q2 khi POS Q2 bán Bạc xỉu. Q1 + Q3 vẫn dùng BOM-CFS-001 global.

### Bán SKU trên POS → tự trừ NVL

```
POS bán 1 ly Bạc xỉu (SKU-CFS-001) tại Q1
    │
    ▼
Hệ thống đọc SKU-CFS-001.bom_code = "BOM-CFS-001"
    │
    ▼
Tìm BOM theo code + branch (Q1):
    1. Tìm BOM "BOM-CFS-001" với branch_id = Q1 → không có
    2. Fallback BOM global "BOM-CFS-001" (branch_id = null) → tìm thấy
    │
    ▼
Trừ NVL theo items của BOM:
    - NVL-CPH-001 (Cà phê) − 18g
    - NVL-SUA-001 (Sữa)    − 80ml
    - NVL-DUO-001 (Đường)  − 10g
    │
    ▼
Cập nhật tồn kho Q1 + ghi stock_movements
```

---

## 5. Ví dụ thực tế: "Bạc xỉu"

### Setup

**3 NVL**:
- `NVL-CPH-001` Cà phê Robusta rang 1kg — giá vốn 220.000đ/kg
- `NVL-SUA-001` Sữa tươi Vinamilk 1L — giá vốn 32.000đ/lít
- `NVL-DUO-001` Đường mía RE — giá vốn 24.000đ/kg

**1 SKU**:
- `SKU-CFS-001` Bạc xỉu — giá bán 35.000đ/ly, link `BOM-CFS-001`

**1 BOM**:
- `BOM-CFS-001` "Bạc xỉu chuẩn" (global):
  - 18g cà phê × 220đ/g = 3.960đ
  - 80ml sữa × 32đ/ml = 2.560đ
  - 10g đường × 24đ/g = 240đ
  - **Tổng giá vốn: 6.760đ/ly**

**Margin**: (35.000 − 6.760) / 35.000 = **80.7%**

### Workflow ngày bán 100 ly

```
POS bán 100 ly SKU-CFS-001
    │
    ▼
BOM-CFS-001 × 100 lần
    │
    ▼
Trừ tự động:
    NVL-CPH-001: − 1.8 kg cà phê (= 100 × 18g)
    NVL-SUA-001: − 8 lít sữa     (= 100 × 80ml)
    NVL-DUO-001: − 1 kg đường    (= 100 × 10g)
    │
    ▼
Doanh thu:   100 × 35.000 = 3.500.000đ
COGS:        100 × 6.760  =   676.000đ
Lợi nhuận gộp:           2.824.000đ (80.7%)
```

### Khi cần đổi công thức (vd: giảm đường để giảm cost)

Cũ: 10g đường → mới: 5g đường

1. `/hang-hoa/cong-thuc` → BOM-CFS-001 → "Sửa items"
2. Đường: 10g → 5g
3. Lưu

→ COGS mới: 6.760 − 120 = **6.640đ/ly**, margin tăng lên 81%.
→ Mọi POS bán Bạc xỉu từ giờ trừ 5g đường thay 10g.

---

## 6. Khi nào tạo BOM theo chi nhánh

**Mặc định**: BOM **global** (1 BOM cho mọi chi nhánh) — đa số case.

**Cần BOM riêng chi nhánh khi**:

1. **Khác công thức** — vd Q2 dùng đường nâu thay đường mía, Q3 thêm topping cream
2. **Khác tỷ lệ** — vd Q1 pha đậm (20g cà phê), Q2 pha nhạt (15g)
3. **Khác NVL** — vd Quán wholesale (Kho tổng) dùng sữa rẻ hơn quán FnB (sữa cao cấp)

**Cách tạo**:

```
BOM-CFS-001       branch_id = NULL  → áp dụng mọi chi nhánh (default)
BOM-CFS-001-Q1    branch_id = Q1    → chỉ Q1 dùng (override)
BOM-CFS-001-Q2    branch_id = Q2    → chỉ Q2 dùng
```

Hệ thống ưu tiên: **branch-specific > global**.

→ Q1 bán Bạc xỉu → dùng `BOM-CFS-001-Q1` (nếu có), fallback `BOM-CFS-001` global.
→ Q3 không có BOM riêng → dùng `BOM-CFS-001` global.

---

## 7. Trouble shooting

### Lỗi: "POS bán SKU không trừ NVL"

**Nguyên nhân**:
1. SKU `has_bom = false` → kiểm tra trong dialog Sửa SP
2. SKU `bom_code = null` → chưa link với BOM nào
3. BOM với code đó không tồn tại / không active
4. BOM tồn tại nhưng `branch_id` không match (vd BOM riêng Q1 nhưng bán ở Q2)

**Cách kiểm tra**:
```sql
-- Test BOM lookup cho 1 SKU + branch
SELECT public.get_active_bom_for_branch('<sku-id>'::uuid, '<branch-id>'::uuid);
-- → trả uuid = BOM tìm thấy
-- → null = không có BOM → POS không trừ NVL
```

### Lỗi: "Mã BOM chưa tồn tại trong hệ thống" khi import Excel SP

**Nguyên nhân**: Import SP có cột "Mã BOM" nhưng BOM đó chưa tạo.

**Cách fix**:
1. Vào `/hang-hoa/cong-thuc` → tạo BOM trước (qua form hoặc Excel BOM)
2. Sau đó re-import Excel SP

### Lỗi: "Mã BOM 'BOM-CFS-001' đã tồn tại trong tenant"

**Nguyên nhân**: Trùng mã BOM khi tạo BOM mới qua Excel.

**Cách fix**:
- Đổi mã BOM thành code khác (vd `BOM-CFS-001-V2`)
- HOẶC xoá BOM cũ rồi import lại

### Lỗi: "SKU đã đánh dấu Có BOM nhưng chưa setup công thức"

**Hiển thị**: Badge vàng "Chưa setup" trong list SP.

**Nguyên nhân**: `has_bom = true` nhưng `bom_code = null` hoặc BOM với code đó không có items.

**Cách fix**:
1. Vào SP → tab "Công thức (BOM)" → nhập Mã BOM (link với BOM có sẵn)
2. HOẶC tick bỏ "Có công thức BOM" (nếu SKU thực sự không cần BOM, vd hàng mua bán đơn thuần)

---

## 🍹 Variant (Quy cách) + Modifier (Tuỳ chọn FnB) — Sprint 2 (CEO 01/06/2026)

Phương án Toast Inheritance — chuẩn các POS FnB lớn (Toast, Square, Sapo, KiotViet):
1 SKU + nhiều **Quy cách (Size M/L/XL)** + nhiều **Tuỳ chọn (Mức đường, Mức đá, Topping)**.

### Variant (Quy cách)

Bảng `product_variants` chứa các size của 1 SKU. Mỗi variant có:
- Tên (M/L/XL, hoặc 250g/500g/1kg cho retail) — **tùy biến**, anh tự đặt.
- Giá bán + Giá vốn riêng.
- **Mã BOM riêng** (cho FnB) — vd Bạc xỉu M dùng BOM 18g cà phê, Bạc xỉu L dùng BOM 25g.
- 1 variant `is_default=true` (auto force khi xoá default).

**Setup**: Vào form SP scope=SKU → tab **"Quy cách"** → thêm các size + giá riêng.

**POS hành xử**:
- Cashier tap món có variant → dialog mở pick size → POS dùng giá + BOM của size đó.
- SP không có variant → POS dùng giá gốc của SP.

### Modifier (Tuỳ chọn món FnB) — Toast inheritance

**3 bảng**:
- `modifier_groups`: nhóm (Mức đường, Mức đá, Topping, Size).
- `modifier_options`: option trong group (0%/30%/70%/100%, Trân châu...).
- `category_modifier_groups` + `product_modifier_groups`: gán cho cả nhóm SP hoặc SP riêng.

**Setup nhanh** (1 click):
1. Vào `/hang-hoa/tuy-chon-fnb` → bấm **"Tạo preset FnB Việt"** → sinh sẵn 4 nhóm.
2. Vào `/hang-hoa/nhom` → sửa nhóm "Cà phê" → tick các nhóm tuỳ chọn → Lưu. Mọi SP trong nhóm tự thừa kế.
3. SP đặc biệt cần override → vào form SP → tab **"Tuỳ chọn FnB"** → bật Override.

### Modifier scale BOM (POS trừ tồn NVL theo %)

Mỗi BOM item có cột `modifier_scale_target` link tới 1 modifier group. Khi cashier chọn option, RPC checkout scale qty NVL × `scale_factor` của option đó.

**Vd**: BOM "Bạc xỉu M" có NVL "Đường" 10g với `modifier_scale_target = Mức đường`. Cashier chọn 70% đường (`scale_factor = 0.7`) → POS trừ tồn 7g đường (thay vì 10g).

**Setup**: Vào form SP → tab "Công thức (BOM)" → tick NVL "Đường" → dropdown **"Scale theo modifier"** → chọn "Mức đường" → Lưu.

### Topping NVL trừ tồn

Modifier option có thể link tới 1 NVL/SKU topping qua `linked_product_id`. Khi cashier chọn topping, RPC trừ tồn linked NVL × số ly.

**Vd**: Option "Trân châu đen" có `linked_product_id = NVL-TPV-001` + `price_delta = 7000`. Khách order 2 ly Bạc xỉu + tick Trân châu → POS trừ 2 NVL-TPV-001 + +14k giá.

### Báo cáo modifier

Vào `/phan-tich/fnb-modifier` — anh xem được:
- Tổng lượt chọn từng option.
- % chia trong cùng nhóm (vd Mức đường: 70% chiếm 45%, 100% chiếm 30%).
- Doanh thu phí cộng từ Topping.
- Export Excel.

Dùng để: quyết định bỏ option ít chọn, tăng giá topping bán chạy, biết khẩu vị khách quán.

### KDS + Phiếu bếp

KDS render thêm dòng modifier compact tone xanh: `▸ Mức đường: 70% • Mức đá: Ít • Topping: Trân châu`.

Phiếu in bếp cũng có dòng modifier với background xanh nổi bật để bếp đọc nhanh, không phải parse note tự do.

---

## 📚 Tài liệu liên quan

- [`HUONG-DAN-NHAP-LIEU-HANG-HOA.md`](./HUONG-DAN-NHAP-LIEU-HANG-HOA.md) — Hướng dẫn nhập liệu chi tiết từng bước
- `/hang-hoa/cong-thuc` — Trang quản lý BOM
- `/hang-hoa/tuy-chon-fnb` — Quản lý nhóm tuỳ chọn FnB
- `/phan-tich/fnb-modifier` — Báo cáo lựa chọn modifier
- `/hang-hoa/cong-thuc/cai-tien-tuong-lai` — Mockup cải tiến tương lai
