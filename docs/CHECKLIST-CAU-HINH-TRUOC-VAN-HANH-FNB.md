# CHECKLIST — Cấu hình trước khi vận hành F&B (topping SKU)

> Lập 08/08/2026 theo chỉ đạo CEO. **Toàn bộ mã đã sẵn sàng và merge trước** —
> checklist này chỉ gồm việc CẤU HÌNH khi quyết định vận hành thật, CEO tự
> thực hiện, không cần sửa mã. Làm ĐÚNG THỨ TỰ; mỗi bước có cách kiểm.

## Trạng thái nền (đã xong từ trước, không phải làm lại)

- ✅ 00303 gửi bếp ghi cả `productId` + `product_id` (đã chạy prod).
- ✅ RPC thanh toán hiện hành đã nổ BOM cho topping `has_bom` + nhân số phần × số ly.
- ✅ Popup + cache offline lấy topping từ một cửa `fnb-toppings.ts`
  (SKU + fnb + active + BOM đúng chi nhánh + giá > 0); cache có dấu phiên bản.
- ✅ Cờ `NEXT_PUBLIC_FNB_TOPPING_SKU` mặc định TẮT — hệ thống chạy y như cũ.

## Bước 1 — Nhập giá + công thức cho SKU-TPP (bắt đầu 1 mã thử)

Màn hình: **Hàng hóa → Hàng bán → tìm "SKU-TPP" → Sửa** (làm trong dialog
sản phẩm để cờ `has_bom` tự bật — tạo BOM đường khác sẽ THIẾU cờ này và máy
chủ không nổ công thức).

- [ ] `SKU-TPP-012 Trân Châu Trắng`: giá bán **8.000đ/phần** (CEO quyết số
      cuối) · tab Công thức: NVL *Trân châu trắng Zion* **0,025 Bịch**
      (= 50g trên bịch 2kg, khớp pattern "ly bịch 50").
- [ ] 13 mã SKU-TPP còn lại: lặp lại khi sẵn sàng — mã nào đủ giá + BOM sẽ
      TỰ hiện lên popup, không cần đổi mã nguồn.

**Kiểm:** mở POS FnB (tải lại trang) — chưa bật cờ thì popup CHƯA hiện gì
(đúng thiết kế); danh sách chỉ hiện sau Bước 4.

## Bước 2 — Chạy migration 00304 (giá topping do máy chủ quyết)

File: `supabase/migrations/00304_fnb_topping_gia_server.sql`
(rollback: `00304_rollback_fnb_topping_gia_server.sql`).

- [ ] Chạy trên Supabase SQL Editor. Migration TỰ kiểm fingerprint (câu giá
      cũ phải xuất hiện đúng 2 lần) — lệch là dừng, không phá gì.
- [ ] Thấy notice `00304: OK` là xong. Chạy lại lần nữa vô hại (idempotent).

**Ý nghĩa:** từ đây giá topping lúc thanh toán lấy `sell_price` trên máy chủ
cho SKU topping hợp lệ; mã cũ/đơn cũ vẫn dùng giá payload (tương thích).

## Bước 3 — Dọn cấu hình "Mức đường" (Tuỳ chọn món FnB)

- [ ] Mặc định = **100%** · hệ số của 100% = **1.0** (đang 0.8).
- [ ] Dòng **"Không đường" trùng: chỉ TẮT (is_active)** — không xoá vật lý.

## Bước 4 — Bật cơ chế topping SKU (cờ môi trường)

- [ ] Sao lưu cấu hình nhóm modifier "Topping" (chụp màn hình danh sách
      lựa chọn là đủ — nhóm chỉ có 1 dòng Cốm xào).
- [ ] **Tắt nhóm modifier "Topping"** trong Tuỳ chọn món FnB.
- [ ] Vercel → Project → Settings → Environment Variables:
      thêm `NEXT_PUBLIC_FNB_TOPPING_SKU = 1` (Production) → **Redeploy**.

**Kiểm sau khi bật:** mở POS FnB → popup món chỉ còn MỘT khu topping
(SKU-TPP, giá theo phần); nhóm chọn-nhiều cũ không hiện; thêm 2 phần
Trân Châu Trắng vào 1 ly = +16.000đ; sửa/mở lại món giữ nguyên lựa chọn
và tổng. **Nhân viên tải lại trang POS** (cache giữ cấu hình cũ).

## Đảo ngược khẩn cấp

- Tắt cờ (`NEXT_PUBLIC_FNB_TOPPING_SKU` xoá/`0`) + redeploy → về ngay giao
  diện cũ; bật lại nhóm modifier "Topping" nếu cần bán tiếp kiểu cũ.
- Gỡ giá server: chạy `00304_rollback_fnb_topping_gia_server.sql`.
