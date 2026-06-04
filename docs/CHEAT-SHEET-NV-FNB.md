# 📋 CHEAT SHEET — Nhập menu FnB cho OneBiz ERP

**Cho ai**: nhân viên admin / kế toán nội bộ — người được giao nhập menu vào hệ thống.
**Thời gian đọc**: 5 phút. **Thời gian làm**: 1-2 giờ cho 30 món.

---

## ⏱️ Tóm tắt 5 bước trong 30 giây

```
1. Mở file Excel mẫu        →  điền data theo cột (giữ format, thay tên)
2. Vào web /hang-hoa/nhom   →  Nhập từ Excel → chọn Sheet 2 (Nhóm FnB)
3. Vào web /hang-hoa/tuy-chon-fnb  →  Bấm "Preset FnB Việt" → có 4 nhóm modifier
4. Vào web /hang-hoa       →  Nhập từ Excel → chọn Sheet 4 (NVL), rồi Sheet 5 (Món)
5. Vào web /hang-hoa/cong-thuc  →  Nhập từ Excel → chọn Sheet 6 (BOM)
```

---

## 🎯 5 bước chi tiết — Làm theo thứ tự

### Bước 1: Tạo nhóm hàng FnB *(10 phút)*

**Mở Excel `FNB-SETUP-MASTER.xlsx`** → tab "**2. Nhóm FnB**".

- Có sẵn 10 nhóm mẫu (Cà phê pha máy, Trà sữa, Sinh tố…).
- Giữ nhóm nào hợp với menu quán, xoá nhóm thừa, thêm nhóm thiếu.
- **Đừng đổi cột "Loại"** (luôn `sku`) **và "Kênh bán"** (luôn `fnb`).

**Vào web**:
1. Login → menu **Danh mục → Sản phẩm → Nhóm hàng** (`/hang-hoa/nhom`).
2. Bấm nút **"Nhập từ Excel"** ở góc phải.
3. Chọn file `FNB-SETUP-MASTER.xlsx`.
4. Khi hỏi chọn sheet → chọn **"2. Nhóm FnB"**.
5. Hiện preview → kiểm tra không có dòng đỏ → bấm **"Lưu"**.

✅ Xong — đếm số nhóm trong list để chắc chắn import đủ.

---

### Bước 2: Tạo Modifier *(5 phút — KHÔNG dùng Excel)*

**Modifier** = tuỳ chọn của khách: Mức đường, Mức đá, Topping, Size.

**Cách nhanh nhất**:
1. Vào **Danh mục → Sản phẩm → Tuỳ chọn FnB** (`/hang-hoa/tuy-chon-fnb`).
2. Bấm nút **"Preset FnB Việt"** (góc phải).
3. Hệ thống tự tạo 4 nhóm: Mức đường (5 options), Mức đá (4 options), Topping (5 options), Size (3 options).

✅ Xong — refresh trang thấy 4 nhóm.

---

### Bước 3: Tạo NVL (nguyên liệu pha chế) *(30 phút)*

**Mở Excel → tab "4. NVL FnB"**.

- Có sẵn 15 NVL mẫu (cà phê rang, sữa, đường, syrup, trân châu, đá, ly).
- Thay theo NVL thật của quán.
- **Đừng đổi cột "Loại"** (luôn `nvl`).
- **"ĐVT"** = đơn vị NHỎ NHẤT (g, ml, bộ) — quan trọng để BOM khớp.

**Trước khi import**: Vào **Nhóm hàng** tạo các nhóm NVL nếu chưa có (mã CFE, SUA, DUO, SYR, TPV, DAC, BAO).

**Vào web**:
1. Menu **Danh mục → Sản phẩm → Danh sách sản phẩm** (`/hang-hoa`).
2. Bấm **"Nhập từ Excel"**.
3. Chọn sheet **"4. NVL FnB"**.
4. Preview → Lưu.

✅ Xong — `/hang-hoa` lọc "Loại = NVL" thấy danh sách 15 NVL.

---

### Bước 4: Tạo SKU món FnB *(30 phút)*

**Mở Excel → tab "5. SKU món"**.

- Có sẵn 10 món mẫu.
- **Thay theo menu thật**: tên món, giá bán, mã nhóm.
- Cột **"Mã BOM"** phải KHỚP với mã trong tab 6 BOM (vd `BOM-CSD-001`).
- Cột **"Giá vốn"** — nhập theo tính toán của quán (Excel KHÔNG auto tính).

**Vào web**:
1. Cùng `/hang-hoa` → **"Nhập từ Excel"**.
2. Chọn sheet **"5. SKU món"**.
3. Preview → Lưu.

✅ Xong — `/hang-hoa` lọc "Kênh = FnB" thấy 10 món.

---

### Bước 5: Khai BOM (công thức) *(60-90 phút)*

**Đây là bước quan trọng nhất** — sai BOM = sai tồn NVL.

**Mở Excel → tab "6. BOM"**.

- Mỗi món có **3-5 dòng** (mỗi NVL = 1 dòng).
- **Mã BOM lặp lại** ở mỗi dòng cùng món.
- Số lượng + ĐVT phải đúng (vd 18g cà phê).

**Cột "Scale theo modifier"** *(quan trọng)*:
- Item Đường → điền `Mức đường` → POS auto scale theo % khách chọn.
- Item Đá → điền `Mức đá` → tương tự.
- Item cà phê + sữa → để trống (không scale).

**Vào web**:
1. Menu **Sản xuất → Công thức sản xuất (BOM)** (`/hang-hoa/cong-thuc`).
2. Bấm **"Nhập từ Excel"**.
3. Chọn sheet **"6. BOM"**.
4. Preview → Lưu.

✅ Xong — `/hang-hoa/cong-thuc` thấy 10 BOM, mỗi cái có items.

---

## 🧪 Bước 6: Test 1 ly thật *(5 phút)*

1. Mở POS FnB ở quán.
2. Chọn 1 món vừa tạo (vd "Bạc xỉu nóng").
3. Chọn modifier (Mức đường 70%, Mức đá Bình thường).
4. Thanh toán giá thật (10-30k).
5. Vào **Kho → Lịch sử kho** check:
   - NVL cà phê giảm đúng số gram.
   - NVL đường giảm theo % khách chọn.
   - Tồn món Bạc xỉu KHÔNG giảm (đúng — món không giữ tồn).

✅ Đúng → setup OK. Bắt đầu bán chính thức.

---

## ❌ Lỗi thường gặp + Cách fix

| Báo lỗi | Lý do | Fix |
|---|---|---|
| **"Category không tồn tại"** | Nhóm hàng chưa tạo | Quay lại Bước 1 |
| **"Material không tồn tại"** | NVL chưa tạo | Quay lại Bước 3 |
| **"BOM code already exists"** | Mã BOM trùng | Đổi mã (thêm `-v2`) |
| **POS không hiện món** | Chưa gán `channel=fnb` | Sửa SP, đổi kênh = FnB |
| **NVL không giảm sau khi bán** | SP chưa gắn BOM | Vào SP → tab BOM → chọn mã BOM |

---

## 📞 Hỏi gì?

- Anh CEO (xem `HUONG-DAN-SETUP-FNB-CHI-TIET.md` để hiểu sâu hơn).
- Hoặc inbox Claude (Assistant).

---

**Phiên bản**: 03/06/2026 — Sprint 4. **Tổng thời gian**: 1.5-2.5 giờ. **30 món xong xuôi**.
