# OneBiz Stability & Product Audit - 2026-05-08

## Phạm vi

- Audit repo local, dev server local và smoke production đọc-only.
- Không pentest, không brute force, không thao tác dữ liệu thật.
- Tập trung: UI/UX, responsive desktop/tablet/mobile, kiến trúc frontend, service/data flow, độ ổn định POS Retail, POS F&B và quản lý kho.

## Kết luận nhanh

OneBiz hiện có nền khá tốt để tiếp tục: production build pass, TypeScript pass, full test suite pass 2.550 tests, smoke health production pass. Điểm cần xử lý nhất không phải là app đang "vỡ", mà là các rủi ro ổn định dài hạn:

1. Một số flow ghi dữ liệu quan trọng vẫn nhiều bước ở client, chưa atomic.
2. POS F&B còn query/cache menu chưa scope tenant/branch đủ chắc.
3. Lint gate đang đỏ 182 lỗi nên chưa dùng được làm quality gate.
4. Responsive/browser smoke chưa được tự động hóa bài bản cho POS và kho.
5. UI đã sạch hơn nhưng còn hơi nhạt, nhiều vùng xanh/pale, header/action chưa tối ưu cho tablet.

## Kết quả kiểm tra

| Hạng mục | Kết quả | Ghi chú |
| --- | --- | --- |
| `npm run build` | Pass | 104 app routes build thành công. Có cảnh báo migration Next/Sentry. |
| `npx tsc --noEmit --pretty false` | Pass | Không có lỗi type. |
| `npm run test:run` | Pass | 42 test files, 2.550 tests pass. |
| `npm run test:smoke` | Pass | 3 smoke files, 7 tests pass. |
| `npm run smoke:health` | Pass | Production `onebiz.com.vn`: 5/5 pages alive, redirect/login đúng kỳ vọng. |
| `npm audit --audit-level=moderate` | Pass | 0 vulnerabilities theo npm audit hiện tại. |
| `npx eslint src --quiet` | Fail | 182 errors. Đây là quality gate quan trọng cần xử lý. |
| Browser smoke local | Partially pass | Desktop kho/POS/F&B/KDS vào được; responsive batch qua in-app browser bị timeout/crash ở các trang nặng, cần Playwright route smoke riêng. |

## Findings Ưu Tiên

### P0 - POS Retail checkout chưa atomic

File: `src/lib/services/supabase/pos-checkout.ts`

`posCheckout` đang insert invoice, invoice_items, stock_movements, cash_transactions theo nhiều bước client-side. Comment đầu file nói "atomically", nhưng code hiện tại vẫn tuần tự:

- Invoice insert: `src/lib/services/supabase/pos-checkout.ts:347`
- Invoice items insert: `src/lib/services/supabase/pos-checkout.ts:411`
- Stock decrement: `src/lib/services/supabase/pos-checkout.ts:435`
- Cash receipt: `src/lib/services/supabase/pos-checkout.ts:443`

Rủi ro: mạng chập chờn hoặc DB lỗi giữa chừng có thể tạo hóa đơn completed nhưng thiếu dòng hàng, lệch tồn kho hoặc thiếu phiếu thu. F&B payment đã có RPC `fnb_complete_payment_atomic`, nên POS Retail nên đi cùng hướng: tạo RPC `pos_complete_checkout_atomic` bọc toàn bộ transaction, giữ idempotency bằng `client_session_id`.

### P0 - Flow bếp/bàn F&B còn nhiều bước non-atomic

Files:

- `src/lib/services/supabase/fnb-checkout.ts:91`
- `src/lib/services/supabase/kitchen-orders.ts:203`
- `src/lib/services/supabase/kitchen-orders.ts:258`
- `src/lib/services/supabase/kitchen-orders.ts:494`
- `src/lib/services/supabase/fnb-checkout.ts:209`

`sendToKitchen` tạo kitchen order, insert items rồi claim table sau. `transferTable` claim bàn mới, release bàn cũ, update order ở 3 bước. `voidFnbInvoice` hủy hóa đơn, hoàn tồn, tạo phiếu chi, hủy order qua nhiều bước.

Rủi ro: orphan kitchen order, bàn bị chiếm sai, hoàn tiền/tồn kho lệch nếu fail ở giữa. Nên đưa các flow này vào RPC transaction có idempotency key và điều kiện concurrency rõ ràng.

### P1 - POS F&B menu query/cache chưa scope tenant/branch đủ chắc

Files:

- `src/app/pos/fnb/page.tsx:224`
- `src/app/pos/fnb/page.tsx:232`
- `src/lib/offline/cache-manager.ts:40`
- `src/lib/offline/db.ts:135`

Trong F&B page, products/toppings query trực tiếp từ `products` nhưng chưa `.eq("tenant_id", tenantId)`. `cache-manager.ts` cũng prefetch menu không filter tenant và IndexedDB dùng DB name global `onebiz-fnb-offline`, key cache không có tenant/branch.

Rủi ro: khi dev/RLS bypass, multi-tenant demo, hoặc user đổi tenant/branch, UI có thể hiển thị menu/cache cũ trước khi network refresh. Nên:

- Thêm `.eq("tenant_id", tenantId)` cho mọi query trực tiếp.
- Đổi cache key thành `tenantId:branchId:productId` hoặc tạo store scoped.
- Invalidate cache khi logout, switch tenant, switch branch.

### P1 - ESLint đang fail 182 errors

Command: `npx eslint src --quiet`

Phân bổ lỗi:

- 68 `@typescript-eslint/no-explicit-any`
- 52 `react-hooks/set-state-in-effect`
- 50 `react/no-unescaped-entities`
- 6 `prefer-const`
- 3 `react-hooks/purity`
- 2 `@typescript-eslint/no-empty-object-type`
- 1 `@typescript-eslint/no-unnecessary-type-constraint`

Top files:

- `src/lib/services/supabase/reports.ts` - 24
- `src/components/shared/kitchen-stations-card.tsx` - 18
- `src/lib/services/supabase/production-dashboard.ts` - 13
- `src/app/(main)/cai-dat/fnb-presets/page.tsx` - 12
- `src/app/pos/fnb/components/fnb-empty-branch.tsx` - 8
- `src/app/pos/page.tsx` - 7

Rủi ro: CI không thể dùng lint làm cổng chất lượng. Nên xử lý theo batch: fix rule đơn giản trước, sau đó type hóa service layer, cuối cùng refactor hook patterns.

### P1 - Cookie domain helper bị duplicate và quá rộng

Files:

- `src/lib/supabase/middleware.ts:10`
- `src/app/api/auth/sign-in/route.ts:12`

Hai nơi đang tự tính cookie domain. Logic hiện tại với host `*.vercel.app` có thể trả `.vercel.app`, đây là domain public suffix không hợp lệ cho cookie. Production `onebiz.com.vn` vẫn đúng, nhưng preview/staging dễ có hành vi đăng nhập khó đoán.

Nên gom helper dùng chung, chỉ set domain cho `onebiz.com.vn` và `*.onebiz.com.vn`; localhost và Vercel preview để browser default domain.

### P1 - Auth fallback che lỗi dữ liệu thật

File: `src/lib/contexts/auth-context.tsx:64`

`loadUserData` catch lỗi DB rồi dựng fallback profile. Cách này giúp tránh crash trắng, nhưng với app vận hành thật, lỗi tenant/profile/branches nên hiện trạng thái lỗi có retry và log rõ thay vì để user vào UI với `tenantId: ""` hoặc quyền không đủ.

Nên tách 3 trạng thái: loading, authenticated-but-profile-error, ready. Trạng thái lỗi cần CTA "Tải lại / đăng xuất" và gửi telemetry.

### P1 - POS pages quá lớn, khó bảo trì và dễ regression

Files:

- `src/app/pos/page.tsx` - 3.720 dòng
- `src/app/pos/fnb/page.tsx` - 2.259 dòng
- `src/app/(main)/hang-hoa/ton-kho/page.tsx` - 710 dòng

POS Retail và F&B đã có nhiều hook/component con, nhưng page vẫn gom rất nhiều state, effect, keyboard shortcuts, print, payment, customer, draft, promotion, shift. Rủi ro là sửa một vùng dễ ảnh hưởng vùng khác.

Nên tách theo domain:

- `usePosCheckoutFlow`, `usePosDraftRecovery`, `useShiftGuard`, `usePromotionFlow`.
- `useFnbMenuLoader`, `useFnbTableFlow`, `useFnbCheckoutFlow`, `useFnbKeyboardShortcuts`.
- Container page chỉ compose layout và truyền props.

### P2 - Next/Sentry cần migration nhẹ

Build pass nhưng có cảnh báo:

- `middleware` file convention deprecated, nên migrate sang `proxy`.
- Sentry `disableLogger` deprecated, dùng `webpack.treeshake.removeDebugLogging`.
- Sentry `automaticVercelMonitors` deprecated, dùng `webpack.automaticVercelMonitors`.

Đây chưa phải lỗi release, nhưng nên xử lý sớm để tránh upgrade Next/Sentry sau này bị vấp.

### P2 - Chưa có GitHub Actions quality gate

Repo không thấy `.github/workflows`. Vercel build đang Ready, nhưng PR/local merge nên có gate tự động:

- `npm ci`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run test:run`
- `npm run build`

Sau khi lint xanh, bật gate để tránh nợ kỹ thuật quay lại.

## UI/UX & Responsive

### Tổng quan

Thiết kế đã đi đúng hướng operational SaaS: dense, có sidebar/header rõ, POS tập trung thao tác. Điểm còn thiếu để "mịn, tinh tế, chuyên nghiệp" hơn là giảm cảm giác nhạt/pale, tăng thứ bậc thông tin, và ổn định layout tablet.

### Quản lý kho

Điểm tốt:

- `Tồn kho` đã dùng server-side page + aggregate, phù hợp dữ liệu lớn.
- Có inline detail panel cho tồn chi nhánh và lịch sử xuất nhập.
- Filter/search/export/import đặt đúng ngữ cảnh.

Cần cải thiện:

- Header action nên wrap tốt hơn ở tablet; hiện `PageHeader` chuyển sang desktop action từ `md`, dễ chật ở 768px.
- Bảng cần sticky density control, column presets và trạng thái empty/error riêng cho "không có dữ liệu", "đang lọc", "lỗi tải".
- Cảnh báo tồn thấp nên có màu/priority nhất quán hơn thay vì chỉ text/badge.

### POS Retail

Điểm tốt:

- Có idempotency key, draft recovery, auto-save, shift guard, mixed payment.
- UI tập trung cashier, có multi-tab hóa đơn.

Cần cải thiện:

- Checkout phải atomic như P0.
- Page quá lớn, cần chia flow để giảm regression.
- Mobile/tablet nên có mode rõ: cashier desktop/tablet landscape là chính; mobile chỉ nên là hỗ trợ xem nhanh, không cố nhồi đầy POS desktop.
- Cần e2e smoke cho: mở ca, thêm hàng mock, đổi số lượng, lưu nháp, recover nháp, thanh toán mock, in lỗi.

### POS F&B

Điểm tốt:

- Header F&B, floor plan, cart, KDS và offline cache đã có nền tốt.
- F&B payment atomic hơn POS Retail.
- Có cache-first, lazy dialog, requestIdleCallback.

Cần cải thiện:

- Tenant/branch scope cho query/cache như P1.
- `sendToKitchen`, `transferTable`, `voidFnbInvoice` cần RPC transaction.
- Empty menu trên branch cần hiển thị nguyên nhân cụ thể: chưa có món F&B, chưa có nhóm, branch không được map menu, hoặc lỗi tải.
- Tablet/mobile nên có layout riêng: floor plan full, cart bottom sheet, search command palette; tránh desktop 3-column bị co.

### Thiết kế thị giác

Đề xuất thiết kế:

- Giảm nền blue-tint toàn app, chuyển base surface về neutral gần trắng, dùng xanh OneBiz làm accent hành động chính.
- Tăng contrast text phụ và disabled state; nhiều vùng hiện hơi mờ/pale.
- Chuẩn hóa radius 6-8px cho bảng/card/tool surfaces, giảm cảm giác "pill" ở nơi không cần.
- Header module nên có density cao hơn: title, branch, action chính, search, filter rõ thứ bậc.
- Empty state nên có copy theo nghiệp vụ, không chỉ "Không có dữ liệu".
- POS dùng dark chrome là hợp lý, nhưng phần body nên tăng contrast card/product để cashier nhìn nhanh dưới ánh sáng quán.

## Lộ trình Đề Xuất

### Đợt 1 - Ổn định nền trong 1-2 ngày

1. Fix cookie domain helper và gom dùng chung.
2. Scope tenant/branch cho POS F&B queries + IndexedDB cache.
3. Làm lint xanh ít nhất ở nhóm dễ sửa: unescaped entities, prefer-const, empty interface.
4. Thêm Playwright responsive smoke cho routes: `/hang-hoa/ton-kho`, `/pos`, `/pos/fnb`, `/pos/fnb/kds`.
5. Thêm GitHub Action nhưng có thể để lint allow-fail trong ngày đầu nếu cần.

### Đợt 2 - Data integrity cho POS/F&B

1. Tạo RPC `pos_complete_checkout_atomic`.
2. Tạo RPC cho `send_to_kitchen_atomic`, `transfer_table_atomic`, `void_fnb_invoice_atomic`.
3. Viết test service cho rollback/idempotency/concurrency.
4. Chạy Supabase migration trên staging trước, sau đó mới production.

### Đợt 3 - UI polish chuyên nghiệp

1. Làm lại token màu: neutral surfaces + OneBiz primary + status/module accents.
2. PageHeader responsive: desktop từ `lg`, tablet action overflow, search co giãn đúng.
3. Kho: column presets, density control, sticky summary/filter.
4. POS Retail: tách component/flow, tối ưu keyboard + cart.
5. POS F&B: tablet-first layout, cart bottom sheet mobile, empty states theo nguyên nhân.

## Có cần SQL Supabase ngay không?

Chưa cần chạy SQL ngay cho audit này. Nhưng để xử lý P0 đúng cách thì sẽ cần Supabase migration/RPC ở đợt 2. Khuyến nghị chạy theo thứ tự:

1. Viết migration RPC mới.
2. Test local/staging bằng mock hoặc database staging.
3. Deploy code gọi RPC mới.
4. Sau khi ổn định mới áp dụng production.

