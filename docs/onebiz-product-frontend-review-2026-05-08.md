# Review sản phẩm và frontend OneBiz - 08/05/2026

Phạm vi: review sản phẩm nội bộ trên repo local và mockup local. Không kiểm thử bảo mật, không dò lỗ hổng, không pentest, không brute force, không thao tác dữ liệu thật.

## Tóm tắt nhanh

OneBiz đã có nền khá tốt: một app Next.js App Router cho Admin ERP, POS Retail, POS F&B và KDS; service layer Supabase; RBAC; ngữ cảnh chi nhánh; offline queue; PWA; tài liệu design system; và bộ test Vitest khá rộng.

Rủi ro chính hiện không nằm ở thiếu tính năng, mà nằm ở độ mượt vận hành: một số trạng thái branch/shift/offline có thể làm POS trông như "không có dữ liệu" mà chưa chỉ rõ bước xử lý tiếp theo, dev console còn lỗi hydration/runtime, và các page POS đang quá lớn khiến thay đổi UX về sau dễ rủi ro.

Mốc ưu tiên đầu tiên nên là: ổn định cảnh báo runtime trên dashboard/POS, sửa link sai và HTML không hợp lệ, sau đó tách orchestration POS thành hook/component nhỏ trước khi mở rộng thêm nghiệp vụ.

## Màn hình đã xem

- Admin dashboard: `/`
- Mockup design system: `/mockup/design-system`
- POS Retail: `/pos`
- POS F&B: `/pos/fnb`
- Review tĩnh repo: `src/app`, `src/components`, `src/lib/services`, `src/lib/contexts`, `docs`

## Nhận xét UI/UX sản phẩm

### P0 - Lỗi nhìn thấy ngay hoặc có dấu hiệu runtime

1. Dashboard còn lặp warning Recharts khi test responsive.
   Console báo nhiều lần `width(-1) and height(-1) of chart should be greater than 0`. Chart vẫn render sau đó, nhưng đây là dấu hiệu container chart chưa có kích thước ổn định lúc mount. Nên thêm kích thước ổn định cho chart container, `min-w-0`/`min-h`, hoặc chỉ render chart khi đo được kích thước.

2. Quick action `Sổ quỹ` trên dashboard đang trỏ sai route.
   `src/app/(main)/page.tsx:269` link tới `/tai-chinh/so-quy`, trong khi navigation config đang dùng `/so-quy`. Đây là lỗi nhỏ nhưng nằm ngay màn hình đầu, nên sửa sớm.

3. POS Retail đang có hydration mismatch trong dev.
   Console chỉ về `src/app/pos/page.tsx`, quanh render top-level sau inline `<style>` tại `src/app/pos/page.tsx:1696`. Diff hydration cho thấy server/client tree đổi từ button sang POS header. Nên audit các nhánh client-only và chuyển rule style input number ra CSS/global class thay vì render `<style>` trong component tree.

4. POS F&B có nested button không hợp lệ.
   `src/app/pos/fnb/components/fnb-cart.tsx:232` render toggle ghi chú đơn là `<button>`, bên trong `HelpTip` lại render thêm một button tại `src/app/pos/fnb/components/fnb-cart.tsx:243`. HTML này không hợp lệ và React đã báo hydration risk. Nên đổi row toggle thành non-button wrapper, hoặc đưa tooltip trigger ra ngoài button.

### P1 - Làm rõ trạng thái vận hành

5. POS Retail có thể hiển thị `CN: Chọn chi nhánh`, danh mục 0 và vùng sản phẩm trống cùng lúc.
   Cashier vẫn thấy header, cart, payment method và shortcut, nhưng không rõ bước tiếp theo là gì. Nên thay empty state thụ động bằng màn chọn chi nhánh bắt buộc: "Chọn chi nhánh bán hàng để tải sản phẩm", kèm hint loại chi nhánh và một nút hành động chính.

6. POS F&B đã hiển thị branch và shift rõ hơn, nhưng `Không có sản phẩm nào` vẫn thiếu hướng dẫn setup.
   Khi branch chưa có menu/category, nên nói rõ nguyên nhân: "chi nhánh chưa có menu", "chưa mở ca", hoặc "không có quyền xem menu". Link sang cấu hình menu/category chỉ nên hiện với role có quyền.

7. Mobile dashboard dùng được, nhưng bottom nav che vùng nội dung phía dưới.
   Nên thêm bottom padding cho scroll container bằng chiều cao bottom nav cộng safe-area inset. Nút nổi `Bán` là hướng tốt, nhưng nội dung không nên bị khuất sau nó.

8. Desktop dashboard bố cục ổn nhưng cảm giác "trống" khi dữ liệu bằng 0.
   KPI card và chart nên chuyển từ số 0 thô sang guided action: nhập sản phẩm, tạo đơn đầu tiên, cấu hình tồn chi nhánh, mở POS, hoặc xem báo cáo mẫu.

### P2 - Chuẩn hóa theo design system

9. Tài liệu design system đã cấm nhiều size custom, nhưng code vẫn còn dùng nhiều.
   Ví dụ: `text-[10px]`, `text-[11px]`, `text-[9px]`, `h-9`, icon size nhỏ. POS và table dense là nơi lệch nhiều nhất. Việc này làm UI khó đồng nhất và responsive typography khó kiểm soát.

10. `DataTable` có nền desktop/tablet tốt, nhưng mobile card còn quá generic.
   `src/components/shared/data-table/data-table.tsx:481` chuyển sang mobile card view, nhưng đang render field chung chung theo visible cells. Với hóa đơn, sản phẩm, khách hàng, tồn kho, nên cho từng module định nghĩa mobile row summary riêng để người dùng scan nhanh.

## Nhận xét kiến trúc frontend

### Điểm mạnh

- App Router layout dễ hiểu: root providers, main layout, POS-specific layout.
- `AuthProvider` gom auth user, tenant, branches, current branch, permissions và branch switching.
- Service layer có đường đổi Supabase/mock rõ qua `src/lib/services/index.ts`.
- `src/lib/services/supabase/base.ts` có helper tenant/context, cache seeding, query timing và tenant filter khá hữu ích.
- Shared components đã có đúng nhóm primitive cần thiết: top nav, sidebar, mobile bottom nav, data table, dialogs, report components, inline detail panel, filter sidebar.
- Test coverage khá tốt: `npx vitest run` pass 42 files / 2550 tests.

### Rủi ro

1. POS Retail page quá lớn.
   `src/app/pos/page.tsx` dài 3727 dòng. File này đang ôm product browsing, cart, payment, shift, draft/recovery, offline checkout, keyboard shortcuts và printing. Mỗi thay đổi UX ở POS vì vậy dễ kéo theo rủi ro.

2. POS F&B đã tách tốt hơn, nhưng orchestration vẫn còn lớn.
   `src/app/pos/fnb/page.tsx` dài 2220 dòng, còn `src/app/pos/fnb/components/fnb-cart.tsx` dài 891 dòng. Nên tiếp tục tách đến khi page chủ yếu chỉ wire hooks và layout.

3. Lệch convention Next.js 16.
   `src/middleware.ts:4` vẫn export `middleware`. Next.js 16 khuyến nghị `proxy.ts`/`proxy()` cho routing middleware. Có thể vẫn chạy nhờ compatibility, nhưng nên đưa vào backlog trước khi upgrade framework làm nó đau hơn.

4. Typecheck đang bị chặn bởi output generated của Next dev.
   `npx tsc --noEmit` fail ở `.next/dev/types/validator.ts` dòng 297, nơi có ký tự `k` lạc trong generated output. Nên clean `.next` rồi chạy lại typecheck trước khi kết luận lỗi thuộc source app.

5. ESLint scope đang quá nhiễu.
   `npm run lint` quét cả `.claude/worktrees` và generated Supabase chunk files, nên báo hàng trăm lỗi/warning. Nên ignore generated/worktree trước; sau đó xử lý lỗi thật trong `src` như React 19 `set-state-in-effect`, `no-explicit-any`, empty interface.

## Nhận xét service/data flow

- Flow chính hiện là client component -> service trong `src/lib/services/supabase/*` -> Supabase table/RPC.
- Tenant context được cache và seed từ `AuthProvider`, tốt cho việc giảm duplicate profile fetch.
- `applyTenantFilter` và `getCurrentContext` là guardrail tốt, nhưng vẫn phụ thuộc vào việc service author dùng nhất quán.
- Offline state hiện dựa vào browser online/offline và số lượng queue IndexedDB. Nó chưa tách rõ "có internet nhưng Supabase không tới được" với "offline queue đang chờ", nên thông điệp cho cashier chưa đủ chính xác.
- Branch context là trục vận hành quan trọng. Với POS, branch nên được coi là domain state bắt buộc, không chỉ là filter kế thừa từ Admin.

## Roadmap đề xuất

### Sprint 1 - Ổn định runtime và navigation

- Sửa `/tai-chinh/so-quy` thành `/so-quy`.
- Sửa nested button trong help tip ghi chú đơn F&B.
- Chuyển inline style của POS Retail ra CSS và điều tra hydration mismatch.
- Thêm chart container ổn định cho dashboard.
- Thêm bottom padding/safe-area padding cho các scroll surface trên mobile.
- Thêm ESLint ignore cho `.claude/worktrees`, `.next`, và generated Supabase chunks.

### Sprint 2 - Làm POS tự giải thích trạng thái

- Thêm màn branch-required cho POS Retail và POS F&B.
- Tách nhãn network: mất internet, không tới server, queue đang chờ, sync lỗi.
- Làm empty state "không có sản phẩm/menu" theo role và có hành động cụ thể.
- Trang không có quyền nên hiển thị permission code bị thiếu để debug nội bộ.

### Sprint 3 - Giảm rủi ro triển khai POS

- Tách Retail POS thành `pos-shell`, `pos-product-zone`, `pos-cart`, `pos-payment-panel`, `pos-shortcuts`, và các hook cho shift, branch, checkout, draft, promotion, print.
- Tách F&B cart thành header/customer, note/order type, line items, discounts/coupons, totals, footer actions.
- Đưa checkout/payment orchestration ra sau hook/service boundary rõ ràng để UI component không ôm transaction detail.

### Sprint 4 - Siết design system

- Thêm lint rule hoặc script kiểm tra arbitrary typography/spacing/icon size bị cấm.
- Migrate POS trước, rồi shared table/nav, sau đó tới page ít traffic hơn.
- Thêm checklist visual review ngắn cho desktop 1440px, tablet 820px, mobile 390px trước khi merge UI work.

## Ghi chú verification

- Local server: `localhost:3000`
- Responsive đã xem: desktop 1440x900, tablet 820x1180, mobile 390x844
- `npx vitest run`: pass, 42 files / 2550 tests
- `npx tsc --noEmit`: bị chặn bởi generated `.next/dev/types/validator.ts`
- `npm run lint`: timeout sau khi báo nhiều issue; scope đang gồm `.claude/worktrees` và generated Supabase chunks
