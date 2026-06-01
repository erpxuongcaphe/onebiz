# Phase 2 FnB — Cấu trúc Excel data anh điền

> CEO 01/06/2026. Tài liệu này mô tả cấu trúc Excel để anh fill data FnB từ phần mềm cũ → import vào OneBiz. Sprint 2.1b (em sẽ build sau khi anh apply migration 00121) sẽ có **import script** đọc đúng cấu trúc này.

## Tổng quan 5 sheet

| Sheet | Việc | Bắt buộc? |
|---|---|---|
| 1. Hướng dẫn | Anh đọc rule, ví dụ | — |
| 2. Modifier Groups | Tạo nhóm tuỳ chọn (Mức đường, Mức đá, Topping...) | ✅ |
| 3. Modifier Options | Các giá trị trong mỗi group (0%/30%/...) | ✅ |
| 4. SKU FnB | Danh sách món bán: tên, nhóm, giá gốc | ✅ |
| 5. SKU Variants (Size) | Mỗi SKU có 2-3 size khác giá + BOM riêng | ✅ |
| 6. SKU ↔ Modifier | Gán modifier vào từng SKU (override category default) | Optional |
| 7. Nhóm ↔ Modifier | Default modifier cho cả nhóm (1 lần áp cho hàng loạt SKU) | ✅ (recommended) |

---

## Sheet 2 — Modifier Groups

| name | rule | channel | sort_order | scale_target_nvl |
|---|---|---|---|---|
| Size | `single_required` | fnb | 1 | _(trống — Size dùng variant riêng)_ |
| Mức đường | `single` | fnb | 2 | `NVL-BOT-001` *(NVL "Đường" — phải tồn tại trước)* |
| Mức đá | `single` | fnb | 3 | _(trống — đá không track tồn)_ |
| Topping | `multi` | fnb | 4 | _(trống — mỗi option link tới 1 NVL riêng)_ |

**Quy tắc `rule`:**
- `single_required`: bắt buộc chọn 1 (Size).
- `single`: chọn 1 hoặc bỏ qua (Mức đường, Mức đá).
- `multi`: chọn nhiều (Topping).

---

## Sheet 3 — Modifier Options

| group_name | label | price_delta | scale_factor | linked_nvl_code | is_default | sort_order |
|---|---|---|---|---|---|---|
| Mức đường | Không đường | 0 | 0 | | | 1 |
| Mức đường | 30% | 0 | 0.3 | | | 2 |
| Mức đường | 50% | 0 | 0.5 | | | 3 |
| Mức đường | 70% | 0 | 0.7 | ✅ | | 4 |
| Mức đường | 100% | 0 | 1.0 | | | 5 |
| Mức đá | Không đá | 0 | | | | 1 |
| Mức đá | Ít đá | 0 | | | | 2 |
| Mức đá | Vừa đá | 0 | | | ✅ | 3 |
| Mức đá | Nhiều đá | 0 | | | | 4 |
| Topping | Trân châu đen | 7000 | | `NVL-TPV-001` | | 1 |
| Topping | Thạch phô mai | 8000 | | `NVL-TPV-002` | | 2 |
| Topping | Kem cheese | 10000 | | `NVL-TPV-003` | | 3 |

**Lưu ý:**
- `scale_factor`: chỉ cho Mức đường (BOM "Đường" × scale_factor khi tính tồn).
- `linked_nvl_code`: chỉ cho Topping (mã NVL/SKU sẽ trừ tồn khi cashier chọn).
- `is_default`: tick nếu option đó là mặc định (vd 70% đường).

---

## Sheet 4 — SKU FnB

Anh đã quen sheet này từ `docs/HUONG-DAN-NHAP-LIEU-HANG-HOA.md`. Cột tương tự:

| code | name | category_code | channel | unit | sell_price | bom_code |
|---|---|---|---|---|---|---|
| SKU-CFS-001 | Bạc xỉu | CFS | fnb | Ly | 35000 | BOM-CFS-001-M |
| SKU-CFS-002 | Cà phê sữa đá | CFS | fnb | Ly | 29000 | BOM-CFS-002-M |
| SKU-TRA-001 | Trà sữa trân châu | TRA | fnb | Ly | 45000 | BOM-TRA-001-M |

- `bom_code` = BOM **size mặc định** (M). Variant L/XL có BOM riêng ở Sheet 5.
- `sell_price` = giá size mặc định.

---

## Sheet 5 — SKU Variants (Size)

| product_code | variant_name | sell_price | bom_code | is_default | sort_order |
|---|---|---|---|---|---|
| SKU-CFS-001 | M | 35000 | BOM-CFS-001-M | ✅ | 1 |
| SKU-CFS-001 | L | 41000 | BOM-CFS-001-L | | 2 |
| SKU-CFS-002 | M | 29000 | BOM-CFS-002-M | ✅ | 1 |
| SKU-CFS-002 | L | 35000 | BOM-CFS-002-L | | 2 |
| SKU-CFS-002 | XL | 42000 | BOM-CFS-002-XL | | 3 |

→ Bảng BOM riêng (sheet hiện tại trong template HUONG-DAN-NVL-SKU-BOM) cho `BOM-CFS-002-M`, `BOM-CFS-002-L`, `BOM-CFS-002-XL` với liều lượng cà phê + sữa + ly khác nhau.

**Quy tắc:**
- Mỗi SKU phải có ≥ 1 variant (Size M tối thiểu).
- 1 variant có `is_default=true`.
- `bom_code` của variant override `bom_code` ở Sheet 4 khi cashier chọn size đó.

---

## Sheet 7 — Nhóm ↔ Modifier (default)

| category_code | modifier_group_name |
|---|---|
| CFS | Size |
| CFS | Mức đường |
| CFS | Mức đá |
| TRA | Size |
| TRA | Mức đường |
| TRA | Mức đá |
| TRA | Topping |
| BAN | _(không có — bánh 1 chạm, không tuỳ chọn)_ |

→ Mọi SKU trong CFS auto thừa kế Size + Mức đường + Mức đá. Anh không cần điền từng SKU.

## Sheet 6 — SKU ↔ Modifier (override)

Chỉ điền khi 1 SKU cần thoát rule mặc định của nhóm.

| product_code | modifier_group_name | action |
|---|---|---|
| SKU-CFS-005 | Topping | `add` |
| SKU-CFS-008 | Mức đường | `remove` |

- `add`: thêm modifier riêng cho SKU đó.
- `remove`: bỏ modifier dù nhóm có.

---

## Cách áp data vào DB (sau khi anh điền xong)

**Bước 1**: Anh apply migration `00121_phase2_variant_modifier_schema.sql` trên Supabase Dashboard.

**Bước 2**: Em build import script (Sprint 2.1b — chưa làm, sẽ làm sau khi anh xác nhận template OK):
- Service `importPhase2FnbExcel(file)`.
- Đọc 6 sheet, validate code-lookup, insert vào `modifier_groups`, `modifier_options`, `product_variants`, `product_modifier_groups`, `category_modifier_groups`.
- Idempotent: chạy lại nếu sai gì đó (delete cũ + insert mới theo `tenant_id + name`).

**Bước 3**: Sprint 2.2 — em build trang Settings để anh sửa lại modifier groups bằng UI (không phải edit Excel).

**Bước 4**: Sprint 2.3 — em wire POS FnB đọc modifier groups + scale BOM khi checkout.

---

## Anh cần làm gì NGAY (sau khi đọc doc này)

1. ✅ Apply migration `00121` trên Supabase Dashboard.
2. ✅ Tạo Excel theo 7 sheet trên (anh có thể bắt đầu với 2-3 SKU mẫu để test trước).
3. ✅ Báo em khi sẵn sàng → em build import script Sprint 2.1b.

Nếu anh thấy có cột nào em thiếu / cấu trúc cần đổi → báo em sửa template ngay trước khi anh fill nhiều data.
