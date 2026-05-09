# OneBiz current-state review

Ngày review: 08/05/2026  
Phạm vi: review sản phẩm, UI/UX, responsive, frontend/backend/data flow cho OneBiz ERP, POS Retail, POS F&B và KDS. Không thực hiện pentest hay thao tác tạo/thanh toán dữ liệu thật.

## 1. Tổng quan build hiện tại

OneBiz hiện là một Next.js 16 App Router app đơn, không phải monorepo. Ba bề mặt chính nằm trong cùng codebase:

- Admin ERP: `src/app/(main)`
- POS Retail: `src/app/pos`
- POS F&B: `src/app/pos/fnb`
- KDS bếp/bar: `src/app/pos/fnb/kds`

Backend/data layer chủ yếu dùng Supabase trực tiếp từ service layer ở `src/lib/services/supabase`. Một số nghiệp vụ quan trọng đã được đưa xuống Postgres RPC để đảm bảo tính đúng dữ liệu, đặc biệt:

- POS Retail checkout: tạo invoice, invoice_items, stock_movements, cash_transactions; đã có `client_session_id` chống tạo trùng.
- POS F&B payment: dùng RPC `fnb_complete_payment_atomic` để hoàn tất hóa đơn, trừ kho, phiếu thu và release bàn trong một transaction.
- KDS: polling + realtime Supabase cho `kitchen_orders`.

## 2. Hiện trạng live/local đã quan sát

### Admin dashboard

Đã đăng nhập được bằng tài khoản test và mở dashboard ở production/local. Giao diện hiện có:

- Header có app switcher, chọn chi nhánh, search global, nhập Excel, notification, user menu, dropdown bán hàng.
- Sidebar desktop có group module rõ hơn KiotViet-style cũ, có collapsed rail cho tablet.
- Mobile có bottom nav riêng và sheet menu.
- Dashboard có quick actions, KPI cards, chart doanh thu/trạng thái đơn, top sản phẩm, cảnh báo tồn, activity feed.

Vấn đề thấy ngay:

- Console warning Recharts lặp nhiều lần: `width(-1) and height(-1) of chart should be greater than 0`. Chart vẫn render nhưng đây là dấu hiệu chart mount khi container chưa đo được kích thước ổn định. Cần fix container/min-width/min-height hoặc defer render chart đến khi visible.
- Quick action `Sổ quỹ` trỏ `/tai-chinh/so-quy`, trong khi nav hiện có route chính `/so-quy`. Cần rà lại link sai route.
- UI dashboard khá ổn ở desktop, nhưng empty data nhiều số 0 khiến cảm giác sản phẩm chưa “sống”. Cần bổ sung empty-state có hướng dẫn hành động tiếp theo theo vai trò.

### POS Retail

Production từng mở được POS chrome, local bị guard quyền. Quan sát UI production cho thấy:

- POS có full-screen chrome riêng, top bar, branch selector, search F2, mở ca, nháp, shortcut, menu.
- Layout desktop chia category trái, product zone giữa, hóa đơn/cart/payment phải.
- Cart/payment đủ các phương thức tiền mặt, chuyển khoản, thẻ, hỗn hợp, coupon, discount, in bill.

Vấn đề thấy ngay:

- POS báo `Ngoại tuyến` dù dashboard vẫn load data. Cần xác định đây là network status thật, service worker/offline manager, hay Supabase request check sai.
- POS hiển thị `CN: Chọn chi nhánh` và sản phẩm = 0 trong khi admin header đang chọn `Kho Tổng`. Luồng branch giữa ERP và POS chưa đủ rõ. Cashier dễ bị kẹt vì không biết cần chọn chi nhánh bán hàng nào.
- Local route `/pos` bị `Không có quyền truy cập` với account admin, trong khi dashboard vào được. Cần kiểm tra mapping legacy role `admin` với RBAC `role_permissions`, đặc biệt permission `pos_retail.checkout`.
- File `src/app/pos/page.tsx` rất lớn (~3.7k lines). Logic UI, state orchestration, checkout, print, offline/recovery, keyboard shortcut đang dồn vào một page, rủi ro cao khi tiếp tục mở rộng.

### POS F&B

Code đã tách component tốt hơn Retail:

- Header riêng: `fnb-header.tsx`
- Product grid virtualized: `fnb-product-grid.tsx`
- Cart riêng: `fnb-cart.tsx`
- Table floor plan: `table-floor-plan.tsx`
- Payment/item/search/history dialogs
- State hook: `use-fnb-pos-state`

Điểm mạnh:

- Có virtualized product grid, phù hợp menu nhiều sản phẩm.
- F&B flow đúng nghiệp vụ hơn Retail: gửi bếp trước, thanh toán sau.
- Có tabs nhiều đơn, order type dine-in/takeaway/delivery, table floor plan, KDS, split bill, transfer table.
- Payment đã atomic ở RPC, đây là hướng đúng cho dữ liệu chính xác.

Vấn đề thấy ngay:

- `src/app/pos/fnb/page.tsx` vẫn lớn (~2.2k lines), đang ôm quá nhiều orchestration: load menu, table, promotion, shift, print, offline, dialogs, payment.
- `fnb-cart.tsx` cũng lớn (~891 lines), cần tách nhỏ các vùng: header/customer, order type, line items, discount/coupon, delivery platform, footer actions.
- F&B local route bị treo/compile nặng khi mở sau POS permission issue. Cần kiểm tra bundle/chunk và quyền RBAC trước khi test sâu bằng browser.
- Subdomain `fnb.onebiz.com.vn` bị redirect login riêng, session cross-subdomain chưa ổn trong lần mở browser. Code đã có cookie domain `.onebiz.com.vn`, nhưng cần test thật sau khi login trực tiếp FnB.

### KDS

KDS đã có dark mode riêng, polling 30s, realtime Supabase, filter trạng thái và station. Đây là hướng đúng cho màn hình bếp/bar.

Điểm cần chú ý:

- KDS cũng guard RBAC bằng `pos_fnb.view_orders`; cần đảm bảo role bếp/bar có quyền tối thiểu không bị kẹt.
- KDS hiện fetch detail từng order bằng `Promise.all(getKitchenOrderById)` sau list. Với nhiều order, đây có thể thành N+1 query. Nên cân nhắc service/RPC trả list + items trong một query.

## 3. Frontend/UX hiện trạng

Điểm tốt:

- Design system đã có token màu, typography, spacing, radius, shadow trong `docs/design-system.md`.
- Shared components khá đầy đủ: `DataTable`, `ListPageLayout`, sidebar, top nav, dialogs, report components.
- Admin responsive có baseline tốt: desktop sidebar, tablet rail, mobile bottom nav.
- POS/F&B đã có các affordance vận hành: phím tắt, shift, draft/recovery, offline bar, print.

Điểm cần cải thiện trước:

- Chuẩn hóa thông điệp lỗi/trạng thái trong POS: offline, chưa chọn chi nhánh, không có quyền, chưa mở ca cần chỉ rõ bước xử lý tiếp theo.
- Tách layout theo device rõ hơn: desktop/laptop, tablet, mobile. POS không nên chỉ “co lại”; tablet cần layout vận hành riêng.
- Giảm mật độ nút trên header admin/POS ở mobile/tablet; ưu tiên task chính theo vai trò.
- Empty state hiện còn thụ động. Nên biến thành guided action: tạo sản phẩm, chọn chi nhánh, mở ca, nhập tồn, tạo bàn, cấu hình menu.
- Cần audit toàn bộ arbitrary size trong UI. Design system đã ghi không dùng `text-[10px]`, `text-[11px]`, nhưng code còn nhiều nơi dùng.

## 4. Backend/data flow hiện trạng

Điểm tốt:

- Đa số service có tenant filter `.eq("tenant_id", tenantId)`.
- Có cache profile/context để giảm duplicate auth/profile fetch.
- Một số nghiệp vụ quan trọng đã atomic bằng RPC: F&B payment, stock increment/upsert, purchase receive, cash transactions.
- Có test service khá nhiều trong `src/__tests__`.

Rủi ro dữ liệu:

- POS Retail checkout vẫn nhiều bước client-side sau insert invoice. Dù có idempotency, nếu lỗi giữa invoice/items/stock/cash có thể để lại trạng thái không hoàn chỉnh hơn F&B atomic RPC. Nên đưa Retail checkout vào RPC atomic giống F&B.
- `products.stock` và `branch_stock` cùng tồn tại; cần quy định nguồn sự thật theo màn hình. POS nên luôn lấy branch_stock theo branch bán hàng.
- Branch context hiện chưa thật mượt giữa admin và POS. POS phải bắt buộc có branch bán hàng hợp lệ, không rơi vào “Chọn chi nhánh” im lặng.
- RBAC đang có cả `profiles.role` legacy và `role_permissions`; cần rule rõ: owner/admin fallback quyền thế nào nếu role_permissions thiếu.

## 5. Ưu tiên cải thiện giai đoạn đầu

### P0 - Làm app không kẹt luồng

1. Fix branch resolution cho POS Retail/F&B:
   - Nếu user có currentBranch hợp lệ và đúng type, POS dùng ngay.
   - Nếu branch type sai, hiển thị màn chọn chi nhánh có hướng dẫn.
   - Không để product list = 0 mà không giải thích.

2. Fix RBAC owner/admin/POS:
   - Owner luôn full quyền.
   - Admin role nếu chưa có role_permissions vẫn phải có default admin permissions hoặc có migration seed role.
   - Màn không quyền cần hiển thị permission code bị thiếu.

3. Fix offline indicator:
   - Tách trạng thái internet, Supabase reachable, offline queue.
   - Nếu chỉ một service fail thì không gọi chung là “Ngoại tuyến”.

4. Fix dashboard chart warning:
   - Đảm bảo chart parent có `min-w-0`, stable height.
   - Defer render chart tới khi container width > 0.

### P1 - Chuẩn hóa UI/UX ba device

1. Desktop/laptop:
   - Admin ưu tiên dense table/list, sticky filters, inline detail panel.
   - POS Retail giữ 3 vùng nhưng làm rõ branch/shift/network state.
   - POS F&B menu + cart rõ hierarchy hơn, giảm header clutter.

2. Tablet:
   - Admin dùng sidebar rail + main dense.
   - POS Retail/F&B nên có tablet layout riêng: product/menu full width, cart drawer/FAB, bottom action bar.
   - iPad landscape có thể giữ cart phải; portrait nên drawer.

3. Mobile:
   - Admin chỉ cho workflow nhanh: xem dashboard, tìm kiếm, thông báo, một số list quan trọng.
   - POS mobile cần ưu tiên scan/search/add item/payment, không cố nhồi layout desktop.
   - Touch target tối thiểu 44px cho cashier.

### P2 - Tách code để build tiếp nhanh hơn

1. Split `src/app/pos/page.tsx`:
   - `pos-shell`
   - `pos-product-zone`
   - `pos-cart`
   - `pos-payment-panel`
   - `pos-checkout-actions`
   - hooks riêng cho shift, promotions, checkout, keyboard shortcuts.

2. Split `src/app/pos/fnb/page.tsx`:
   - container page chỉ orchestration nhẹ
   - hooks: menu data, table data, shift, promotion, print, payment flow
   - cart subcomponents.

3. Chuẩn hóa shared state/event:
   - branch context
   - network/offline
   - shift lifecycle
   - print failure/retry

## 6. Kết luận nhanh

OneBiz đã có nền tảng khá đầy đủ: Next.js App Router, Supabase service layer, RBAC, PWA/offline, POS Retail, POS F&B, KDS, reports, design tokens. Điểm cần làm ngay không phải thêm tính năng lớn, mà là khóa lại các luồng nền: branch, permission, offline, atomic data, responsive layout.

Ưu tiên đầu tiên nên là: sửa POS không kẹt branch/quyền/offline, sau đó chuẩn hóa UI theo ba device, rồi mới tiếp tục mở rộng nghiệp vụ.
