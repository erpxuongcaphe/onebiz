# PLAN — Cài đặt In V3: Print Template Engine (GĐ3 đầy đủ)

> CEO chốt 25/06/2026: làm **engine nhiều mẫu** — mỗi (Mảng × Loại chứng từ × Chi nhánh)
> có mẫu in riêng, kế thừa Thương hiệu chung, nhân bản + ma trận gán + token động + preview sống.
> Lý do: trang in cũ lưu ~90% cấu hình **global 1 bộ** → cả chuỗi (Xưởng + Kho + 3 quán) dùng
> chung 1 khổ giấy / logo / footer / kiểu bill → "gò bó". Benchmark: KiotViet/MISA (đa mẫu theo
> loại), Sapo/Loyverse (chọn chi nhánh đầu luồng + preview sống), Square/MISA (tách brand chung +
> kế thừa). Ghép 3 điểm hay.

## Nguyên tắc nền
- **Additive / zero-regression**: chưa tạo mẫu nào → resolver fallback về builder built-in hiện tại
  (`print-templates.ts`). Không đụng luồng in cũ cho tới khi user tạo mẫu riêng.
- **2 lớp**: (1) Thương hiệu chung (khai 1 lần, override per-branch) → (2) Mẫu in (kế thừa, ghi đè).
- Migration do CEO chạy tay trên Supabase SQL Editor. Code không tự apply DDL prod.

## Khái niệm
- **Brand (Thương hiệu chung)**: logo, tên DN, MST, địa chỉ, hotline, QR ngân hàng, lời cảm ơn.
  Nguồn: `tenants.settings.business_info` (đã có) + override per-branch ở `branches.print_brand` (JSONB, NULL = kế thừa tenant).
- **Template (Mẫu in)**: 1 cấu hình render 1 `doc_type` cho 1 `channel`, optionally riêng 1 `branch_id`.
  Kế thừa Brand. Nhiều mẫu/khóa được (A/B/C), 1 `is_default`.
- **Resolver**: in doc loại D, kênh C, chi nhánh B →
  template (C, D, branch=B, is_default) → else (C, D, branch=NULL, is_default) → else builder built-in.

## Schema (migration 00153)
### Bảng `print_templates`
```
id uuid pk
tenant_id uuid not null → tenants  (ON DELETE CASCADE)
channel text not null      -- 'retail' | 'wholesale' | 'fnb' | 'backoffice'
doc_type text not null     -- xem enum dưới
branch_id uuid null → branches (ON DELETE CASCADE)  -- NULL = mặc định mọi chi nhánh của kênh
name text not null
paper_size text not null default '80mm'   -- '58mm' | '80mm' | 'A5' | 'A4'
config jsonb not null default '{}'        -- shape PrintTemplateConfig (dưới)
is_default boolean not null default true  -- mẫu auto-chọn cho khóa này
is_active boolean not null default true
created_at timestamptz default now()
updated_at timestamptz default now()
```
- Unique partial: `(tenant_id, channel, doc_type, coalesce(branch_id, zero-uuid))` WHERE `is_default AND is_active`
  → đảm bảo 1 default/khóa. Cho phép nhiều mẫu non-default cùng khóa (chọn lúc in — GĐ3).
- Index lookup: `(tenant_id, channel, doc_type, branch_id) WHERE is_active`.
- RLS: enable + policy `tenant_id = public.get_user_tenant_id()` (theo 00125).
- Trigger `handle_updated_at()`.

### Cột `branches.print_brand jsonb` (NULL = kế thừa tenant brand)
Shape: `{ logoUrl?, businessName?, taxCode?, address?, phone?, qrImageUrl?, bankInfo?, footer? }`.

### doc_type enum (14)
`sale_invoice`, `sales_order`, `sale_return`, `kitchen_ticket`,
`purchase_order`, `goods_receipt`, `input_invoice`, `purchase_return`,
`internal_sale`, `internal_export`, `inventory_check`, `disposal`,
`production_order`, `cash_voucher`.

### channel mặc định theo doc_type
- Bán (chọn theo ngữ cảnh): `sale_invoice`, `sales_order`, `sale_return` → retail/wholesale/fnb.
- `kitchen_ticket` → fnb.
- Mua/Kho/Xưởng/Tài chính → `backoffice`: còn lại.

### PrintTemplateConfig (JSONB shape — KHÓA contract)
```ts
interface PrintTemplateConfig {
  title?: string;                 // override tiêu đề (cho phép token)
  header?: { logo?: boolean; businessName?: boolean; taxCode?: boolean;
             address?: boolean; branch?: boolean; phone?: boolean };
  customer?: { name?: boolean; code?: boolean; phone?: boolean; address?: boolean };
  items?: { fontSize?: 'sm' | 'md' | 'lg'; columns?: string[] };  // columns = mã cột chọn
  payment?: { showQr?: boolean; showDiscount?: boolean; showDebt?: boolean };
  footer?: { signature?: boolean; thankYou?: boolean; customText?: string };  // customText: token
}
```
Field bỏ trống → kế thừa default built-in của doc_type đó. (merge nông).

### Token động (GĐ3 — Phase 6)
`{ten_doanh_nghiep} {ten_chi_nhanh} {ma_so_thue} {dia_chi} {hotline} {ma_don} {ngay_in}
{nhan_vien} {tong_tien} {qr_thanh_toan}` → thay khi render (title + footer.customText).

## Resolver contract (Phase 2 + 6)
```ts
resolvePrintTemplate(channel, docType, branchId): Promise<ResolvedPrint | null>
// null = không có mẫu riêng → caller dùng builder built-in như cũ.
// ResolvedPrint = { paperSize, config (đã merge default), brand (tenant ← branch override) }
applyTemplateToDocData(base: DocumentPrintData, resolved): DocumentPrintData
// áp config: lọc cột, fontSize, toggle header/customer/payment/footer, thay token.
```

## PHASES (tracker — tick khi xong)
- [x] **P1. Migration 00153** — bảng `print_templates` + `branches.print_brand` + RLS + index + trigger. ✅ CEO chạy 25/06; smoke-test pass.
- [x] **P2. Service** `print-templates-engine.ts` — types + CRUD + `resolvePrintTemplate` + `listForMatrix` + `duplicateTemplate`. ✅ live `d7008d9`.
- [ ] **P3. UI Tab "Thương hiệu chung"** — editor brand tenant + override per-branch (logo/MST/địa chỉ/QR/footer qua `setBranchPrintBrand`). *(brand đã CHẠY ở backend P6a; còn thiếu UI nhập per-branch)*
- [x] **P4. UI Tab "Mẫu in"** — bộ chọn ngữ cảnh + danh sách mẫu + editor nhóm-toggle + khổ giấy + preview. ✅ live `0711b0b` (`print-template-manager.tsx`).
- [ ] **P5. UI Ma trận gán + Nhân bản** — bảng (doc_type × chi nhánh) → mẫu nào. *(Nhân bản + Đặt mặc định ĐÃ có trong P4; còn thiếu view ma trận tổng)*
- [x] **P6a. Resolver wiring + Token (map sạch)** — `print-apply-template.ts` (applyTokens + applyTemplateToDocData + printDocumentWithTemplate) + hook templateCtx; wire 13 file/21 điểm in. ✅ live `c27cfa9`. ZERO-REGRESSION (0 mẫu → in y cũ).
- [ ] **P6b. Resolver wiring nâng cao** — mở rộng `print-document.ts`: `items.fontSize` + `payment.showQr` + `customer.*` granular (cần thêm field DocumentPrintData + render).
- [ ] **P7. Test + doc** — E2E từng doc_type khi CÓ mẫu, cập nhật doc/memory.

## Điểm rủi ro / lưu ý
- KHÔNG seed mẫu trong migration → tránh đụng luồng in cũ. Engine chỉ override khi user tạo mẫu.
- Cột chọn được phải nằm trong tập cột hợp lệ của từng doc_type (tránh render cột không có data).
- Per-branch printer (localStorage → DB) để **GĐ sau**; GĐ3 này tập trung mẫu in (layout/nội dung), không động printer hardware slot.
- Brand override per-branch chỉ ghi `branches.print_brand`; tenant brand vẫn ở `tenants.settings.business_info`.
