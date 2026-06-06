# 🔍 Verify Sprint 3 + Migration 00124

Anh chạy 1 query duy nhất sau trên Supabase SQL Editor. Em sẽ giải thích kết quả.

## Query verify (chạy 1 lần)

```sql
-- ─── Verify 1: Migration 00123 + 00124 đã apply đầy đủ ───
SELECT 'cascade_mode column' AS check_item,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name='branches' AND column_name='cascade_mode'
       ) THEN '✅ OK' ELSE '❌ MISSING' END AS status
UNION ALL
SELECT 'should_cascade_bom_at_branch helper',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc WHERE proname='should_cascade_bom_at_branch'
       ) THEN '✅ OK' ELSE '❌ MISSING' END
UNION ALL
SELECT 'internal_sale_apply_stock_out RPC',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc WHERE proname='internal_sale_apply_stock_out'
       ) THEN '✅ OK' ELSE '❌ MISSING' END
UNION ALL
SELECT 'get_bom_availability_batch RPC',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc WHERE proname='get_bom_availability_batch'
       ) THEN '✅ OK' ELSE '❌ MISSING' END
UNION ALL
SELECT 'consume_bom_for_sale v4 (9 args, có p_skip_bom_consume)',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc 
         WHERE proname='consume_bom_for_sale'
           AND pronargs = 9
       ) THEN '✅ OK' ELSE '❌ MISSING (chưa apply 00124)' END
UNION ALL
SELECT 'fnb_complete_payment_atomic v8 (hotfix)',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc 
         WHERE proname='fnb_complete_payment_atomic'
           AND obj_description(oid) LIKE '%v8%hotfix%'
       ) THEN '✅ OK' ELSE '⚠️ Có thể là v7 cũ — verify lại' END
UNION ALL
SELECT 'pos_complete_checkout_atomic v5',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc 
         WHERE proname='pos_complete_checkout_atomic'
           AND obj_description(oid) LIKE '%v5%'
       ) THEN '✅ OK' ELSE '⚠️ Có thể là v4 cũ' END

ORDER BY check_item;

-- ─── Verify 2: Smoke test cascade_mode helper ───
-- Pick 1 SKU has_bom + Kho tổng + 1 Quán → should_cascade khác nhau.
WITH test_data AS (
  SELECT 
    p.id AS sku_id, p.code AS sku_code, p.name AS sku_name,
    (SELECT id FROM branches WHERE cascade_mode='production' AND tenant_id=p.tenant_id LIMIT 1) AS prod_branch,
    (SELECT id FROM branches WHERE cascade_mode='outlet' AND tenant_id=p.tenant_id LIMIT 1) AS outlet_branch
  FROM products p
  WHERE p.has_bom = true
    AND p.tenant_id = (SELECT id FROM tenants WHERE name='OneBiz Coffee Demo')
  LIMIT 1
)
SELECT
  sku_code,
  sku_name,
  'Tại Kho tổng (production)' AS test,
  public.should_cascade_bom_at_branch(sku_id, prod_branch) AS should_cascade
FROM test_data
UNION ALL
SELECT
  sku_code,
  sku_name,
  'Tại Quán FnB (outlet)',
  public.should_cascade_bom_at_branch(sku_id, outlet_branch)
FROM test_data;
```

## Kết quả kỳ vọng

**Query 1** — 7 dòng đều ✅ OK.

**Query 2** — 2 dòng:
- Kho tổng (production) → `true` (cascade BOM trừ NVL).
- Quán FnB (outlet) → `false` (trừ SKU trực tiếp).

→ Nếu đủ cả 2 → migration apply đúng, logic mới hoạt động.
