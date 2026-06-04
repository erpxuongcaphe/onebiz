# Test Plan — Migration 00124 + Sprint 3 final

CEO chạy các test sau khi đã apply migration 00123 + 00124.

## 🧪 Test 1 — Verify cascade_mode chính xác

```sql
SELECT 
  t.name        AS tenant,
  b.name        AS branch,
  b.branch_type,
  b.cascade_mode,
  CASE 
    WHEN b.branch_type IN ('warehouse','factory') AND b.cascade_mode = 'production' THEN '✅'
    WHEN b.branch_type IN ('store','office')      AND b.cascade_mode = 'outlet'     THEN '✅'
    ELSE '⚠️'
  END AS status
FROM branches b JOIN tenants t ON t.id = b.tenant_id
WHERE b.is_active = true
ORDER BY t.name, b.cascade_mode DESC;
```

**Kỳ vọng**: Kho Tổng = production, Quán FnB = outlet.

## 🧪 Test 2 — Verify helper should_cascade_bom_at_branch

```sql
-- Pick 1 SKU has_bom=true + 1 production branch + 1 outlet branch
SELECT 
  p.code AS sku_code,
  br.name AS branch_name,
  br.cascade_mode,
  public.should_cascade_bom_at_branch(p.id, br.id) AS should_cascade
FROM products p, branches br
WHERE p.has_bom = true
  AND p.tenant_id = (SELECT id FROM tenants WHERE name = 'OneBiz Coffee Demo')
  AND br.tenant_id = p.tenant_id
  AND br.is_active = true
ORDER BY p.code, br.cascade_mode DESC
LIMIT 20;
```

**Kỳ vọng**:
- branch.cascade_mode='production' → should_cascade = true (cho mọi SKU has_bom có BOM).
- branch.cascade_mode='outlet' → should_cascade = false (vì BOM toàn global, không branch-specific).

## 🧪 Test 3 — Outlet bán món có modifier (P0 verify)

**Mô phỏng**: Quán FnB bán 1 "Bạc xỉu" có chọn modifier "Trân châu" (linkedProductId là NVL).

Trước migration 00124: NVL Cà phê trừ DOUBLE (qua BOM cascade + qua direct).
Sau migration 00124: NVL Cà phê KHÔNG bị trừ (vì outlet skip BOM); chỉ topping "Trân châu" trừ 1 lần.

**Cách test thực**: trên POS FnB, vào 1 quán có cascade_mode=outlet, bán 1 món có BOM + modifier linkedProduct.

**Cách check SQL**:
```sql
-- Sau khi bán 1 ly, query stock_movements của invoice mới
SELECT 
  sm.product_id,
  p.code,
  sm.type,
  sm.quantity,
  sm.reference_type,
  sm.note
FROM stock_movements sm
JOIN products p ON p.id = sm.product_id
WHERE sm.reference_id = '<invoice_id_vừa_tạo>'
ORDER BY sm.created_at;
```

**Kỳ vọng**:
- 1 row: SKU món (outlet trừ direct).
- 0 row bom_consume (vì outlet skip BOM).
- N row modifier_topping (= số topping NVL chọn).

## 🧪 Test 4 — Production branch cascade BOM đúng

Tại Kho Tổng (production), POS Retail bán 1 SKU đóng gói has_bom=true:
- Kỳ vọng: 1 row bom_consume cho mỗi NVL trong BOM (trừ NVL theo formula).
- KHÔNG có row trừ SKU đóng gói (vì SKU has_bom=true không giữ tồn).

```sql
SELECT type, count(*), reference_type 
FROM stock_movements
WHERE reference_id = '<invoice_id_pos_retail>'
GROUP BY type, reference_type;
```

## 🧪 Test 5 — Internal Sale fix G1

Tạo phiếu Internal Sale 1 lon SKU has_bom=true từ Kho Tổng → 1 Quán:

```sql
-- Trước tạo: ghi nhận tồn NVL Kho Tổng
SELECT product_id, quantity FROM branch_stock 
WHERE branch_id = '<kho_tong_id>' AND product_id = '<nvl_id>';

-- Sau tạo: NVL Kho Tổng giảm theo BOM × số lượng. SKU đóng gói tại Quán tăng theo số lượng.

SELECT 
  sm.product_id, p.code, sm.type, sm.quantity, sm.reference_type, sm.note
FROM stock_movements sm
JOIN products p ON p.id = sm.product_id
WHERE sm.reference_id = '<invoice_internal_sale_id>'
ORDER BY sm.created_at;
```

**Kỳ vọng leg-OUT (Kho Tổng)**: bom_consume trừ NVL theo BOM. 
**Kỳ vọng leg-IN (Quán)**: 1 row stock_movement type='in' cho SKU đóng gói.

## 🧪 Test 6 — Công nợ nút Thanh toán per row

UI test:
1. Vào `/tai-chinh/cong-no` tab KH còn nợ.
2. Click nút **"Thanh toán"** ở 1 row khách bất kỳ.
3. Dialog mở: hiển thị list HĐ nợ + ô nhập tổng tiền.
4. Gõ số tiền nhỏ hơn tổng nợ → check auto-allocate FIFO cho HĐ cũ nhất.
5. Lưu → kỳ vọng:
   - `customers.debt` giảm.
   - `invoices.debt` của HĐ cũ nhất giảm.
   - `cash_transactions` có row mới type='receipt'.

## 🧪 Test 7 — Menu sau re-org

UI check:
1. Sidebar **Bán hàng** có item "Bán nội bộ chuỗi" (mới chuyển từ Kho).
2. Sidebar **Kho** chia 2 subGroup "Vận hành kho" + "Xuất kho".
3. Sidebar có group mới **Khuyến mãi** với 3 items.
4. Sidebar **Tài chính** giờ có 6 items (gộp sub Tài chính của Báo cáo).
5. Sidebar **Báo cáo** bỏ sub Tài chính.

## 🚨 Quan trọng — Áp dụng migration

Apply **00124** ngay sau khi 00123 đã chạy. Migration 00124 fix critical bug, không động vào data.

```sh
# Hoặc anh paste 00124_fix_outlet_modifier_double_consume.sql vào Supabase SQL Editor.
```
