# 🗺️ Hướng dẫn Sơ đồ bàn — OneBiz ERP

> **Phiên bản 2** · 09/06/2026 · Cập nhật toàn bộ feature Sprint 5 (Floor Plan A+B+C) + Đợt 1-3 polish design + Action sheet POS.
>
> **Đối tượng**: CEO + Quản lý quán FnB
> **Thời gian setup 1 quán** (20-30 bàn): **~30 phút** lần đầu.
> **Dùng được trên**: Web admin + iPad + máy POS + điện thoại (chế độ xem).

---

## 🎯 Tổng quan — Sơ đồ bàn để làm gì?

```
┌─────────────────────────────────────────┐
│   ADMIN / QUẢN LÝ — Setup 1 lần         │
│                                         │
│   • Vẽ layout quán (tầng, khu vực)      │
│   • Đặt bàn lên đúng vị trí thật        │
│   • Thêm cây cảnh, tường, cửa, quầy bar │
│   • (Tuỳ chọn) tải ảnh nền chụp quán    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   CASHIER / NHÂN VIÊN — Dùng hàng ngày  │
│                                         │
│   • Mở POS FnB → tab "Sơ đồ bàn"        │
│   • Tap bàn → action sheet:             │
│     ├ Mở đơn mới                        │
│     ├ Xem đơn đang phục vụ              │
│     ├ Gộp với bàn khác                  │
│     └ Chuyển sang bàn khác              │
│   • Màu bàn realtime theo trạng thái    │
└─────────────────────────────────────────┘
```

→ **Lợi ích**: Cashier nhìn 1 cái biết bàn nào trống / có khách / đang dọn → chọn nhanh, giảm sai sót.

---

## 📍 1 trang duy nhất — phân quyền bên trong

| URL | Quyền cần |
|---|---|
| **`/he-thong/so-do-ban`** | Tự động ẩn nút **Sửa** nếu user không có quyền |
| `floor_plan.edit_global` | Sửa mọi chi nhánh (admin/owner) |
| `floor_plan.edit_branch` | Sửa chỉ chi nhánh đang chọn (quản lý quán) |
| Không có 2 quyền trên | **Chỉ xem** (cashier) |

> 💡 **Sprint 5 update**: Đã gộp 2 trang cũ (`/he-thong/so-do-ban` và `/cai-dat/so-do-ban`) thành 1. Hệ thống tự nhận quyền user → cho phép sửa hoặc chỉ xem.

---

# 📐 PHẦN 1 — DÀNH CHO ADMIN/QUẢN LÝ (Setup)

## 🧭 Layout trang chỉnh sửa

```
┌─────────────────────────────────────────────────────────────┐
│  Thanh công cụ trên cùng                                    │
│  [Tầng ▼] [Lưới: 0/8/16/32 px] [Phủ màu] [Undo] [Redo] [In] │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ PALETTE  │              CANVAS                              │
│ (trái)   │              (vẽ ở đây)                          │
│          │                                                  │
│ • Bàn    │  ┌──────────────────────────┐                    │
│   8 mẫu  │  │ Tab khu vực: Sảnh 1, ... │                    │
│          │  ├──────────────────────────┤                    │
│ • Đồ TT  │  │                          │                    │
│   8 mẫu  │  │                          │                    │
│          │  │   (kéo bàn vào đây)      │                    │
│ • Ảnh    │  │                          │                    │
│   nền    │  │                          │                    │
│          │  └──────────────────────────┘                    │
└──────────┴──────────────────────────────────────────────────┘
```

---

## 📌 BƯỚC 1 — Tạo Tầng và Khu vực

### 1.1 Chọn Tầng

- Bấm dropdown **Tầng** trên thanh công cụ.
- Hệ thống hỗ trợ **5 tầng** (Trệt / Lầu 1 / Lầu 2 / Lầu 3 / Sân thượng).
- Mỗi tầng có sơ đồ riêng + ảnh nền riêng.

### 1.2 Thêm Khu vực (Zone)

- Bấm **+ Khu vực** (giữa màn hình).
- Đặt tên (vd "Sảnh 1", "Sân vườn", "Phòng VIP").
- Mỗi khu vực = 1 canvas riêng.
- Một tầng có thể có nhiều khu vực.

> 🆕 **Đợt 1.10**: ZoneLabel chip ở góc canvas hiện tên khu vực + tầng + số bàn → cashier biết đang xem khu nào.

---

## 📌 BƯỚC 2 — Đặt Bàn lên canvas

### Palette Bàn — 8 mẫu chuẩn ngành

| Loại | Kích thước | Dùng cho |
|---|:---:|---|
| ⚪ Tròn 2 ghế | 60cm | Cặp đôi, cà phê |
| ⚪ Tròn 4 ghế | 80cm | Nhóm bạn vừa |
| ⚪ Tròn 6 ghế | 100cm | Gia đình |
| ⬜ Vuông 2 ghế | 60×60 | Cạnh tường |
| ⬜ Vuông 4 ghế | 80×80 | Phổ thông |
| ▭ Dài 4 ghế | 120×60 | Tiệc nhỏ |
| ▭ Dài 6 ghế | 180×60 | Tiệc trung |
| 🛋 Sofa góc L | 200×200 | VIP, trang trí |

→ Click 1 lần vào mẫu → bàn xuất hiện giữa canvas → kéo đến vị trí thật.

> 🆕 **Đợt 1.4**: Sofa góc L-shape vẽ đúng hình thật (không vuông như trước).
> 🆕 **Đợt 1.6**: Bàn tròn chuẩn 60/80/100cm theo chuẩn ngành.

### Đặt tên bàn

- Bấm chọn bàn → ô **Tên bàn** ở palette trái.
- Đặt theo quy ước riêng (vd "A1", "B-Sảnh-3", "VIP-1").
- Tên hiện ngay trên bàn ở canvas.

> 🆕 **Đợt 1.5**: Font tự co dãn theo size bàn → đọc rõ ở mọi kích thước. Bỏ text "X ghế" thừa.

---

## 📌 BƯỚC 3 — Thêm Đồ trang trí

### Palette Đồ trang trí — 8 loại

| Icon | Loại | Dùng cho |
|:---:|---|---|
| 🚪 | Cửa | Cửa chính, cửa phụ |
| 🌿 | Cây cảnh | Trang trí góc |
| 🍸 | Quầy bar | Quầy thanh toán/pha chế |
| 🚻 | Toilet | WC nam/nữ |
| 🪟 | Cửa sổ | Cạnh tường ngoài |
| 📺 | Tivi | TV, màn hình |
| 🪜 | Cầu thang | Đi lên lầu |
| ▭ | Tường | Chia khu vực |

→ Click 1 lần → drag-drop vào vị trí.

> 🆕 **Đợt 1.3**: Cây cảnh hiện icon lá thực (không phải chấm tròn xấu).

---

## 📌 BƯỚC 4 — (Tuỳ chọn) Tải ảnh nền quán

### Lợi ích
- Chụp ảnh layout thật của quán → quản lý đối chiếu chính xác.
- Nhân viên mới onboarding nhìn ảnh + sơ đồ → hiểu nhanh.

### Cách làm
1. Bấm **Tải ảnh nền** ở palette trái.
2. Chọn file JPG/PNG (chụp trên xuống hoặc bản vẽ).
3. **Độ trong**: kéo slider 0-100% (mặc định 30%).
4. **Xoá ảnh nền** khi không cần.

---

## 🛠️ Thao tác trên Canvas

| Hành động | Cách làm |
|---|---|
| **Di chuyển** bàn / đồ TT | Bấm giữ + kéo |
| **Co dãn** kích thước | Bấm chọn → kéo 8 chấm vuông quanh |
| **Xoay** góc | Bấm chọn → kéo chấm tròn phía trên |
| **Đổi tên** | Bấm bàn → ô Tên ở palette trái |
| **Khoá vị trí** 🔒 | Bấm bàn → nút Khoá → không kéo được nữa |
| **Phủ màu khu vực** | Thanh công cụ → bấm "Phủ màu" → chọn màu |
| **Xoá** | Bấm chọn → nút Xoá hoặc phím Delete |
| **Hoàn tác** | Ctrl + Z |
| **Làm lại** | Ctrl + Y hoặc Ctrl + Shift + Z |

### Lưới snap (Grid)

| Lưới | Khi nào dùng |
|:---:|---|
| 0 (off) | Tự do, kéo mượt |
| 8 px | Cần thẳng hàng nhẹ |
| 16 px | **Mặc định khuyến nghị** — đẹp + dễ chỉnh |
| 32 px | Đặt thẳng hàng chuẩn lớn |

---

# 📱 PHẦN 2 — DÀNH CHO CASHIER/NV (Sử dụng hàng ngày)

## 👀 Mở Sơ đồ bàn trên POS FnB

1. Mở POS FnB (URL `fnb.onebiz.com.vn`)
2. Bấm tab **Sơ đồ bàn** trên thanh ngang
3. Hệ thống tự render layout:
   - ✅ Nếu **đã setup**: hiện canvas với bàn, cây, tường, ảnh nền
   - ⚠️ Nếu **chưa setup**: hiện grid bàn xếp tự động (fallback)

---

## 🎨 4 màu trạng thái bàn (xem nhanh)

| Màu | Trạng thái | Ý nghĩa |
|:---:|---|---|
| ⬜ Viền chỉ | **Trống** | Bàn sẵn sàng mở đơn |
| 🔵 Xanh dương | **Đang phục vụ** | Khách đang ngồi, đã có đơn |
| 🟠 Cam | **Đặt trước** | Đã book, chờ khách đến |
| ⚫ Xám đậm | **Đang dọn** | Khách vừa về, nhân viên dọn |

> 🆕 **Đợt 1.9**: Bàn trống KHÔNG tô fill (chỉ viền) → dễ phân biệt với bàn đang phục vụ.

### 🔔 Badge số phiếu chưa thanh toán

Bàn có ≥1 phiếu chưa thanh toán → góc bàn hiện **badge số đỏ** (vd "2" = 2 phiếu).

> 🆕 **Đợt 2.1**: Cashier biết ngay bàn nào còn nợ → nhắc khách thanh toán trước khi về.

---

## 👆 Tap bàn — Action Sheet hiện ngay (4 lựa chọn)

Khi tap (hoặc click) vào 1 bàn, popup hiện 4 nút:

```
┌─────────────────────────────────────────┐
│   Bàn A1 — Sảnh 1 — Trệt                │
│                                         │
│   ┌───────────────────────────────────┐ │
│   │  ➕  Mở đơn mới                  │ │  ← Bàn trống
│   └───────────────────────────────────┘ │
│   ┌───────────────────────────────────┐ │
│   │  📋  Xem đơn đang phục vụ        │ │  ← Bàn có khách
│   └───────────────────────────────────┘ │
│   ┌───────────────────────────────────┐ │
│   │  🔗  Gộp với bàn khác            │ │  ← Khách dồn bàn
│   └───────────────────────────────────┘ │
│   ┌───────────────────────────────────┐ │
│   │  ↔️  Chuyển sang bàn khác        │ │  ← Khách đổi chỗ
│   └───────────────────────────────────┘ │
│                                         │
│   [Đóng]                                │
└─────────────────────────────────────────┘
```

> 🆕 **Đợt 2.2**: Action sheet này có sẵn ở mọi POS FnB. Tap chính xác bàn → chọn hành động.

### Use case thực tế

| Tình huống | Cashier làm |
|---|---|
| Khách mới đến, ngồi bàn A1 | Tap A1 → "Mở đơn mới" → POS bật giỏ |
| Cashier check đơn đang chạy bàn B3 | Tap B3 → "Xem đơn đang phục vụ" |
| Khách 2 bàn dồn ngồi chung | Tap bàn 1 → "Gộp với bàn khác" → chọn bàn 2 |
| Khách đổi chỗ qua VIP | Tap bàn cũ → "Chuyển sang bàn khác" → chọn VIP |

---

## 📱 Trên điện thoại / iPad

### 🆕 Pinch zoom + 2-finger pan (Đợt 3.1)

- **Bóp 2 ngón** vào nhau → zoom out (thấy nguyên tầng).
- **Tách 2 ngón** ra → zoom in (xem rõ bàn nào).
- **Vuốt 2 ngón** → pan canvas (di chuyển sang trái/phải/lên/xuống).

### 🆕 Auto fit-to-screen (Đợt 3.2)

Khi load lần đầu, canvas tự co dãn vừa khít màn hình → cashier không phải chỉnh zoom thủ công.

### 🆕 Mobile phone fallback (Đợt 3.3)

Trên màn hình nhỏ (<400px wide):
- Tự chuyển sang **chế độ list** (danh sách bàn) thay vì canvas.
- **Lock edit**: Không cho sửa từ điện thoại → tránh kéo nhầm bàn.

---

## 🔄 Realtime đồng bộ

- Cashier máy A đổi trạng thái bàn → các máy B, C, manager admin **cập nhật trong 1-2 giây**.
- Không cần F5 / refresh thủ công.

---

# ✅ Checklist setup nhanh

## Trước khi dùng
- [ ] Migration 00125 + 00126 đã chạy
- [ ] User admin có quyền `floor_plan.edit_global`
- [ ] Manager quán có quyền `floor_plan.edit_branch`
- [ ] (Tuỳ chọn) Đã chụp ảnh layout quán

## Setup (~30 phút)
- [ ] Tạo Tầng cho quán
- [ ] Tạo Khu vực (Sảnh 1, Sân vườn, VIP...)
- [ ] Đặt bàn vào khu vực, đặt tên (A1, B2, VIP-1...)
- [ ] Thêm đồ trang trí (quầy bar, cửa, cây cảnh, tường)
- [ ] (Tuỳ chọn) Tải ảnh nền + chỉnh độ trong 30%
- [ ] Bấm In ra giấy → dán bếp/quầy đối chiếu

## Test cashier
- [ ] Mở POS FnB → tab Sơ đồ bàn
- [ ] Tap 1 bàn → thấy action sheet
- [ ] "Mở đơn mới" → POS bật giỏ → bán test 1 món
- [ ] Bàn đổi từ ⬜ trống → 🔵 đang phục vụ
- [ ] Máy POS khác cũng thấy bàn đổi màu (realtime ✓)

---

# 🆘 FAQ

## ❓ Q1: Tôi không thấy nút "Sửa" trong trang Sơ đồ bàn?
**Lý do**: User của bạn không có quyền `floor_plan.edit_*`.
**Fix**: Admin vào `/he-thong/quyen` → cấp quyền cho user.

## ❓ Q2: Tap bàn không thấy action sheet hiện ra?
**Check**:
- POS FnB version mới chưa? Reload trang (Ctrl+R).
- Bàn có tên + thuộc khu vực chưa? Bàn lẻ ngoài zone không tap được.

## ❓ Q3: Cashier sửa được bàn từ điện thoại — nguy hiểm!
**Đã fix**: Trên màn hình <400px tự **lock edit** (Đợt 3.3). Chỉ xem + tap được, không kéo bàn.

## ❓ Q4: Bàn không cập nhật trạng thái realtime?
**Check**:
- Mạng OK không? Realtime cần WebSocket.
- Service Worker cũ? Hard refresh Ctrl+Shift+R.
- F12 → Console có error WebSocket không?

## ❓ Q5: Tải ảnh nền lên báo lỗi?
**Giới hạn**:
- File JPG/PNG (không PDF, không HEIC).
- Dung lượng < 5 MB.
- Nếu lỗi → resize ảnh trước (dùng paint.net hoặc TinyPNG).

## ❓ Q6: Bàn bị méo / xoay không đẹp?
**Phím tắt**: Bấm chọn bàn → nút **Reset xoay** (góc phải palette) → quay về 0°.

## ❓ Q7: Lỡ xoá nguyên zone → có khôi phục được không?
**Có**: Bấm Ctrl+Z ngay → undo. Mỗi session lưu 50 step.
**Lưu ý**: Đóng trình duyệt = mất undo history. Save trước khi đóng!

---

# 🎯 Mẹo PM em đề xuất

1. **Vẽ phác trên giấy trước** rồi mới dựng trên web → nhanh gấp 3 lần.
2. **Đặt tên bàn theo khu vực** (A1-A10 cho Sảnh 1, B1-B10 cho Sảnh 2) → cashier nhớ dễ.
3. **Chụp ảnh layout quán** trước khi setup → làm ảnh nền + đối chiếu.
4. **In sơ đồ ra giấy** dán ở bếp / quầy → nhân viên mới làm quen nhanh.
5. **Setup vào giờ vắng khách** (sáng sớm hoặc chiều 14-16h) → không lo nhân viên click nhầm.

---

# 📞 Hỗ trợ

- **Sai gì hỏi em** — em fix theo file này.
- **Trang demo**: `/mockup/so-do-ban` (xem layout mẫu trước khi setup quán thật).
- **Phím tắt**: Ctrl+Z hoàn tác / Ctrl+Y làm lại / Delete xoá đang chọn.

---

> ✍️ **Ghi chú phiên bản 2 (09/06/2026)**:
> - Cập nhật toàn bộ feature Sprint 5 (A+B+C Floor Plan Editor).
> - Thêm 10 đợt polish design Đợt 1 (font auto, sofa L, color v2, ZoneLabel chip).
> - Thêm Action sheet POS FnB (Mở/Xem/Gộp/Chuyển bàn) — Đợt 2.2.
> - Thêm Mobile zoom + pan + auto-fit + lock edit (Đợt 3.1-3.3).
> - Gộp 2 trang cũ thành 1 với phân quyền bên trong.
> - Format đẹp + có FAQ + checklist + mẹo PM.
