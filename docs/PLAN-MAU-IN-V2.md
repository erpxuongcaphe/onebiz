# PLAN — Hệ thống Mẫu in V2 (Pha 3)

> Trạng thái: **CHỜ DUYỆT để triển khai**. Pha 1 (vá bug in thiếu mặt hàng) + Pha 2 (dọn trang Cài đặt) **đã làm xong** ở đợt trước. File này là kế hoạch cho Pha 3 — hệ mẫu in theo `(loại chứng từ × kênh × khổ giấy)`.
>
> Quyết định CEO (24/06/2026): Pha 1+2 làm trước; Pha 3 lên plan. Khổ hóa đơn: ưu tiên **bill nhiệt 80/58mm**, hệ **tự chọn khổ theo chi nhánh** (FnB/quầy → bill nhiệt; kho/xưởng bán sỉ → A5).

---

## 1. Mục tiêu

1. Mỗi **loại chứng từ** có mẫu in riêng, hệ **tự chọn mẫu theo thao tác** (không bắt người dùng chọn mẫu lúc in).
2. **Phân biệt kênh** retail vs FnB — nhưng tách **thô** (theo `branch_type`), KHÔNG vẽ lại từng mẫu.
3. **Khổ giấy** chuẩn hoá: 80/58mm cho bill nhiệt, A4/A5 cho chứng từ kho. Mỗi khổ 1 layout, không "tự co giãn".
4. **Tuỳ biến** bằng bật/tắt + ô chữ (header/footer/logo) cho bill; mẫu điền-field (token) cho chứng từ A4. **Không** trình kéo-thả pixel.

Cơ sở: research KiotViet, Sapo, MISA/CukCuk, Loyverse, Square, Toast (báo cáo ngày 24/06). Khóa kiến trúc gọn-đúng nhất = **Sapo: `(chi nhánh × loại mẫu × khổ giấy)`**.

---

## 2. Hiện trạng (nền đã có — KHÔNG làm lại)

| Luồng | File | Trạng thái |
|---|---|---|
| Hóa đơn POS FnB + tạm tính + phiếu bếp | `src/lib/print-fnb.ts` | ✅ Mẫu cố định + toggle (showStoreName, receiptStyle, kitchenTicketStyle). Đã tốt. |
| Hóa đơn POS Retail | `src/components/shared/print-receipt.tsx` (`printReceiptDirect`) | ✅ Có mặt hàng. |
| Chứng từ admin (hóa đơn/trả/nhập…) | `src/lib/print-document.ts` + `src/lib/print-templates.ts` | ⚠️ Mẫu chung A4/A5/nhiệt. **Pha 1 đã vá hiện mặt hàng cho 5 doc chính.** |
| In nhiệt trực tiếp | `src/lib/printer/webusb-printer.ts` (WebUSB ESC/POS) | ✅ Đã có — không cần QZ Tray. |

→ Phần in nhiệt + tách FnB/retail ở POS **đã ổn**. Pha 3 tập trung vào **chứng từ admin** + **chuẩn hoá chọn mẫu**.

---

## 3. Bộ mẫu tinh gọn (đúng 6, không hơn)

| # | Mẫu | Kênh | Khổ | Kiểu |
|---|---|---|---|---|
| 1 | Hóa đơn bán | Retail + FnB | 80/58mm **hoặc** A5 (VAT) | cố định + toggle |
| 2 | Phiếu tạm tính | FnB | 80/58mm | cố định *(đã có)* |
| 3 | Phiếu chế biến (bếp/bar) | FnB | 80/58mm | cố định, route theo nhóm *(đã có)* |
| 4 | Phiếu trả hàng / hoàn tiền | Retail + FnB | 80mm / A5 | cố định + toggle |
| 5 | Phiếu nhập / Đặt hàng NCC | Kho/Xưởng | A4/A5 | điền field (token) |
| 6 | Tem nhãn *(làm sau cùng)* | cả 2 | nhãn nhỏ | bật/tắt field |

**Không** làm mẫu riêng cho phiếu thu/chi, chuyển kho, xuất hủy ở đợt này (giữ mẫu chung token hiện tại).

---

## 4. Kiến trúc đề xuất

### 4.1 Chọn mẫu theo `(documentType, channel, paperSize)`
- `channel ∈ {retail, fnb}` **suy ra từ `branch_type`** của chi nhánh (CEO chốt: tự theo chi nhánh), cho phép override thủ công khi in.
- `paperSize` mặc định: chi nhánh FnB/quầy → `80mm`; chi nhánh kho/xưởng (bán sỉ) → `A5`. Người dùng vẫn đổi được ở hộp thoại chọn khổ.
- Gate 2 mẫu chỉ-FnB (tạm tính, chế biến) sau cờ tính năng theo chi nhánh FnB — chi nhánh retail không thấy.

### 4.2 Khổ giấy
- 80mm mặc định nhiệt, 58mm bản gọn, A4/A5 cho back-office. **1 data/token model dùng chung, mỗi khổ 1 layout nhỏ.** Không hứa co giãn pixel 80mm→A4.

### 4.3 Tuỳ biến
- **Bill nhiệt (hóa đơn/tạm tính/bếp/trả):** mẫu cố định + toggle (logo / VAT / QR / số đơn / ghi chú / gộp dòng / số bản theo trạm) + ô header/footer + logo theo chi nhánh. *(phần lớn đã có ở print-fnb.ts — mở rộng cho retail + trả hàng.)*
- **Chứng từ A4 (nhập/đặt NCC):** mẫu điền field token `{ten_cua_hang} {danh_sach_hang_hoa} {tong_tien} {chi_nhanh} {ngay}`.
- **KHÔNG** làm trình thiết kế kéo-thả.

### 4.4 In ấn (đã ổn, không đổi)
- A4 back-office → hộp thoại in trình duyệt.
- Bill nhiệt + mở ngăn kéo → WebUSB ESC/POS (đã có). Cash drawer do máy in bắn (RJ11).

---

## 5. Phạm vi việc Pha 3

1. **Nối nốt 3 chứng từ back-office còn lại** (đuôi Pha 1) cho hiện mặt hàng: trả hàng nhập, đặt hàng nhập, hóa đơn đầu vào. Cần thêm hàm nạp items: `supplier_return_items`, `purchase_order_items` (entry), input-invoice items. *(builder đã sẵn nhận `items` — chỉ thêm fetch + truyền.)*
2. **Cột bảng hàng theo từng loại:** hiện đang dùng chung `Mã·Tên·SL·Đơn giá·Thành tiền`. Cho phiếu nhập đổi "Đơn giá" → "Đơn giá nhập"; cho phiếu kiểm kho hiện `SL hệ thống · SL thực · Lệch`.
3. **Resolver mẫu** `resolvePrintTemplate(documentType, branch, paperSize)` — suy channel + khổ mặc định theo `branch_type`.
4. **Mẫu hóa đơn bán khổ nhiệt cho Retail** (hiện admin chỉ in A4/A5; thêm lựa chọn bill nhiệt 80/58mm theo CEO).
5. **Trang Cài đặt in — nhóm theo kênh:** tách rõ "Mẫu Retail" vs "Mẫu FnB" + preview từng loại.
6. **Cột giảm-giá-dòng (tuỳ chọn):** hiện Pha 1 gộp giảm vào thành tiền để bảng thẳng cột. Nếu cần cột "Giảm" riêng → sửa template render theo `itemColumns` thay vì điều kiện từng dòng (`print-document.ts` ô giảm đang render theo từng dòng → dễ lệch).

---

## 6. Việc đã xong (Pha 1 + Pha 2)

**Pha 1 — vá bug in thiếu mặt hàng:**
- `print-templates.ts`: thêm `items?` cho 8 builder + helper `toPrintLines()` (chuẩn hoá dòng hàng, bỏ cột giảm để bảng thẳng cột).
- Nối nạp chi tiết hàng (async) cho 5 doc chính: **hóa đơn bán, trả hàng, đơn đặt hàng, phiếu nhập, bán nội bộ**.

**Pha 2 — dọn trang Cài đặt in:**
- Bỏ khối "Thông tin máy in (tham khảo)" (USB/WiFi/LAN + IP/Port — chết).
- Bỏ "Số bản in", toggle "Phiếu tạm tính" (chưa nối), toggle "Hỏi xác nhận khi in lại" (chưa nối), separator/comment trùng, import `Select` + biến `connectionTypes` thừa.
- *(Còn lại tuỳ chọn: dọn field thừa trong type settings — `copies/connectionType/printerName/printerIp/printerPort/autoPrintPreBill/confirmRetryOnFail` — vô hại, để sau.)*
