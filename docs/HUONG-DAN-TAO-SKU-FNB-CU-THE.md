# Hướng dẫn tạo SKU FnB — Đi cùng anh từng cú click

> Anh ơi, đây là file em viết để **ngồi cạnh anh, chỉ từng click một**. Em đã khảo sát data tenant **Xưởng Cà Phê - Kho Tổng** của anh — chỗ nào skip được vì đã có sẵn, chỗ nào phải làm, em đều ghi rõ.
>
> **Kịch bản mẫu**: Anh muốn tạo món `Cà phê sữa đá` có 2 size M+L, khách chọn Mức đường + Mức đá khi đặt. Sau khi xong, anh nhân rộng cho các món khác.

---

## 📋 Trước khi bắt đầu — Hiện trạng tenant anh

Em đã scan dữ liệu thực hôm nay:

| Mảng | Tình trạng | Việc cần làm |
|---|---|---|
| Chi nhánh đang chọn | **Xưởng Cà Phê - Kho Tổng** (góc trên bên trái) | Giữ nguyên |
| Nhóm NVL | **13 nhóm đầy đủ** (Cà phê hạt, Sữa, Bột/đường, Topping, Ly/tách, Trà, Syrup, Trái cây...) | Skip — đã đủ |
| NVL items | Đã có hàng trăm NVL trong các nhóm trên | Skip — chỉ dùng |
| Nhóm SKU FnB | **8 nhóm rỗng**: Cà phê tươi (CPT), Trà Sữa (TSU), Giải khát (GKH), Premium Coffee (PCF), Đá xay (DXA), Hồng Trà (HTR), Trà Ô Lông (TOL), Nước ép (NEP) | Skip — chỉ gán modifier |
| SKU FnB | **0 món** | ⬅️ Đây là việc anh sắp làm |
| Modifier groups | Chỉ có **"Mức ngọt"** anh tạo tay (0 options) | Tạo preset mới + xoá cũ |

**→ Anh chỉ cần làm 5 bước dưới đây. Không cần tạo NVL hay nhóm hàng mới.**

---

## 🚀 BƯỚC 1 — Tạo preset modifier *(1 lần dùng forever, ~30 giây)*

### 1.1 Mở trang

Trên thanh địa chỉ trình duyệt, gõ:

```
onebiz.com.vn/hang-hoa/tuy-chon-fnb
```

Hoặc click sidebar trái: **Danh mục → Sản phẩm → Tuỳ chọn món FnB**.

### 1.2 Trạng thái hiện tại anh sẽ thấy

```
┌─ Tuỳ chọn món FnB ─────────────────────────────────────┐
│ Quản lý nhóm tuỳ chọn (Size, Mức đường, Mức đá,...)   │
│                                                         │
│                    [✨ Tạo preset FnB Việt]            │
│                    [+ Tạo nhóm tuỳ chọn]               │
│                                                         │
│ ▸ Mức ngọt   [Chọn 1]   0 options    [Sửa]  [🗑]      │
│   Chọn 1 — tuỳ chọn (vd Mức đường)                    │
└─────────────────────────────────────────────────────────┘
```

### 1.3 Bấm "✨ Tạo preset FnB Việt"

Vị trí: **góc trên phải**, nút viền (outline), có icon ngôi sao.

➡️ Popup confirm hiện ra: *"Tạo sẵn 4 nhóm tuỳ chọn chuẩn FnB Việt..."* → bấm **OK**.

➡️ Sau ~1 giây, danh sách sẽ thành:

```
▸ Size          [Bắt buộc]   3 options    (M / L / XL)
▸ Mức đường     [Chọn 1]     5 options    (0% / 30% / 50% / 70% / 100%)
▸ Mức đá        [Chọn 1]     4 options    (Không / Ít / Vừa / Nhiều)
▸ Topping       [Chọn nhiều] 0 options    (rỗng — sẽ tự thêm khi cần)
▸ Mức ngọt      [Chọn 1]     0 options    ← cái cũ, trùng với "Mức đường"
```

### 1.4 Xoá "Mức ngọt" để tránh trùng

Trên dòng **"Mức ngọt"** → bấm icon **🗑 đỏ** (cuối dòng).

➡️ Popup confirm: *"Xoá nhóm Mức ngọt?..."* → bấm **OK**.

### ✅ Check sau bước 1

Anh phải thấy **4 nhóm**: Size · Mức đường · Mức đá · Topping. KHÔNG còn "Mức ngọt".

---

## 🏷️ BƯỚC 2 — Gán modifier vào nhóm SP FnB *(~30 giây/nhóm × 8 nhóm = ~4 phút)*

### 2.1 Mở trang Nhóm hàng

```
onebiz.com.vn/hang-hoa/nhom
```

Hoặc click sidebar: **Danh mục → Sản phẩm → Nhóm hàng**.

### 2.2 Chuyển sang tab SKU và filter FnB

- Trên header, bấm tab **"Hàng bán (SKU)"** (cạnh tab "Nguyên vật liệu (NVL)").
- Phía dưới hiện chip filter: **"Tất cả · Retail · FnB"** → bấm chip **"FnB"**.

➡️ Danh sách lọc còn **8 nhóm**: Cà phê tươi, Trà Sữa, Giải khát, Premium Coffee, Đá xay, Hồng Trà, Trà Ô Lông, Nước ép. Mỗi nhóm có cảnh báo *"0 — ẩn khỏi POS"* vì chưa có SP.

### 2.3 Sửa nhóm đầu tiên — "Cà phê tươi" (CPT)

Trên dòng **"Cà phê tươi"** → bấm icon **✏️ bút chì** (cuối dòng, trước icon thùng rác).

➡️ Popup **"Sửa nhóm hàng"** mở ra:

```
┌─ Sửa nhóm hàng ────────────────────────────┐
│ Tên nhóm: [Cà phê tươi          ]           │
│ Mã nhóm:  [CPT]   (không sửa được)          │
│                                              │
│ Kênh bán: [FnB (pha chế tại quán)] ✓        │
│                                              │
│ ⚙️ Tuỳ chọn mặc định cho nhóm               │
│ Mọi SP trong nhóm này sẽ tự thừa kế các     │
│ nhóm tuỳ chọn anh tick.                     │
│                                              │
│  ☐ Size      (3)                            │
│  ☐ Mức đường (5)                            │
│  ☐ Mức đá    (4)                            │
│  ☐ Topping   (0)                            │
│                                              │
│              [Huỷ]    [Cập nhật]            │
└──────────────────────────────────────────────┘
```

### 2.4 Tick 3 ô tuỳ chọn

- ☑ **Size** (vì cà phê có nhiều size)
- ☑ **Mức đường** (khách hay xin "ít đường")
- ☑ **Mức đá** (khách hay xin "ít đá")
- ☐ Topping (cà phê tươi thường không có topping — bỏ qua)

➡️ Cuộn xuống → bấm **"Cập nhật"**.

### 2.5 Lặp lại cho 7 nhóm còn lại

Áp dụng tương tự cho:

| Nhóm | Tick |
|---|---|
| **Trà Sữa (TSU)** | ☑ Size ☑ Mức đường ☑ Mức đá ☑ **Topping** *(trà sữa hay topping)* |
| **Giải khát (GKH)** | ☑ Size ☑ Mức đường ☑ Mức đá |
| **Premium Coffee (PCF)** | ☑ Size ☑ Mức đường ☑ Mức đá |
| **Đá xay (DXA)** | ☑ Size ☑ Mức đường ☑ Mức đá |
| **Hồng Trà (HTR)** | ☑ Size ☑ Mức đường ☑ Mức đá ☑ Topping |
| **Trà Ô Lông (TOL)** | ☑ Size ☑ Mức đường ☑ Mức đá ☑ Topping |
| **Nước ép (NEP)** | ☑ Size ☑ Mức đường ☑ Mức đá |

### ✅ Check sau bước 2

Tất cả 8 nhóm đã được gán modifier. Mỗi SP anh tạo từ bây giờ sẽ tự thừa kế — KHÔNG phải gán lại từng SP.

---

## 🧪 BƯỚC 3 — Tạo BOM (công thức) *(~3 phút/BOM)*

> Em làm ví dụ **Cà phê sữa đá size M + L** (2 BOM). BOM trong tenant em không tự tạo được vì đụng vào tồn NVL — anh tự gõ Mã NVL chính xác từ /hang-hoa của anh.

### 3.1 Mở trang Công thức

```
onebiz.com.vn/hang-hoa/cong-thuc
```

Hoặc sidebar: **Danh mục → Sản xuất → Công thức sản xuất (BOM)**.

### 3.2 Tra Mã NVL cần dùng

Trước khi tạo BOM, anh mở **tab khác**: `onebiz.com.vn/hang-hoa`. Tra trong danh sách NVL:
- Cà phê (loại anh muốn dùng): mã sẽ là `NVL-CPH-001`, `NVL-CPH-002`...
- Sữa đặc: `NVL-SUA-001` hoặc `NVL-SUA-002`.
- Đường: `NVL-BOT-001`, `NVL-BOT-002` (đường trắng / đường nâu).
- Ly nhựa size M: `NVL-LTT-...` (tra cụ thể trong nhóm Ly/tách).

Anh ghi 4 mã NVL chính xác ra giấy/notepad trước khi sang bước tiếp.

### 3.3 Tạo BOM Size M

Trở về tab **Công thức** → bấm nút **"+ Tạo công thức"** (góc trên phải, màu xanh đậm).

➡️ Dialog **"Tạo công thức (BOM)"** mở ra. Fill:

| Trường | Giá trị |
|---|---|
| Mã BOM | `BOM-CPT-001-M` |
| Tên BOM | `Cà phê sữa đá M` |
| Chi nhánh áp dụng | *(để trống = áp dụng mọi chi nhánh)* |
| Năng suất | `1` |
| ĐVT năng suất | `ly` |

Trong bảng items, bấm **"+ Thêm NVL"** lần lượt 4 NVL:

| # | Mã NVL (anh tra ở bước 3.2) | Số lượng | ĐVT | **Scale theo modifier** ⭐ |
|---|---|---|---|---|
| 1 | NVL-CPH-... (Cà phê đã rang xay) | `15` | g | *(trống)* |
| 2 | NVL-SUA-... (Sữa đặc) | `25` | ml | *(trống)* |
| 3 | **NVL-BOT-... (Đường)** | **`10`** | **g** | **chọn "Mức đường"** từ dropdown ⭐ |
| 4 | NVL-LTT-... (Ly nhựa size M) | `1` | cái | *(trống)* |

> ⭐ **CỘT QUAN TRỌNG**: Khi điền dòng NVL **Đường**, ở cột "Scale theo modifier" → dropdown sẽ hiện 3 lựa chọn (Size · Mức đường · Mức đá). Anh chọn **"Mức đường"**. Đây là KEY của tính năng scale BOM.

Bấm **"Lưu"**.

### 3.4 Tạo BOM Size L (lặp lại bước 3.3)

Mã BOM: `BOM-CPT-001-L`. Liều lượng tăng:

| # | Mã NVL | Số lượng | ĐVT | Scale |
|---|---|---|---|---|
| 1 | NVL-CPH-... | `20` | g | (trống) |
| 2 | NVL-SUA-... | `40` | ml | (trống) |
| 3 | **NVL-BOT-...** | **`15`** | **g** | **Mức đường** |
| 4 | NVL-LTT-... (Ly size L) | `1` | cái | (trống) |

### ✅ Check sau bước 3

Vào trang `/hang-hoa/cong-thuc`, anh thấy **2 BOM mới**: `BOM-CPT-001-M` và `BOM-CPT-001-L`. Cả 2 đều có 1 item NVL Đường có cờ "Scale theo Mức đường".

---

## ☕ BƯỚC 4 — Tạo SP "Cà phê sữa đá" *(~3 phút)*

### 4.1 Mở trang Hàng hoá

```
onebiz.com.vn/hang-hoa
```

Sidebar: **Danh mục → Sản phẩm → Danh sách sản phẩm**.

### 4.2 Bấm "+ Tạo mới"

Vị trí: **góc trên phải**, nút xanh đậm.

➡️ Popup **"Thêm hàng hoá mới"** mở ra. Mặc định ở tab **"Nguyên vật liệu (NVL)"**.

### 4.3 Switch sang SKU

Phía trên popup có 2 tab lớn:
- Nguyên vật liệu (NVL)
- **Hàng bán (SKU)** ← bấm tab này

➡️ Sau khi switch, dưới sẽ hiện 4 tab nhỏ: **Thông tin · Giá & Tồn kho · Tuỳ chọn FnB · Quy cách**.

### 4.4 Tab "Thông tin"

Em fill bảng:

| Trường | Giá trị | Lưu ý |
|---|---|---|
| Ảnh | *(bỏ qua hoặc upload sau)* | Không bắt buộc |
| Tên hàng | `Cà phê sữa đá` | |
| **Nhóm hàng** ⭐ | Bấm dropdown → chọn **"Cà phê tươi"** (CPT) | Quan trọng — gán đúng nhóm để thừa kế modifier |
| Mã vạch | *(bỏ qua)* | |
| Thương hiệu | `Quán mình` *(hoặc trống)* | |
| Nhà cung cấp | *(bỏ qua — pha chế tại quán)* | |
| **Kênh bán** ⭐ | **fnb** (đã chọn sẵn nhờ nhóm là FnB) | Verify thấy "Chỉ hiện trên POS FnB của quán" |
| Đơn vị tính | `ly` | Gõ vào ô, nếu đã có sẽ gợi ý |
| Mô tả | *(bỏ qua)* | |

➡️ Ngay dưới nhóm hàng, anh sẽ thấy **mã SP gợi ý**: vd `SKU-CPT-001`. Đây là mã auto-gen — không sửa.

### 4.5 Tab "Giá & Tồn kho"

Bấm sang tab này (cạnh "Thông tin").

| Trường | Giá trị |
|---|---|
| Giá bán | `25000` *(giá size M mặc định)* |
| Giá vốn | **để trống** *(POS tự tính từ BOM)* |
| Tồn kho ban đầu | `0` *(SP có BOM = không lưu tồn, chỉ trừ NVL)* |
| Tồn tối thiểu | `0` |
| VAT | `0` *(thường FnB Việt không xuất hoá đơn VAT)* |

### 4.6 Tab "Tuỳ chọn FnB"

Bấm sang tab này.

Anh sẽ thấy:

```
🌳 Thừa kế từ nhóm hàng
   Các nhóm tuỳ chọn đã gán cho nhóm hàng chứa SP này.
   ✓ Size       (3)
   ✓ Mức đường  (5)
   ✓ Mức đá     (4)

⚙️ Tuỳ chọn riêng cho SP này
   Mặc định SP dùng tuỳ chọn của nhóm.
   [● Thừa kế từ nhóm]  [○ Override riêng]
```

✅ **Không cần làm gì** — chế độ "Thừa kế từ nhóm" đã đúng. SP `Cà phê sữa đá` sẽ tự có 3 modifier khi vào POS.

> *Chỉ bật "Override riêng" khi SP này khác biệt với nhóm — vd món "Cold Brew" không cho chọn Mức đá. Ví dụ Cà phê sữa đá thông thường → để mặc định.*

### 4.7 Tab "Quy cách" ⭐ (quan trọng nhất)

Bấm sang tab này. Anh sẽ thấy **empty state**:

```
📏 Chưa có quy cách nào. SP sẽ bán với 1 giá duy nhất.
Vd: Size M/L/XL (FnB) hoặc 250g/500g/1kg (Retail).
              [+ Thêm quy cách]
```

Bấm **"+ Thêm quy cách"** → 1 row trống xuất hiện.

Fill row 1 (Size M):

| Tên | Giá bán | Giá vốn | **Mã BOM riêng** | Mặc định |
|---|---|---|---|---|
| `M` | `25000` | *(trống)* | `BOM-CPT-001-M` | ⦿ (auto) |

Bấm **"+ Thêm quy cách"** lần nữa → row 2 (Size L):

| Tên | Giá bán | Giá vốn | Mã BOM riêng | Mặc định |
|---|---|---|---|---|
| `L` | `30000` | *(trống)* | `BOM-CPT-001-L` | ○ |

### 4.8 Bấm "Lưu"

Nút **Lưu** ở góc dưới phải popup. Đợi ~1 giây.

➡️ Toast hiện: *"Đã thêm hàng hoá mới"* hoặc tương tự.

➡️ Popup tự đóng. SP `Cà phê sữa đá` xuất hiện trong danh sách `/hang-hoa` tab "Hàng bán".

### ✅ Check sau bước 4

Vào lại `/hang-hoa` tab "Hàng bán" → search `Cà phê sữa đá` → thấy SP có:
- Mã: SKU-CPT-001 (hoặc 002 nếu đã có 1 cái).
- Cột "Kênh bán": FnB.
- Cột "Có BOM": ✓ Có BOM.

---

## 🛒 BƯỚC 5 — Bán thử trên POS *(~30 giây verify)*

### 5.1 Mở POS

Vào: `onebiz.com.vn/pos` → POS FnB.

### 5.2 Tap món

Trong menu grid, tab nhóm **"Cà phê tươi"** → tap **"Cà phê sữa đá"**.

➡️ Dialog mở ra với các phần:

```
┌─ Cà phê sữa đá ──────────────────┐
│ Giá: 25,000đ                      │
│                                    │
│ Kích cỡ:                          │
│   [● M 25,000đ]  [○ L 30,000đ]   │
│                                    │
│ Số lượng:  [-]  1  [+]            │
│                                    │
│ Mức đường  [Chọn 1]               │
│  [Không] [30%] [50%] [●70%] [100%]│
│                                    │
│ Mức đá  [Chọn 1]                  │
│  [Không] [Ít] [●Vừa] [Nhiều]      │
│                                    │
│ Ghi chú: [________________]       │
│                                    │
│         [Thêm vào đơn — 25,000đ]  │
└────────────────────────────────────┘
```

### 5.3 Test scenario

Anh chọn:
- Kích cỡ: **L** (giá tự update → 30,000đ).
- Mức đường: **100%** (giữ).
- Mức đá: **Ít đá**.

➡️ Bấm **"Thêm vào đơn"** → SP xuất hiện trong cart phải.

➡️ Bấm **"Gửi bếp"** → KDS hiện món với dòng: `▸ Mức đường: 100% · Mức đá: Ít đá` (tone xanh).

➡️ Bấm **"Thanh toán"** → chọn tiền mặt → trả `30,000đ`.

### 5.4 Verify tồn NVL trừ đúng

Mở tab khác: `onebiz.com.vn/kho` → search NVL Đường.

Trước bán: vd có `1000g`.
Sau bán: phải có `985g` (= 1000 − 15g BOM L × 1.0 scale 100%).

> 💡 **Test scale**: bán thêm 1 ly **Cà phê sữa đá L** với **30% đường** → tồn Đường giảm tiếp `15g × 0.3 = 4.5g` → còn `980.5g`.

### ✅ Check sau bước 5 — DONE 🎉

- POS hiển thị đúng modifier.
- Cashier chọn size → giá update.
- Cashier chọn modifier → BOM scale.
- Tồn NVL trừ chính xác.

→ **Anh đã setup 1 món FnB hoàn chỉnh.** Nhân rộng cho các món còn lại.

---

## 🔁 Nhân rộng cho nhiều món

Với cùng pattern, anh tạo các món:

| Món | Nhóm | BOM | Giá M | Giá L |
|---|---|---|---|---|
| Cà phê sữa đá | CPT | BOM-CPT-001-M/L | 25k | 30k |
| Cà phê đen đá | CPT | BOM-CPT-002-M/L | 22k | 27k |
| Bạc xỉu | CPT | BOM-CPT-003-M/L | 28k | 33k |
| Trà sữa truyền thống | TSU | BOM-TSU-001-M/L | 35k | 40k |
| Trà sữa trân châu | TSU | BOM-TSU-002-M/L *(có Topping)* | 42k | 47k |
| ... | ... | ... | ... | ... |

> 💡 **Khi menu nhiều (30+ món)**: dùng **Excel bulk import** ở `/hang-hoa/cong-thuc` → "Tải mẫu" → fill nhiều BOM cùng lúc → "Nhập Excel". Tương tự `/hang-hoa` cho SKU.

---

## 🛠️ Khi gặp vấn đề

### POS không thấy món
→ Check nhóm SP có ít nhất 1 SP. Nhóm rỗng = auto ẩn khỏi POS.

### Tap món nhưng không thấy Mức đường/Mức đá
→ Vào `/hang-hoa/nhom` → sửa nhóm SP đó → tick lại modifier groups → Lưu. Refresh POS (Ctrl+F5).

### Bán xong nhưng tồn NVL không trừ
→ Check SP có `Có BOM` (tick toggle trong form) và Mã BOM đúng. Vào sửa SP → tab Công thức → verify Mã BOM hiện ô input.

### Đường trừ cố định không scale theo %
→ BOM item NVL Đường chưa gán `Scale theo modifier`. Sửa BOM ở `/hang-hoa/cong-thuc` → cột "Scale theo modifier" của row Đường → chọn "Mức đường" → Lưu.

### "Mã NVL không tồn tại" khi tạo BOM
→ Mã anh gõ sai. Vào `/hang-hoa` tab NVL → search → copy mã chính xác.

### "Mã BOM đã tồn tại"
→ Đổi cuối mã (M → M2 hoặc 001 → 002).

---

## 📚 Tài liệu liên quan

- `HUONG-DAN-SETUP-FNB.md` — Hướng dẫn tổng quan từ 0 (nếu setup tenant mới).
- `HUONG-DAN-NVL-SKU-BOM.md` — Mô hình kỹ thuật NVL/SKU/BOM/Variant/Modifier.
- `/hang-hoa/tuy-chon-fnb` — Trang quản lý modifier.
- `/hang-hoa/cong-thuc` — Trang quản lý BOM.
- `/phan-tich/fnb-modifier` — Báo cáo lựa chọn của khách.

---

**Phiên bản**: 03/06/2026 — dựa data thực tenant **Xưởng Cà Phê - Kho Tổng**.
**Tổng thời gian setup 1 món có 2 size + 3 modifier**: **~14 phút**.
**Cho menu 30 món**: **~3-4 giờ**. Sau đó POS chạy production.

---

# 📌 BỔ SUNG 03/06/2026 — Pattern "Trung tâm phân phối" (Central Commissary)

Phần này bổ sung sau khi CEO chốt rõ mô hình kinh doanh chuỗi cà phê đa chi nhánh. **Đọc nếu anh có ≥2 chi nhánh** (Kho tổng + ≥1 Quán).

## 🧭 Mô hình anh đang dùng

```
KHO TỔNG (Retail)                     QUÁN FNB (Outlet)
─────────────────                     ─────────────────
NVL gốc (hạt sống, sữa NVL...)        SKU đóng gói (đã nhập từ Kho tổng)
       ↓                                     ↓
SKU đóng gói (Cà phê rang 1kg,        SKU món pha chế (Bạc xỉu, Cà phê sữa)
              Sữa lon, gói bột...)            ↓ BOM tham chiếu SKU đóng gói
       ↓                              POS FnB bán món → trừ SKU đóng gói
POS Retail (bán khách ngoài) ─┐
       ↓                       │
   Cascade BOM → trừ NVL  ← Kho tổng quản lý tồn ở NVL gốc, SKU chỉ là "nhãn bán"
       
Internal Sale Kho tổng → Quán:
   • Chuyển 5 lon SKU-SUA-001
   • Leg-OUT Kho tổng: cascade BOM → trừ 5 lon NVL-SUA-001 ✅
   • Leg-IN Quán A:    +5 lon SKU-SUA-001 tồn Quán
```

## ⚙️ Setup chế độ tồn kho (CỰC QUAN TRỌNG)

Sau khi apply migration 00123, vào `/cai-dat/chi-nhanh` chỉnh **Chế độ tồn kho** cho mỗi chi nhánh:

| Loại chi nhánh | Chế độ tồn kho | Hành vi khi bán SKU |
|---|---|---|
| 🏭 Kho tổng / Xưởng rang | **Kho/Xưởng sản xuất** | Cascade BOM → trừ NVL gốc theo công thức |
| 🏪 Quán cà phê / Cửa hàng | **Quán/Outlet** | Trừ tồn SKU trực tiếp (đã nhập từ Kho tổng) |

> ⚠️ **Auto-migrate**: Migration 00123 tự set `production` cho `warehouse` + `factory`, `outlet` cho `store` + `office`. Anh chỉ cần verify hoặc override nếu sai.

## 📦 3 loại SKU Retail — setup khác nhau

### Loại 1 — Production SKU *(chế biến thực sự)*
**Vd**: Cà phê hạt sống → rang xay đóng gói.
- **2 mã**: `NVL-CPH-001` "Hạt sống" + `SKU-CPH-001` "Rang xay 1kg".
- SKU `has_bom=false`, có tồn riêng.
- Mỗi đợt rang: Xuất NVL + Nhập SKU (2 phiếu).

### Loại 2 — Repackaging SKU *(đóng gói lại từ NVL)*
**Vd**: Sữa đặc Ông Thọ — 1 thùng = 24 lon, bán theo lon/thùng/pack.
- **1 NVL + nhiều SKU**: `NVL-SUA-001` + `SKU-SUA-001` (1 lon) + `SKU-SUA-002` (thùng 24).
- SKU `has_bom=true`, BOM: 1 SKU = X lon NVL.
- POS Retail tại Kho tổng: cascade BOM → trừ NVL ✅
- POS Retail tại Quán (takeaway): trừ tồn SKU trực tiếp ✅
- Internal Sale Kho → Quán: leg-OUT cascade BOM, leg-IN tăng tồn SKU ✅

### Loại 3 — Trade-only SKU *(mua nguyên bán nguyên)*
**Vd**: Nước Lavie chai, snack, mì gói — NCC giao sẵn đóng gói, không chế biến.
- **1 mã**: `SKU-XXX-001` `has_bom=false`, có tồn riêng.
- POS Retail bán → trừ tồn SKU.

## 📊 G3 — Khả dụng theo BOM trên POS Retail

POS Retail tại Kho tổng (cascade_mode=production) bây giờ hiển thị:

```
┌─ Card SKU "Sữa đặc 1 lon" ──────┐
│  💰 35,000đ                     │
│  ≈ 240  ← tính từ NVL "Sữa đặc"  │
└─────────────────────────────────┘
```

→ Cashier thấy ngay có thể bán được bao nhiêu, mặc dù `branch_stock(SKU) = 0`.

Hover/title trên tile: *"Khả dụng tính từ NVL 'Sữa đặc Ông Thọ'"*.

## 🔧 Fix bug G1 — Internal Sale cascade BOM

**Trước**: chuyển 5 lon `SKU-SUA-001` cho Quán → tồn NVL Kho tổng KHÔNG giảm (số lệch).
**Sau migration 00123**: leg-OUT tự cascade BOM → trừ NVL gốc đúng.

## 🎯 Checklist sau khi apply migration 00123

- [ ] Vào `/cai-dat/chi-nhanh` — kiểm tra cột "Chế độ tồn kho" đã đúng:
  - Kho tổng = 🏭 Sản xuất
  - Quán FnB = 🏪 Outlet
- [ ] Test POS Retail tại Kho tổng: SKU `has_bom=true` hiện badge "≈ X" (số khả dụng).
- [ ] Test Internal Sale Kho → Quán: số NVL Kho tổng giảm đúng theo BOM × số lượng.
- [ ] Test POS FnB tại Quán bán Bạc xỉu: trừ SKU đóng gói thành phần (cần BOM branch-specific).
- [ ] Test POS FnB tại Quán bán takeaway (vd 1 lon sữa): trừ tồn SKU trực tiếp, không cascade.

## ❓ Nếu sai số liệu

| Triệu chứng | Nguyên nhân | Cách fix |
|---|---|---|
| Bán SKU đóng gói tại Kho tổng mà NVL không giảm | Branch `cascade_mode='outlet'` sai | Vào `/cai-dat/chi-nhanh` chỉnh sang `production` |
| Bán món Bạc xỉu tại Quán mà tồn SKU sữa không giảm | BOM Bạc xỉu chỉ ở `branch_id=NULL` (global) | Tạo BOM Bạc xỉu riêng cho branch_id Quán đó |
| Quán bán SKU đóng gói (takeaway) báo "NVL hết hàng" | Branch `cascade_mode='production'` sai | Vào `/cai-dat/chi-nhanh` chỉnh sang `outlet` |

