# Kế hoạch: Công thức nguyên liệu theo từng Size (per-size recipe)

> Mục tiêu: mỗi size của 1 món có **công thức riêng** (mỗi nguyên liệu một lượng riêng,
> phi tuyến) → bán size nào trừ kho đúng size đó. Làm **trước khi FnB go-live**, không
> phá hệ đang bán. CEO áp migration thủ công qua Supabase Dashboard.

Ngày lập: 16/06/2026 · Trạng thái: **chờ CEO duyệt**

---

## 1. Vì sao cần (đã verify)

- Chuẩn ngành (Starbucks/Luckin/Highlands/Gong Cha): **mỗi size = công thức cố định riêng, tăng phi tuyến**. Bằng chứng: Starbucks Venti *đá* 3 shot vs Venti *nóng* 2 shot.
- Hệ mình **đã có nền tảng đúng**: mỗi size là 1 `product_variant`, và mỗi variant có ô `bom_code` riêng (Sprint 2.4a). Bảng `bom` đã có cột `variant_id` (migration 00121).
- **Nhưng chưa nối dây**: lúc bán, `consume_bom_for_sale` (00122) phân giải BOM theo **SP cha** (`get_active_bom_for_branch(product_id)`), chỗ gọi (00122:594) **không truyền variant** → mọi size hiện trừ **cùng 1 công thức**. → Per-size recipe **chưa hoạt động**.

## 2. Mô hình đã chốt

| Loại tùy chọn | Cơ chế | Ví dụ |
|---|---|---|
| **Size** | **Variant — mỗi size 1 công thức (BOM) riêng** | M: cà phê 18g · L: 25g (khác hẳn, không nhân hệ số) |
| **Mức đường / Mức đá** | **Modifier `scale_factor`** (chỉ scale đúng 1 NVL được gắn) | 70% đường → đường ×0.7 |
| **Topping** | **Modifier cộng thêm** (`linked_product_id`, không scale) | +Trân châu → trừ NVL trân châu, +7.000đ |

## 3. Quyết định kỹ thuật

**Chọn Option A — tái dùng `bom.variant_id` đã có sẵn** (KHÔNG tạo bảng mới).
Lý do: schema đã có (`bom.variant_id` + `product_variants.bom_code`); chỉ cần mở rộng RPC `get_active_bom_for_branch` nhận thêm tham số **optional** `p_variant_id`. Tham số optional `DEFAULT NULL` → **caller cũ không đổi gì → backward-compat 100%**. Tạo bảng mới = rủi ro cao trên hệ đang bán → loại.

**Quy tắc phân giải BOM (chốt cứng, đưa vào comment RPC):**
1. Có `variant_id` + variant có `bom_code` → dùng **BOM của size đó**.
2. Có `variant_id` nhưng variant **chưa** có `bom_code` → **kế thừa BOM của SP cha** (auto-inherit; không lỗi).
3. Không có `variant_id` → BOM của SP cha (đúng như hiện tại).

→ Nghĩa là: chỉ món nào cần công thức-theo-size mới phải nhập; món chưa nhập vẫn chạy y cũ.

**Tương tác Size × Modifier (chốt):** dùng BOM của variant làm gốc, rồi modifier `scale_factor` áp lên đúng NVL được gắn trong BOM của variant đó (nhân, không ghi đè). Vd Size L (BOM-L có đường 10g, gắn nhóm "Mức đường") + chọn 70% → trừ 7g.

## 4. Các pha triển khai (đã fold rủi ro vào)

> Mỗi pha 1 migration riêng, áp tuần tự, có bước kiểm. Dừng/rollback được ở bất kỳ pha nào vì backward-compat.

**Pha 0 — Backfill + kiểm (READ-ONLY, an toàn nhất, làm trước)**
- Xác nhận `product_variants.bom_code` + `bom.variant_id` đã tồn tại (00121 đã áp ✓).
- Query soát: variant nào của SP `has_bom=true` mà `bom_code` NULL → liệt kê (sẽ auto-inherit cha, nhưng cần biết để nhập sau).
- Query soát **mã BOM mồ côi**: `variant.bom_code` trỏ tới BOM không tồn tại/đã xoá → phải sửa trước.

**Pha 1 — `get_active_bom_for_branch` nhận `p_variant_id`** (migration mới)
- Thêm tham số optional `p_variant_id DEFAULT NULL` + áp quy tắc phân giải mục 3.
- Tạo index `bom(tenant_id, variant_id, branch_id) WHERE is_active` để không chậm giờ cao điểm.
- Kiểm: gọi RPC với/không variant_id → trả đúng BOM, không crash cả 2 nhánh.

**Pha 2 — `consume_bom_for_sale` nhận `p_variant_id`** (migration mới)
- Truyền `p_variant_id` xuống `get_active_bom_for_branch`.
- **Chống lẫn variant SP khác**: nếu `variant.product_id ≠ p_sku_id` → báo lỗi (không trừ bừa).
- Kiểm: không truyền variant → y cũ; truyền variant có BOM riêng → trừ đúng BOM size.

**Pha 3 — FnB checkout truyền `variant_id`** (migration `fnb_complete_payment_atomic`)
- Tại chỗ gọi consume (00122:594) truyền `NULLIF(r.variant_id,'')::uuid`. (Cột `variant_id` đã lưu sẵn ở `kitchen_order_items`.)
- Kiểm: bán 1 đơn FnB size L (BOM riêng) → `stock_movements` cho thấy trừ BOM của L, không phải cha.

**Pha 4 — ~~POS Retail~~ → BỎ (CEO 16/06: chỉ làm FnB + POS FnB)**
- **KHÔNG đụng** `pos_complete_checkout_atomic` / `applyStockDecrement` / luồng bán lẻ. Retail giữ nguyên 100%.
- Hàm dùng chung (`get_active_bom_for_branch`, `consume_bom_for_sale`) chỉ **thêm tham số tùy chọn `DEFAULT NULL`** → Retail không truyền → **chạy y hệt hôm nay, không đổi 1 byte hành vi**.

**Pha 5 — TRẢ HÀNG FnB biết variant** *(bắt buộc cho FnB — nếu không sẽ lệch kho khi trả)*
- `restore_bom_for_return` nhận `p_variant_id` (tùy chọn); chỉ **luồng trả của FnB** truyền vào → hoàn kho đúng công thức đã trừ. Trả hàng Retail không truyền → giữ nguyên như cũ.
- Kiểm: bán FnB size L (trừ 25g) → trả 1 → hoàn đúng 25g (không phải 18g của cha).

**Pha 6 — UI nhập công thức theo size** (mockup duyệt trước → code)
- Form SP: mỗi variant có ô `bom_code` + nút **"Gợi ý mã L/XL"**; lưới NVL × size; nút **"Nhập M xong → gợi ý L/XL theo tỉ lệ ly → chỉnh tay"**.
- **Chặn trùng**: 2 variant cùng SP không được cùng `bom_code` (cảnh báo khi lưu).
- Mã `bom_code` ưu tiên **chọn từ danh sách BOM có sẵn** (tránh gõ sai), nút auto-gợi ý chỉ khi bấm.

**Pha 7 — Tách "Size" khỏi preset modifier** (UX, làm sau khi 1-6 chạy)
- "Size" không nên là modifier-scale. POS chọn size qua **variant picker**, không qua nhóm modifier. (Cái ô "Scale BOM ×" gây hiểu nhầm sẽ biến mất khỏi luồng Size.)

**Pha 8 — Test E2E + theo dõi 3 ngày**
- Ma trận test (mục 8). Cảnh báo nếu 1 invoice có 2 bút toán BOM-consume (double) → rollback Pha 3-4.

## 5. Rủi ro đã tính & cách xử lý

| Rủi ro | Mức | Xử lý (đã đưa vào plan) |
|---|---|---|
| Variant chưa có `bom_code` → trừ sai | Cao | Quy tắc **auto-inherit BOM cha** (mục 3) + Pha 0 liệt kê variant thiếu |
| **Trả hàng FnB** không biết variant → hoàn sai | Cao | **Pha 5** bắt buộc — restore theo variant (chỉ FnB) |
| Đụng nhầm luồng **POS Retail** | — | **Không làm Retail.** Hàm dùng chung chỉ thêm tham số tùy chọn → Retail chạy y cũ |
| 2 variant trùng `bom_code` → cùng công thức | TB | Pha 6 chặn trùng khi lưu |
| Đơn **nháp** tạo trước, công thức đổi sau | TB | Hoàn tất/huỷ hết nháp trước khi áp migration; công thức ổn định nên ít ảnh hưởng |
| Lẫn variant của SP khác | TB | Pha 2 kiểm `variant.product_id = sku_id` |
| BOM mồ côi (mã không tồn tại) | TB | Pha 0 soát + sửa trước Pha 1 |
| Thứ tự migration | TB | 00121 đã áp ✓ → Pha 0 chỉ backfill/kiểm |
| Lot FIFO theo variant | Thấp | Tạm dùng FIFO chung; mở rộng sau nếu cần lot riêng theo size |
| Sai số làm tròn scale | Thấp | Làm tròn 4 chữ số, sai số <0.1%/đơn (chấp nhận được) |

## 6. Quy trình SETUP cho quán (vận hành đúng)

**Xác định công thức từng size cho chuẩn:**
1. Đo **bằng dụng cụ** (jigger cho lỏng, cân cho bột/đá) — không "ước lượng bằng mắt".
2. Pha thử **3–5 lần/size**, lấy số ổn định; ghi `quantity + đơn vị (g/ml) + hao hụt% (cà phê ~2–5%)`.
3. **Phân loại NVL:**
   - Vào **công thức-theo-size** (cố định mỗi size): cà phê, sữa, ly, đệm ly…
   - Gắn **modifier scale**: đường (nhóm "Mức đường"), đá (nhóm "Mức đá").
   - Để **topping** riêng: mỗi topping = 1 option có `linked_product_id`.

**Nhập nhanh (không bùng nổ số dòng):** 1 món = 1 SP cha + N variant (M/L/XL), mỗi variant 1 `bom_code` → 1 BOM. Modifier (đường/đá/topping) **gắn 1 lần, mọi size kế thừa**. Nhập **Size M trước**, dùng nút gợi ý L/XL theo tỉ lệ ly, rồi **chỉnh tay các NVL phi tuyến**.

## 7. Quy trình VẬN HÀNH (giữ số liệu đúng lâu dài)

- **Đối soát định kỳ** (tuần/tháng đầu): so *kho trừ theo công thức* vs *kho đếm thực*; lệch > 5% → soát lại công thức/định lượng/hao hụt.
- **Cập nhật công thức theo mùa**: món mới hoặc đổi định lượng → cập nhật BOM của size tương ứng.
- **Cảnh báo tồn**: đặt ngưỡng riêng cho NVL chính (cà phê, sữa, đường, syrup).

## 8. Checklist go-live + ma trận test

**Go-live (món nhiều size):** ☐ mỗi size có `bom_code` + BOM riêng · ☐ modifier đường/đá/topping gắn đúng · ☐ test bán mỗi size soát `stock_movements` · ☐ test trả hàng hoàn đúng · ☐ đối soát thử 1 ca.

**Ma trận test E2E:**
1. FnB size L (BOM riêng) → trừ BOM-L, không cha.
2. SP cũ không variant → trừ BOM cha (backward-compat).
3. Size L + 70% đường → trừ BOM-L, đường ×0.7.
4. POS Retail biến thể có BOM riêng → trừ đúng.
5. Trả hàng size L → hoàn đúng lượng đã trừ.
6. Outlet/nội bộ (cascade) → đúng nhánh trừ kho.

## 9. Phạm vi & việc cần anh quyết

**Phạm vi (CEO 16/06): CHỈ FnB + POS FnB.** POS Retail không đụng. Các hàm RPC dùng chung chỉ thêm tham số tùy chọn `DEFAULT NULL` → Retail giữ nguyên hành vi.

1. **Bỏ "Size" khỏi nhóm modifier?** (em đề xuất: **có** — Size dùng variant, không scale).
2. **Bắt đầu thế nào?** (em đề xuất: **Pha 0 (chỉ query read-only) + dựng mockup** để anh duyệt UX trước, rồi mới áp migration).

> Nhắc lại để anh yên tâm: **không gì thay đổi trên web cho tới khi anh tự áp migration**. Pha 0 chỉ là query đọc, mockup là trang riêng — đều **không đụng** data hay luồng đang bán.
