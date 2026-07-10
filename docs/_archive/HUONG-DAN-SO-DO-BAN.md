# 🗺️ Hướng dẫn Sơ đồ bàn

**Phiên bản**: 04/06/2026 — Sprint 5 (Floor Plan Editor A+B+C).

---

## 📍 Có 2 nơi vào sơ đồ bàn

| Nơi | Quyền | Phạm vi |
|---|---|---|
| `/he-thong/so-do-ban` | `floor_plan.edit_global` (admin/owner) | Sửa mọi chi nhánh |
| `/cai-dat/so-do-ban` | `floor_plan.edit_branch` (quản lý) | Sửa chi nhánh đang chọn |

Cashier mở POS FnB tự thấy sơ đồ trực tiếp (chế độ xem).

---

## 🛠️ Thanh công cụ trên cùng

| Nút | Tác dụng |
|---|---|
| **Tầng** | Chọn 1–5 (Trệt / Lầu 1 / Lầu 2…) |
| **Lưới** | Snap 0 / 8 / 16 / 32 px khi kéo bàn |
| **Phủ màu** | Đổ màu mờ cho cả khu vực |
| **In** | Mở hộp thoại in trình duyệt |
| **Undo/Redo** | Ctrl+Z hoàn tác, Ctrl+Y làm lại |

---

## 📑 Tab khu vực (giữa)

- Mỗi khu vực = 1 canvas riêng (Sảnh 1, Sân vườn…).
- Nhóm theo **Tầng** tự động.
- Nút **+ Khu vực** thêm zone mới.
- Nút **🗑** (góc phải) xoá zone đang chọn.

---

## 🎨 Cột trái — Palette

### Mẫu bàn (8 loại)

```
⚪ Tròn 2 / 4 / 6
⬜ Vuông 2 / 4
▭ Dài 4 / 6
🛋 Sofa góc
```

Click 1 lần → bàn xuất hiện giữa canvas, có thể kéo.

### Đồ trang trí (8 loại)

```
🚪 Cửa     🌿 Cây cảnh   🍸 Quầy bar
🚻 Toilet  🪟 Cửa sổ     📺 Tivi
🪜 Cầu thang  ▭ Tường
```

### Ảnh nền quán

- **Tải ảnh nền** → chọn ảnh JPG/PNG.
- **Độ trong**: 0–100% (mặc định 30%).
- **Xoá ảnh nền** khi không cần.

---

## 🖱️ Thao tác trên canvas

| Hành động | Cách |
|---|---|
| Kéo bàn | Bấm giữ + kéo |
| Co dãn | Bấm bàn → kéo 8 chấm vuông |
| Xoay | Bấm bàn → kéo chấm tròn phía trên |
| Đổi tên | Bấm bàn → ô **Tên** ở palette |
| Khoá vị trí | Bấm bàn → nút **🔒 Khoá vị trí** |
| Xoá vật trang trí | Bấm vật → **Xoá vật đang chọn** |

---

## 👀 Chế độ Cashier (xem)

POS FnB tự đọc sơ đồ tuỳ chỉnh:
- Nếu **đã có khu vực** → render canvas đầy đủ, có ảnh nền, đồ trang trí.
- Nếu **chưa setup** → fallback grid bàn xếp tự động.

Cashier chỉ tap bàn để chọn — không sửa được vị trí.

---

## 🎯 4 trạng thái bàn

| Màu | Trạng thái |
|---|---|
| 🟢 Xanh lá | Trống |
| 🔵 Xanh dương | Đang phục vụ |
| 🟠 Cam | Đặt trước |
| ⚫ Xám | Đang dọn |

Realtime: thay đổi từ máy POS này → các máy khác tự cập nhật.

---

## 📥 Cần làm trước khi dùng

1. **Chạy migration 00125 + 00126** trên Supabase Dashboard.
2. Cài quyền `floor_plan.edit_global` cho admin + `floor_plan.edit_branch` cho quản lý quán.
3. (Tuỳ chọn) Chụp ảnh trên xuống của quán làm guide nền.

---

## ⌨️ Phím tắt

| Phím | Tác dụng |
|---|---|
| Ctrl + Z | Hoàn tác |
| Ctrl + Y / Ctrl + Shift + Z | Làm lại |

---

**Em viết phần này 1 trang để in dán cho nhân viên xem.**
