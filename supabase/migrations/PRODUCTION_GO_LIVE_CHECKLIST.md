# Production Go-Live Checklist — Bảo mật multi-tenant

> **Khi nào dùng**: trước khi mở app cho user thực (kể cả 1 user). Đây là
> ranh giới giữa dev mode (RLS disabled) và production (RLS enforced).

---

## Tóm tắt kiến trúc bảo mật multi-tenant

OneBiz dùng pattern **shared-database, isolated-tenant**: 1 database chứa
data tất cả tenants, tách biệt bằng cột `tenant_id`. Bảo mật multi-tenant
gồm **3 layer**, mọi layer phải hoạt động đồng thời mới an toàn:

| Layer | Cơ chế | Trạng thái dev | Trạng thái production |
|-------|--------|----------------|----------------------|
| **L1 — RLS DB** | Postgres Row Level Security | ❌ Disabled (00010) | ✅ Enabled (00014) |
| **L2 — Service filter** | `getCurrentTenantId()` + `.eq("tenant_id", tenantId)` mỗi query | ✅ Phải có | ✅ Phải có |
| **L3 — Test** | Vitest cross-tenant leak detection | ✅ Phải pass | ✅ Phải pass |

Nguyên tắc: **KHÔNG tin RLS một mình**. Layer 2 + 3 là defense-in-depth
phòng khi RLS policy có lỗi/sót.

---

## Checklist trước go-live

### 1. Audit code service layer (Layer 2)

```bash
# Đếm queries thiếu tenant filter:
cd src/lib/services/supabase
for f in *.ts; do
  if [ -f "$f" ]; then
    name=$(basename "$f" .ts)
    from_count=$(grep -c '\.from("' "$f")
    tenant_count=$(grep -c 'eq("tenant_id"\|tenant_id:\s*tenantId\|getCurrentTenantId\|getCurrentContext' "$f")
    printf "%-30s from=%-3s tenant=%-3s\n" "$name" "$from_count" "$tenant_count"
  fi
done
```

**Quy tắc**: với mỗi service, `tenant >= from / 2` (mỗi query SELECT cần tenant
filter; counts khác có thể là insert tenant_id, getCurrentTenantId calls).

Services đã audit + fixed (commit history):
- ✅ `products.ts` — commit `59fef41`
- ✅ `categories.ts` — commit `3b02a2e`
- ✅ `suppliers.ts` — commit (this checklist)
- ✅ `customers.ts` — commit (this checklist)
- ✅ `invoices.ts` — commit (this checklist)
- ✅ `branch-stock.ts` — commit (this checklist)

Services CHƯA audit (todo trước go-live):
- ⚠️ `orders.ts`, `kitchen-orders.ts`, `fnb-tables.ts`, `fnb-checkout.ts`
- ⚠️ `online-orders.ts`, `split-bill.ts`, `shifts.ts`, `variants.ts`
- ⚠️ `coupons.ts`, `debt.ts`, `returns.ts`, `promotions.ts`
- ⚠️ Partial-coverage: `branches.ts`, `inventory.ts`, `transfers.ts`,
  `bom.ts`, `pricing.ts`, `internal-sales.ts`, `purchase-entries.ts`

### 2. Bật lại RLS (Layer 1)

Trong Supabase Dashboard → SQL Editor:

```sql
-- Re-run migration 00014 (idempotent — chạy lặp không lỗi)
-- File: supabase/migrations/00014_rls_hardening.sql
-- Effect: bật RLS trên TẤT CẢ tables + tạo policies

-- VERIFY:
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('products', 'categories', 'customers', 'suppliers',
                    'invoices', 'branch_stock', 'orders')
ORDER BY tablename;
-- Expected: rowsecurity = true cho TẤT CẢ rows
```

**KHÔNG** chạy `00010_dev_disable_rls.sql` nữa. File này là dev-only.

### 3. Verify policies có function `get_user_tenant_id()`

```sql
-- Function này resolve tenantId từ auth.uid() → profiles.tenant_id
SELECT proname, prosrc FROM pg_proc WHERE proname = 'get_user_tenant_id';
-- Expected: 1 row, definition trả về uuid
```

Nếu thiếu — cần migration để tạo:

```sql
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;
```

### 4. Đặt env var production

`.env.production` (Vercel project settings):

```
NEXT_PUBLIC_BYPASS_AUTH=  ← để TRỐNG hoặc xóa hẳn (KHÔNG đặt 'true')
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
```

**Tuyệt đối KHÔNG** copy `BYPASS_AUTH=true` từ dev sang production.

### 5. Test cross-tenant leak (Layer 3)

```bash
npx vitest run tests/security/cross-tenant.test.ts
# Expected: All passing — không có 1 query nào trả data của tenant khác
```

### 6. Smoke test với 2 tenants thật

1. Tạo tenant A — login tài khoản A — tạo 5 sản phẩm
2. Tạo tenant B — login tài khoản B — kiểm tra danh sách hàng hoá
3. **Expected**: Tenant B thấy 0 sản phẩm (không thấy của A)
4. Search tên SP của A trong UI tenant B → 0 kết quả
5. Mở DevTools Network tab → kiểm tra response không leak data tenant A

---

## Nếu gặp lỗi sau go-live

### Symptom: User báo "không thấy data của mình"
→ Check policy `get_user_tenant_id()` có resolve đúng không. Profile có
`tenant_id` chưa? Nếu user mới, `handle_new_user` trigger đã chạy chưa?

### Symptom: User thấy data tenant khác
→ Layer 2 hoặc Layer 3 đã miss. CHẠY NGAY: `set NEXT_PUBLIC_BYPASS_AUTH=`
trên Vercel + revert latest deploy + audit lại services.

### Symptom: Query treo timeout
→ RLS policy có recursive lookup? Check function `get_user_tenant_id()`
có cache (`STABLE` keyword) không.

---

## Owner

Khi anh đọc checklist này — em đã ship Layer 2 fixes cho 6 services
critical (products, categories, suppliers, customers, invoices,
branch-stock). Các service khác sẽ được audit batch tiếp theo. Trước
go-live em sẽ:

1. Audit toàn bộ services còn lại (~20 file)
2. Viết test cross-tenant leak detector
3. Verify migration 00014 idempotent

CEO confirm: "anh đang trong giai đoạn build, build cho lâu dài" — quy
trình này được thiết kế để tránh sửa khó về sau.
