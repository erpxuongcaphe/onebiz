# Ban giao cong viec - 23/08/2026

## Nguon su that

- Nhanh production: `origin/main` tai commit `667b45d6`.
- Khong dung worktree dang co thay doi chua ro nguon de build hoac review.
- Moi dot moi phai tao worktree va nhanh sach tu `origin/main`.

## Da live, khong lam lai

- POS Retail ngay hoa don: migrations 00335-00339, giao dien POS theo tung tab, va bao cao doc `issued_at`.
- Don ban con tu don dat hang: migrations 00331-00334, 00337, 00341 va UI ba trang thai.
- Trang Hoa don chi hien chung tu ban: migration 00342 va PR #251.
- Bao mat anon/PUBLIC execute: migration 00340. Con 31 routine `pg_trgm` C/invoker cua `supabase_admin` ngoai tam thu hoi.
- POS FnB C1-C3.1: khung, the mon, gio hang va responsive.

## Quy tac 00342

Chi chung tu ban moi hien tai trang Hoa don va duoc tinh KPI:

```sql
i.source IS DISTINCT FROM 'order' OR i.order_code IS NOT NULL
```

Khong viet `source <> 'order'` roi goi la an toan voi NULL. O client PostgREST phai giu du ba nhanh:

```text
source.is.null,source.neq.order,order_code.not.is.null
```

Don dat hang goc co `source = 'order'` va `order_code IS NULL` chi hien tai trang Don dat hang. Hoa don lich su da chuyen tai cho van co `source = 'order'`, nhung co `order_code`, nen phai giu lai.

Hai ban sao giao CEO trong `SQL-CAN-CHAY` phai duoc giu byte-identical voi migration va rollback; test 00342 khoa bat bien nay. 00342 da live, vi vay khong chay lai `BUOC-2` hoac `HOAN-TAC` tren production neu khong co chi dao xu ly su co. Nguon su that la:

- `supabase/migrations/00342_invoice_list_only_sales_documents.sql`
- `supabase/migrations/00342_rollback_invoice_list_only_sales_documents.sql`

Hai file kiem truoc/kiem sau chi doc trong `SQL-CAN-CHAY` duoc giu de tham chieu. Khong doi noi dung hai ban sao co ghi ma khong doi dong thoi migration/rollback va test doi chieu.

## PR dang mo, khong tu merge

- #222 F1b: thu hoi ghi thang cau hinh ban. Chi merge sau UAT du 5 vai tro/thiet bi.
- #224 F2 dat ban: chi la plan. Chua build cho toi khi 8 quyet dinh nghiep vu duoc duyet.

## Viec con lai theo thu tu

1. Link ma hoa don con tu trang Don dat hang sang dung chi tiet hoa don. PR rieng, chi doc/dieu huong, khong doi du lieu.
2. Ra soat giao dich cot loi: chi nhanh, tenant, quyen, ngay chung tu, trang thai, tong tien, refresh sau mutation.
3. Ra soat bo loc/tim kiem/xuat Excel va doi chieu bang-KPI-Excel cung pham vi.
4. Phu loading/loi/rong/khong quyen va responsive theo nhom man hinh.
5. Audit RLS chi doc tung bang truoc. 00239 chi dong `anon`; khong bat RLS hang loat va khong suy dien muc do nghiem trong chi tu so bang tat RLS.
6. Hoan thien FnB phan khong phu thuoc du lieu; UAT nghiep vu chi khi gia, BOM va ban da san sang.

## Hang rao du lieu va production

- Khong tao/sua/xoa don hang, hoa don, kho, quy, ca, ban hoac du lieu cau hinh production de test.
- SQL production do CEO chay sau preflight, review, transaction, postflight va rollback.
- Khong coi `404 PGRST202` la bang chung chan quyen. Chan quyen dung can thay chu ky dung va `401` / `42501`.
- UI chi merge sau khi xem Preview tren desktop, iPad ngang, iPad doc va mobile.
