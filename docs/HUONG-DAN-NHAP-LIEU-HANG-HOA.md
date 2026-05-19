# Hướng dẫn nhập liệu hàng hoá — ERP OneBiz

> Tài liệu này hướng dẫn từng bước nhập liệu hàng hoá cho chuỗi cà phê OneBiz:
> Xưởng rang + Kho tổng + 3 quán FnB. Theo đúng thứ tự để tránh lỗi.
>
> Dành cho: CEO, kế toán kho, quản lý chi nhánh.
> Cập nhật: 18/05/2026 (sau Sprint BOM-CONSUME).

---

## Mục lục

1. [Khái niệm cốt lõi — đọc TRƯỚC khi setup](#1-khái-niệm-cốt-lõi)
2. [Thứ tự setup chuẩn — không được bỏ qua bước nào](#2-thứ-tự-setup-chuẩn)
3. [Bước 1 — Chi nhánh](#bước-1--chi-nhánh)
4. [Bước 2 — Nhóm hàng (Categories)](#bước-2--nhóm-hàng-categories)
5. [Bước 3 — Đơn vị tính](#bước-3--đơn-vị-tính)
6. [Bước 4 — Thương hiệu (tùy chọn)](#bước-4--thương-hiệu)
7. [Bước 5 — Nhà cung cấp (NCC)](#bước-5--nhà-cung-cấp-ncc)
8. [Bước 6 — Tạo NVL (Nguyên Vật Liệu)](#bước-6--tạo-nvl-nguyên-vật-liệu)
9. [Bước 7 — Tạo SKU (sản phẩm bán)](#bước-7--tạo-sku-sản-phẩm-bán)
10. [Bước 8 — BOM (Công thức)](#bước-8--bom-công-thức)
11. [Bước 9 — Bảng giá + Giá kênh bán FnB](#bước-9--bảng-giá--giá-kênh-bán)
12. [Bước 10 — Nhập kho đầu kỳ + chuyển kho](#bước-10--nhập-kho-đầu-kỳ--chuyển-kho)
13. [Quy tắc đặt mã hàng](#quy-tắc-đặt-mã-hàng)
14. [Checklist hoàn chỉnh — in ra cho nhân viên](#checklist-hoàn-chỉnh)
15. [Lỗi thường gặp + cách xử lý](#lỗi-thường-gặp)

---

## 1. Khái niệm cốt lõi

### 1.1. NVL vs SKU — phải phân biệt RÕ

| Loại | Định nghĩa | Vai trò trên hệ thống |
|---|---|---|
| **NVL** (Nguyên Vật Liệu) | Hàng nhập từ NCC, không bán trực tiếp cho khách | Đầu vào của sản xuất hoặc BOM |
| **SKU** (Stock Keeping Unit) | Sản phẩm bán cho khách (kể cả bán nội bộ giữa kho ↔ quán) | Có giá bán, có BOM định nghĩa thành phần |

**Ví dụ chuỗi anh**:
- **NVL**: Cà phê hạt Robusta sống (mua từ NCC Đắk Lắk), Sữa tươi Vinamilk hộp 1L, Đường mía RE, Ly nhựa, Ống hút...
- **SKU**: Cà phê rang Robusta 1kg (xưởng SX), Bạc xỉu 1 ly (quán bán), Cà phê hạt rang 250g (bán lẻ retail)

### 1.2. Một mã có thể đa vai trò (Pattern A — chuẩn Odoo/SAP)

Hệ thống hỗ trợ **1 mã làm 2 vai trò** ở 2 nơi khác nhau:

```
"Cà phê rang Robusta 1kg" (mã SKU-CPR-001)
├── Ở Kho tổng:   là SKU bán nội bộ cho 3 quán FnB
└── Ở Quán FnB:   là NGUYÊN LIỆU trong BOM "Bạc xỉu" (1 ly = 18g)
```

→ Không cần tạo 2 mã riêng. Chỉ cần đánh dấu `has_bom=true` ở SKU bán và đưa vào BOM ở SP khác.

### 1.3. Đơn vị tính (ĐVT) — chỉ 1 cột duy nhất

**Nguyên tắc**: nhập **đơn vị nhỏ nhất khi bán lẻ** — 1 lon, 1 kg, 1 ly, 1 cái...

| Cột Excel | Bắt buộc? | Ví dụ |
|---|---|---|
| **Đơn vị tính** | ✅ Có | `Ly`, `Kg`, `Lon`, `Cái`, `Chai`, `Gói` |

**Ví dụ thực tế**:
- SP "Cà phê đen đá" → **Đơn vị tính = `Ly`**
- SP "Sữa Vinamilk lon" → **Đơn vị tính = `Lon`**
- SP "Cà phê Robusta sống" → **Đơn vị tính = `Kg`**

#### Khi mua gói lớn (vd thùng 24 lon)?

Hệ thống KHÔNG có conversion tự động "1 thùng = 24 lon". User tự quy đổi khi tạo phiếu nhập:

**Cách làm**: tạo SP "Sữa Vinamilk" với `Đơn vị tính = Lon`. Khi nhập 1 thùng → tạo phiếu nhập với **số lượng = 24** (vì 1 thùng = 24 lon). Tồn kho luôn tính theo `Lon`.

> **Lưu ý**: trước đây có 4 cột (Đơn vị tính / ĐVT nhập / ĐVT kho / ĐVT bán) → đã rút gọn còn 1 cột (CEO 19/05/2026) vì các cột phụ không có giá trị nghiệp vụ thực sự (chỉ là text hiển thị, không có conversion logic).

### 1.4. BOM — Bill of Materials (Công thức)

BOM định nghĩa **thành phần NVL** để tạo ra 1 SKU. Có thể:
- **Global** (`branch_id = NULL`) — áp dụng tất cả chi nhánh
- **Theo chi nhánh** (`branch_id = Q1_id`) — override cho 1 quán

**Ví dụ BOM "Bạc xỉu"** (global):
- 18g Cà phê rang Robusta 1kg
- 80ml Sữa tươi Vinamilk
- 10g Đường mía

Khi quán FnB Q1 bán 1 ly Bạc xỉu → hệ thống TỰ ĐỘNG trừ NVL trên khỏi tồn kho Q1 (không phải Q2).

### 1.5. Multi-level inventory: Kho tổng → Quán FnB

```
NCC ──nhập──> Kho tổng (NVL: cà phê sống, sữa, đường)
                 │
                 ├── Xưởng SX ──> SKU "Cà phê rang 1kg"
                 │
                 ├── Bán nội bộ cho Quán FnB qua "Chuyển kho"
                 │
                 └── Quán FnB nhận SKU làm NVL trong BOM "Bạc xỉu"
```

---

## 2. Thứ tự setup chuẩn

**Không được bỏ qua hay đảo thứ tự** — vì các bước sau phụ thuộc data của bước trước.

```
1. Chi nhánh         ← lập danh sách các đơn vị (xưởng/kho/quán)
2. Nhóm hàng         ← phân loại NVL/SKU
3. Đơn vị tính       ← danh sách đvt sử dụng (kg/lít/cái/ly...)
4. Thương hiệu       ← optional (Trung Nguyên, Highlands...)
5. Nhà cung cấp      ← danh sách NCC mua NVL
6. NVL               ← nhập từng NVL với 2 ĐVT (mua + kho)
7. SKU               ← nhập từng SKU với ĐVT bán + has_bom flag
8. BOM               ← định nghĩa công thức cho SKU has_bom=true
9. Bảng giá          ← giá bán SKU (theo bảng giá khác nhau nếu cần)
10. Nhập kho đầu kỳ  ← nhập tồn ban đầu cho NVL/SKU
```

---

## Bước 1 — Chi nhánh

**Đường dẫn**: `/cai-dat/chi-nhanh`

### Mục đích
Khai báo các đơn vị vật lý — mỗi đơn vị có tồn kho riêng.

### Loại chi nhánh (`branchType`)

| Loại | Dùng cho | Ví dụ |
|---|---|---|
| `warehouse` | Kho tổng | "Kho Tổng OneBiz" |
| `factory` | Xưởng sản xuất | "Xưởng rang Bình Dương" |
| `store` | Quán FnB (bán đồ uống) | "Quán Phố Đi Bộ", "Quán Hai Bà Trưng", "Quán Lê Lợi" |
| `office` | Văn phòng (nếu có) | — |

### Trường nhập

| Trường | Bắt buộc | Ví dụ | Lưu ý |
|---|---|---|---|
| Mã chi nhánh | ✓ | `KHO01`, `XUONG01`, `Q01`, `Q02`, `Q03` | Ngắn, viết hoa, dễ nhận diện |
| Tên chi nhánh | ✓ | "Kho Tổng OneBiz" | Hiển thị đầy đủ |
| Loại | ✓ | `warehouse` | Ảnh hưởng nhiều logic (POS FnB chỉ show `store`) |
| Địa chỉ | | "123 Lê Lợi, Q1, TP.HCM" | Cho in bill |
| SĐT | | | |
| Trạng thái | | `active` | `inactive` để tạm đóng |

### Ví dụ thực tế chuỗi anh

| Mã | Tên | Loại |
|---|---|---|
| KHO01 | Kho Tổng | warehouse |
| XUONG01 | Xưởng rang Bình Dương | factory |
| Q01 | Quán Phố Đi Bộ | store |
| Q02 | Quán Hai Bà Trưng | store |
| Q03 | Quán Lê Lợi | store |

---

## Bước 2 — Nhóm hàng (Categories)

**Đường dẫn**: `/hang-hoa/nhom-hang`

### Mục đích
Phân loại NVL/SKU thành nhóm để báo cáo + filter + tự sinh mã.

### Cấu trúc nhóm 2 cấp

```
Cấp 1 (nhóm cha) → Cấp 2 (nhóm con — optional)
```

### Đề xuất nhóm cho chuỗi cà phê

**Nhóm NVL** (đầu vào):

| Mã nhóm | Tên | Áp dụng cho |
|---|---|---|
| CPH | Cà phê hạt | Cà phê sống các loại |
| SUA | Sữa | Sữa tươi, sữa đặc |
| BOT | Bột & đường | Đường, bột matcha, cacao |
| TPV | Topping FnB | Trân châu, thạch, kem |
| SYR | Syrup/Sốt | Syrup vanilla, caramel, sốt |
| BBI | Bao bì | Ly nhựa, nắp, ống hút, túi |
| VPP | Văn phòng phẩm | Giấy, bút, văn phòng |
| DCV | Dụng cụ vệ sinh | Khăn lau, nước lau sàn |
| DCU | Dụng cụ pha chế | Cây khuấy, lọc cà phê |

**Nhóm SKU** (đầu ra):

| Mã nhóm | Tên | Áp dụng cho |
|---|---|---|
| CFR | Cà phê đã rang | "Cà phê rang Robusta 1kg" |
| CFS | Cà phê pha sẵn | "Cà phê đen", "Bạc xỉu", "Cà phê sữa" |
| TRA | Trà & matcha | "Trà sữa matcha", "Trà đào" |
| NHA | Nước hoa quả & smoothie | "Sinh tố bơ", "Sinh tố dâu" |
| BAN | Bánh ngọt | "Bánh croissant", "Bánh tiramisu" |
| CMB | Combo & gói quà | "Combo cà phê + bánh", "Gói quà Tết" |

### Trường nhập

| Trường | Bắt buộc | Ví dụ |
|---|---|---|
| Mã | ✓ | `CPH` (3 chữ viết hoa) |
| Tên | ✓ | "Cà phê hạt" |
| Nhóm cha | | (để trống nếu là nhóm cấp 1) |
| Mô tả | | "Các loại cà phê hạt nhập từ NCC" |

### ⚠️ Lưu ý quan trọng

**Mã nhóm dùng để tự sinh mã SP**: NVL nhóm CPH → mã sẽ là `NVL-CPH-001`, `NVL-CPH-002`...

Vì vậy mã nhóm phải ngắn (3-4 ký tự) + có ý nghĩa.

---

## Bước 3 — Đơn vị tính

**Đường dẫn**: `/hang-hoa/don-vi-tinh`

### Mục đích
Khai báo danh sách ĐVT chuẩn dùng trong toàn hệ thống.

### Danh sách ĐVT đề xuất

| ĐVT | Dùng cho |
|---|---|
| kg | Cà phê hạt, đường |
| g | NVL nhỏ (cho BOM) |
| lít | Sữa tươi, syrup |
| ml | NVL lỏng (cho BOM) |
| ly | Đồ uống FnB |
| cái | Bánh ngọt, ly nhựa |
| hộp | Sữa hộp, bánh hộp |
| chai | Nước suối, syrup chai |
| thùng | Sữa thùng, nước thùng |
| bao | Cà phê sống nhập bao |
| gói | Bánh gói, đường gói |
| cuộn | Giấy in bill, băng keo |
| tệp | Giấy A4 |
| bình | Bình ga, bình nước |

### ⚠️ Lưu ý

- **Phải nhập thống nhất** — đừng tạo cả "Kg" và "kg" (trùng nhưng case khác → tốn data).
- ĐVT cho BOM phải đủ chi tiết (gram, ml) để tính chính xác.
- ĐVT mua thường lớn hơn ĐVT kho (vd: mua bao 60kg → kho tính theo kg).

---

## Bước 4 — Thương hiệu

**Đường dẫn**: lúc tạo SP → field "Thương hiệu"

### Mục đích
Track xuất xứ NVL (giúp báo cáo + thương lượng giá NCC).

### Ví dụ

| NVL | Thương hiệu |
|---|---|
| Cà phê hạt | Trung Nguyên / Highlands / Phúc Long / OneBiz (tự pha) |
| Sữa tươi | Vinamilk / TH True Milk / Mộc Châu |
| Đường mía | Biên Hòa / La Ngà |
| Syrup | Monin / Torani |

Field tự do — nhập trực tiếp khi tạo SP (không cần master list).

---

## Bước 5 — Nhà cung cấp (NCC)

**Đường dẫn**: `/hang-hoa/nha-cung-cap`

### Mục đích
Khai báo NCC để liên kết với NVL → đặt hàng nhập nhanh.

### Trường nhập

| Trường | Bắt buộc | Ví dụ |
|---|---|---|
| Mã NCC | ✓ tự sinh | `NCC-001` |
| Tên NCC | ✓ | "Công ty TNHH Cà phê Đắk Lắk" |
| MST | | `0301234567` (nếu cần in hoá đơn VAT) |
| Người liên hệ | | "Anh Hùng" |
| SĐT | | `0901234567` |
| Email | | `huong@daklak.vn` |
| Địa chỉ chi tiết | | (6 cột tách rời sau migration 00089 + 00101) |
| - Số nhà | | "123" hoặc "45/2A" |
| - Tên đường | | "Lê Lợi", "Nguyễn Văn Cừ" |
| - Khu phố | | "KP3" |
| - Phường | | "P.Bến Thành" |
| - Tỉnh/TP | | "TP HCM" (dropdown 34 tỉnh sau sáp nhập 2025) |
| - Quốc gia | | "Việt Nam" (mặc định) |
| Công nợ ban đầu | | `0` |
| Hạn mức nợ | | `50,000,000` (tối đa cho phép nợ) |

### Ví dụ chuỗi anh

| NCC | Loại NVL cung cấp |
|---|---|
| Cà phê Đắk Lắk | Cà phê hạt sống Robusta, Arabica |
| Vinamilk | Sữa tươi |
| Đường Biên Hòa | Đường mía RE |
| In Hồng Phát | Ly nhựa, bao bì in logo |
| Văn phòng phẩm Thiên Long | Bút, giấy, hoá đơn |

---

## Bước 6 — Tạo NVL (Nguyên Vật Liệu)

**Đường dẫn**: `/hang-hoa` → tab "Nguyên vật liệu" → click **"+ Tạo mới"**

### Trường nhập

| Trường | Bắt buộc | Ví dụ "Cà phê hạt sống Robusta" |
|---|---|---|
| **Loại SP** | ✓ | "Nguyên vật liệu (NVL)" — chọn tab |
| **Tên hàng** | ✓ | "Cà phê hạt sống Robusta S18 60kg/bao" |
| **Nhóm hàng** | ✓ | "Cà phê hạt" (mã CPH) |
| **Mã hàng** | tự sinh | `NVL-CPH-001` (auto theo nhóm) |
| Mã vạch | | (nếu có in barcode) |
| **Thương hiệu** | | "Cà phê Đắk Lắk" |
| **NCC** | | Chọn từ danh sách |
| **ĐVT mua** | ✓ | `bao` |
| **ĐVT kho** | ✓ | `kg` |
| ĐVT bán | — | **NVL không có** (ẩn tự động) |
| Mô tả | | "Cà phê Robusta loại S18, độ ẩm 12%, mua bao 60kg" |

### Tab "Giá & Tồn kho"

| Trường | Ví dụ | Lưu ý |
|---|---|---|
| **Giá vốn** | `200,000`/kg | Giá NCC bán cho mình (chia theo ĐVT kho) |
| Giá nhập mặc định | `12,000,000`/bao | Auto = giá vốn × hệ số quy đổi |
| Tồn tối thiểu | `100` kg | Cảnh báo hết hàng |
| Tồn tối đa | `1,000` kg | Cảnh báo dư thừa |
| Cho phép bán âm | tắt (mặc định) | NVL không bán nên không cần |

### Tab "Quy đổi ĐVT" (sau khi tạo)

Khai báo: `1 bao = 60 kg`

→ Khi nhập 1 bao, hệ thống tự cộng 60kg vào tồn.

### Ví dụ đầy đủ một số NVL

| Mã | Tên | Nhóm | ĐVT mua | ĐVT kho | Giá vốn | Quy đổi |
|---|---|---|---|---|---|---|
| NVL-CPH-001 | Cà phê hạt sống Robusta S18 | CPH | bao | kg | 200k/kg | 1 bao = 60kg |
| NVL-CPH-002 | Cà phê hạt sống Arabica Cầu Đất | CPH | bao | kg | 320k/kg | 1 bao = 50kg |
| NVL-SUA-001 | Sữa tươi Vinamilk hộp 1L | SUA | thùng | hộp | 28k/hộp | 1 thùng = 12 hộp |
| NVL-SUA-002 | Sữa đặc Ông Thọ lon 380g | SUA | thùng | lon | 22k/lon | 1 thùng = 48 lon |
| NVL-BOT-001 | Đường mía RE Biên Hòa | BOT | bao | kg | 18k/kg | 1 bao = 50kg |
| NVL-BBI-001 | Ly nhựa PP 360ml có nắp | BBI | thùng | cái | 800/cái | 1 thùng = 1000 cái |
| NVL-BBI-002 | Ống hút giấy 197mm | BBI | thùng | cái | 150/cái | 1 thùng = 2500 cái |

---

## Bước 7 — Tạo SKU (sản phẩm bán)

**Đường dẫn**: `/hang-hoa` → tab "Hàng bán" → click **"+ Tạo mới"**

### Trường nhập

| Trường | Bắt buộc | Ví dụ "Bạc xỉu" | Ví dụ "Cà phê rang 1kg" |
|---|---|---|---|
| **Loại SP** | ✓ | "Hàng bán (SKU)" | "Hàng bán (SKU)" |
| **Tên hàng** | ✓ | "Bạc xỉu" | "Cà phê rang Robusta 1kg" |
| **Nhóm hàng** | ✓ | CFS (Cà phê pha sẵn) | CFR (Cà phê đã rang) |
| **Mã hàng** | tự sinh | `SKU-CFS-001` | `SKU-CFR-001` |
| Mã vạch | | | (in barcode trên gói) |
| **Kênh bán** | ✓ | `fnb` (bán ở quán) | `retail` (bán lẻ) hoặc `all` |
| **ĐVT bán** | ✓ | `ly` | `gói` (1kg/gói) |
| ĐVT mua | — | bỏ trống | bỏ trống |
| ĐVT kho | ✓ | `ly` | `gói` (mỗi đơn vị kho = 1 gói) |
| **Có BOM?** (`has_bom`) | ✓ | **bật** (có BOM = 18g cà phê + 80ml sữa + 10g đường) | **bật** (BOM = 1.05kg cà phê sống) |
| Cho phép bán | ✓ | bật | bật |

### Tab "Giá & Tồn kho"

| Trường | "Bạc xỉu" | "Cà phê rang 1kg" |
|---|---|---|
| **Giá bán** | `35,000` (giá khách trả) | `350,000` (giá kho bán cho quán) |
| **Giá vốn** | TỰ TÍNH từ BOM | TỰ TÍNH từ BOM |
| Tồn tối thiểu | — (BOM consume tự trừ) | 5 gói (cảnh báo SX thêm) |
| Cho phép bán âm | — (cấu hình toàn hệ thống ở `/cai-dat/kho-hang`) | — |

### ⚠️ Lưu ý về `has_bom`

- **Bật `has_bom` ⇒ phải tạo BOM ở Bước 8**. Nếu không, hệ thống hiển thị badge vàng **"Chưa setup"** trong danh sách SKU + POS bán không trừ NVL.
- Có thể bật/tắt `has_bom` lúc nào cũng được. Tắt = bán trực tiếp 1:1 không trừ NVL.

### Use case mẫu

**SKU FnB** (quán bán):
- Bạc xỉu, Cà phê đen, Cà phê sữa, Trà sữa matcha → `has_bom = true`, kênh = `fnb`
- Bánh croissant (bán nguyên cái, không pha chế) → `has_bom = false`, kênh = `fnb`

**SKU Retail** (bán lẻ):
- Cà phê rang 250g, Combo cà phê + ly thuỷ tinh → `has_bom = true`, kênh = `retail`

**SKU bán nội bộ** (kho tổng → quán):
- Cà phê rang 1kg, Bột matcha 500g, Syrup chai 1L → `has_bom = true`, kênh = `all`

---

## Bước 8 — BOM (Công thức)

**Đường dẫn**: `/hang-hoa/cong-thuc` → click **"+ Tạo công thức"**

### Mục đích
Định nghĩa NVL cần thiết để tạo ra 1 đơn vị SKU. Hệ thống dùng BOM để:
- Tính giá vốn SKU tự động (`SUM(NVL × cost_price)`)
- Trừ NVL khỏi tồn kho khi bán SKU trên POS
- Báo cáo tiêu hao NVL theo chi nhánh

### Trường nhập

| Trường | Bắt buộc | Ví dụ BOM "Bạc xỉu" |
|---|---|---|
| **SKU đầu ra** | ✓ | Chọn "Bạc xỉu" (SKU-CFS-001) |
| **Tên công thức** | ✓ | "Bạc xỉu — v1" |
| **Áp dụng cho chi nhánh** | ✓ | "Áp dụng tất cả chi nhánh (mặc định)" — BOM global |
| Batch size | | `1` (1 lần pha = 1 ly) |
| Sản lượng/batch | | `1` |
| ĐVT sản lượng | | `ly` |
| **Nguyên vật liệu (items)** | ✓ | Danh sách NVL × số lượng |
| Ghi chú | | "Quy trình: 1) Lấy 18g cà phê. 2) Pha với 80ml sữa nóng. 3) Cho 10g đường." |

### Bảng nguyên vật liệu (BOM items)

| NVL | Số lượng | ĐVT | Hao hụt % | Ghi chú |
|---|---|---|---|---|
| Cà phê rang Robusta 1kg | 0.018 | kg (= 18g) | 5% | Hao do bột rơi |
| Sữa tươi Vinamilk | 0.08 | lít (= 80ml) | 2% | — |
| Đường mía | 0.01 | kg (= 10g) | 0% | — |

**Hao hụt %**: nếu khai 5% thì hệ thống tự cộng → trừ 18g × 1.05 = 18.9g/ly.

### BOM theo chi nhánh (override)

Nếu quán Q2 muốn pha công thức KHÁC quán Q1 và Q3:
1. Vào BOM global "Bạc xỉu" → click ⋮ → **"Tạo BOM riêng cho quán"**
2. Chọn chi nhánh Q2 → click "Tạo BOM riêng"
3. Sửa items (vd: 20g cà phê thay 18g, đường nâu thay đường mía)

→ Q2 bán Bạc xỉu sẽ dùng BOM riêng. Q1 + Q3 vẫn dùng BOM global.

### Ví dụ BOM khác

**BOM "Cà phê rang Robusta 1kg"** (SX xưởng):

| NVL | Số lượng | Hao hụt % |
|---|---|---|
| Cà phê hạt sống Robusta | 1.05 kg | 0% (đã tính trong số lượng) |
| Bao gói 1kg | 1 cái | 0% |

→ Khi xưởng tạo 100kg cà phê rang → trừ 105kg cà phê sống + 100 bao.

**BOM "Cà phê đen FnB"**:

| NVL | Số lượng | Hao hụt % |
|---|---|---|
| Cà phê rang Robusta 1kg | 0.025 kg (= 25g) | 5% |
| Ly nhựa PP 360ml | 1 cái | 0% |
| Ống hút giấy | 1 cái | 0% |

→ Khi quán bán 1 ly cà phê đen → trừ 26.25g cà phê rang + 1 ly + 1 ống hút.

### ⚠️ Lưu ý

- **NVL trong BOM có thể là cả NVL gốc lẫn SKU khác** (Pattern A — đa vai trò).
- 1 SKU có thể có **nhiều BOM** (global + per-branch). Hệ thống ưu tiên branch-specific.
- Sau khi tạo BOM → badge "Chưa setup" trong danh sách SKU sẽ đổi thành "Có BOM" ✓.

---

## Bước 9 — Bảng giá & Giá kênh bán

**Đường dẫn**: `/cai-dat/bang-gia`

### Mục đích
Quản lý giá bán khác nhau theo:
- Khách hàng (VIP, member, retail)
- Kênh bán (POS quán vs Shopee Food vs GrabFood)
- Chi nhánh

### Cấu trúc bảng giá

**Bảng giá mặc định**: tự sinh "Giá lẻ" — áp dụng cho mọi POS nếu không cấu hình khác.

**Bảng giá tùy chỉnh**: tạo thêm cho VIP, đại lý...

### Giá theo kênh bán FnB (Shopee/Grab/Direct)

**Đường dẫn**: `/cai-dat/bang-gia/platforms`

Mỗi SKU FnB có thể có **3 giá khác nhau**:

| Kênh | Cách tính giá | Ví dụ "Bạc xỉu" |
|---|---|---|
| Direct (tại quán) | Giá bán mặc định | 35,000đ |
| Shopee Food | Giá Direct × hệ số (vd 1.2) hoặc nhập tay | 42,000đ |
| GrabFood | Tương tự | 45,000đ |

**Tại sao phải có giá riêng?** Sàn ăn % hoa hồng 20-30% → quán phải tăng giá để giữ margin.

---

## Bước 10 — Nhập kho đầu kỳ + chuyển kho

### 10.1. Nhập kho đầu kỳ (cho NVL)

**Đường dẫn**: `/hang-hoa/nhap-hang` → tạo phiếu nhập

| Trường | Ví dụ |
|---|---|
| NCC | "Cà phê Đắk Lắk" |
| Chi nhánh nhập | Kho Tổng (KHO01) |
| Ngày nhập | Hôm nay |
| Items | NVL-CPH-001 × 10 bao × 12,000,000 = 120,000,000 |
| Hình thức thanh toán | Tiền mặt / chuyển khoản / công nợ |

→ Sau khi xác nhận → tồn NVL-CPH-001 ở Kho Tổng = 10 bao = 600kg.

### 10.2. Chuyển kho từ Kho tổng → Quán

**Đường dẫn**: `/hang-hoa/chuyen-kho` → "Tạo phiếu chuyển"

| Trường | Ví dụ |
|---|---|
| Chi nhánh nguồn | Kho Tổng (KHO01) |
| Chi nhánh đích | Quán Phố Đi Bộ (Q01) |
| Items | SKU-CFR-001 (Cà phê rang 1kg) × 5 gói |

→ Tồn Kho Tổng giảm 5 gói, tồn Q01 tăng 5 gói. Q01 có nguyên liệu để pha Bạc xỉu.

### 10.3. Sản xuất qua xưởng rang

**Đường dẫn**: `/hang-hoa/san-xuat` → "Tạo lệnh sản xuất"

| Trường | Ví dụ |
|---|---|
| SKU đầu ra | "Cà phê rang Robusta 1kg" (SKU-CFR-001) |
| BOM | Tự load BOM của SKU |
| Số lượng | 50 gói (= 50kg cà phê rang) |
| Chi nhánh SX | Xưởng rang Bình Dương (XUONG01) |
| Chi nhánh nguồn NVL | Kho Tổng (KHO01) |

→ Hệ thống tự trừ: 52.5kg cà phê sống (50 × 1.05) khỏi Kho Tổng. Sau khi hoàn thành → cộng 50 gói cà phê rang vào Xưởng rang.

### 10.4. Bán hàng FnB

**Đường dẫn**: POS FnB `fnb.onebiz.com.vn` → mở quán → bán

Quy trình tự động:
1. Nhân viên chọn "Bạc xỉu" × 1 → click "Thanh toán"
2. Server tự lookup BOM "Bạc xỉu" cho chi nhánh hiện tại
3. Trừ NVL: 18.9g cà phê rang + 81.6ml sữa + 10g đường khỏi tồn Q01
4. Toast hiện tiêu hao NVL: *"Đã trừ NVL theo BOM — Cà phê rang: 18.9g, Sữa tươi: 81.6ml, Đường: 10g"*
5. Báo cáo `/phan-tich/tieu-hao-nvl` ghi nhận

---

## Quy tắc đặt mã hàng

### Format chuẩn

```
{LOẠI}-{NHÓM}-{SỐ_THỨ_TỰ}
```

| Format | Ví dụ | Giải thích |
|---|---|---|
| `NVL-CPH-001` | Cà phê hạt sống Robusta | NVL nhóm CPH số 001 |
| `SKU-CFS-001` | Bạc xỉu | SKU nhóm CFS số 001 |
| `SKU-CFR-001` | Cà phê rang 1kg | SKU nhóm CFR số 001 |
| `NCC-001` | Cà phê Đắk Lắk | NCC số 001 |

### ⚠️ Quy tắc

- **Tự sinh khi tạo SP** — không nhập tay (tránh trùng).
- Mã nhóm 3-4 ký tự, viết hoa, không dấu.
- Số thứ tự 3 chữ số có padding (`001`, `002`, ..., `999`).
- Sau khi tạo → **không nên đổi mã** (vì hoá đơn / báo cáo cũ đã ghi mã đó).

---

## Checklist hoàn chỉnh

In ra cho nhân viên nhập liệu — tick từng item:

### Setup ban đầu (làm 1 lần)

- [ ] Khai báo 5 chi nhánh (1 kho + 1 xưởng + 3 quán) với đúng `branchType`
- [ ] Khai báo tất cả nhóm hàng cấp 1 (NVL: CPH/SUA/BOT/TPV/SYR/BBI/VPP/DCV/DCU; SKU: CFR/CFS/TRA/NHA/BAN/CMB)
- [ ] Khai báo ĐVT chuẩn (kg/g/lít/ml/ly/cái/hộp/chai/thùng/bao/gói/cuộn)
- [ ] Tạo danh sách NCC (ít nhất NCC chính cho từng nhóm NVL)

### Nhập NVL (cho từng NVL)

- [ ] Chọn đúng nhóm (mã nhóm tự gen mã NVL)
- [ ] Nhập tên đầy đủ + đặc điểm kỹ thuật (vd: "Robusta S18 60kg/bao")
- [ ] Chọn ĐVT mua + ĐVT kho khác nhau (vd: bao + kg)
- [ ] Khai báo giá vốn theo ĐVT kho
- [ ] Vào tab "Quy đổi ĐVT" → khai báo `1 ĐVT_mua = X ĐVT_kho`
- [ ] Set tồn tối thiểu để cảnh báo

### Nhập SKU (cho từng SKU bán)

- [ ] Chọn đúng nhóm + kênh bán (fnb/retail/all)
- [ ] Chỉ 1 ĐVT bán (vd: ly, gói, cái)
- [ ] **Bật `has_bom`** nếu SKU cần BOM (đồ uống pha chế, hàng đóng gói lại)
- [ ] Nhập giá bán
- [ ] (Sau khi tạo BOM) verify giá vốn auto-calc đúng

### Tạo BOM (cho mỗi SKU has_bom=true)

- [ ] SKU đầu ra đúng + đặt tên BOM rõ ràng
- [ ] Chọn áp dụng "Tất cả chi nhánh" (mặc định) hoặc riêng từng quán
- [ ] Thêm tất cả NVL với số lượng chính xác theo công thức thực tế
- [ ] Khai báo hao hụt % nếu có
- [ ] Sau lưu → verify giá vốn calculate ra số hợp lý

### Nhập tồn đầu kỳ

- [ ] Tạo phiếu nhập kho NVL từ NCC (Kho Tổng)
- [ ] Chuyển kho NVL/SKU sang các quán (số lượng đủ cho ~1 tuần kinh doanh)
- [ ] Kiểm kê tồn ban đầu khớp với thực tế

### Test trước khi GO-LIVE

- [ ] Bán thử 1 ly đồ uống trên POS FnB → toast hiện NVL bị trừ
- [ ] Vào `/phan-tich/tieu-hao-nvl` → thấy giao dịch
- [ ] Vào `/phan-tich/cogs-theo-bom` → thấy COGS thực
- [ ] So sánh COGS thực với giá bán → margin có hợp lý không?

---

## Lỗi thường gặp

### 1. "SKU bán không trừ NVL"

**Nguyên nhân**: SKU có `has_bom = false` HOẶC chưa setup BOM.

**Cách fix**:
1. Vào `/hang-hoa` → tab "Hàng bán" → tìm SKU
2. Nếu thấy badge vàng "Chưa setup" → vào `/hang-hoa/cong-thuc` tạo BOM
3. Nếu không có badge và `has_bom=false` → sửa SKU bật `has_bom=true` rồi tạo BOM

### 2. "Tồn kho âm sau khi bán"

**Nguyên nhân**: Bán SKU có BOM mà NVL không đủ tồn → mặc định setting `allow_negative_stock = true` cho phép âm.

**Cách fix**:
- Nếu muốn chặn: vào `/cai-dat/kho-hang` → tắt "Cho phép bán khi NVL không đủ tồn"
- Hoặc nhập bổ sung NVL qua phiếu nhập / chuyển kho

### 3. "Báo cáo COGS không khớp số tiền thực tế"

**Nguyên nhân**: Cost_price NVL không cập nhật theo giá nhập mới nhất.

**Cách fix**:
- Vào từng NVL → cập nhật "Giá vốn" theo giá nhập gần nhất
- Hoặc dùng phương pháp FIFO/average — config trong `/cai-dat/kho-hang` (tương lai)

### 4. "BOM tự trừ NVL ở chi nhánh khác (không phải quán đang bán)"

**Không xảy ra** — hệ thống luôn trừ NVL ở `branch_id` của invoice. Nếu thấy lạ, check:
- POS có đang ở đúng chi nhánh không? (header trên cùng hiển thị tên chi nhánh)
- BOM có branch-specific không? Có thể BOM Q2 reference NVL khác BOM global.

### 5. "Tạo SP báo lỗi: mã đã tồn tại"

**Nguyên nhân**: Trùng `tenant_id + code`.

**Cách fix**:
- Để hệ thống tự sinh mã (không nhập tay)
- Nếu nhập tay → check `/hang-hoa` search mã đó xem có tồn tại không

---

## Tóm tắt — 5 nguyên tắc vàng

1. **Luôn phân biệt NVL vs SKU**. NVL = đầu vào. SKU = bán cho khách (có BOM nếu pha chế / đóng gói lại).
2. **Setup chi nhánh + nhóm + ĐVT TRƯỚC khi nhập SP**.
3. **SKU có pha chế / đóng gói → BẬT `has_bom` + tạo BOM ngay**. Đừng để badge vàng "Chưa setup" tồn tại.
4. **BOM mặc định global** (3 quán dùng chung). Chỉ tạo BOM riêng quán khi công thức thực sự khác.
5. **Mã hàng để hệ thống tự sinh** — đừng nhập tay tránh trùng.

---

*Tài liệu này sẽ được cập nhật theo các sprint tiếp theo. Có thắc mắc về quy trình → liên hệ kế toán hoặc CEO.*
