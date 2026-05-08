# OneBiz - Đề xuất cải tiến thiết kế sản phẩm nội bộ

Ngày review: 08/05/2026  
Phạm vi: Quản lý kho, POS Retail, POS F&B local, trang đăng nhập production `fnb.onebiz.com.vn`  
Giới hạn: Không kiểm thử bảo mật, không pentest, không brute force, không thao tác dữ liệu thật.

## 1. Kết luận nhanh

OneBiz đã có nền tảng tính năng khá đầy đủ: kho có bộ lọc, KPI, bảng dữ liệu và panel chi tiết; POS Retail có luồng giỏ hàng, thanh toán, ca bán; POS F&B có cấu trúc order type, delivery, bếp và thanh toán. Điểm cần nâng cấp không nằm ở việc thêm thật nhiều UI, mà là làm cho sản phẩm bớt nặng thị giác, rõ thứ bậc, chuẩn responsive và có các trạng thái vận hành thông minh hơn.

Hướng tối ưu nhất:

1. Chuẩn hóa design tokens và component dùng chung trước: màu nền, border, radius, typography, action bar, KPI strip, empty state, status pill.
2. Sửa responsive theo từng thiết bị, đặc biệt mobile/tablet: không co màn hình desktop xuống mobile; POS mobile cần là flow riêng.
3. Tách các trạng thái vận hành thành UI rõ ràng: chưa chọn chi nhánh, chưa mở ca, mất kết nối, đang tải, không có dữ liệu, thiếu quyền.
4. Làm mới từng module theo tinh thần riêng: Kho = dense, sạch, ra quyết định nhanh; Retail POS = tốc độ, scan/search, checkout rõ; F&B POS = bàn, món, bếp, ca làm và giao hàng.

## 2. Nhận xét tổng quan UI/UX

### Điểm đang tốt

- Layout ERP hiện tại có đủ vùng làm việc: sidebar, header, bộ lọc, KPI, table, detail panel.
- POS Retail/F&B đã tách khỏi shell ERP, phù hợp ngữ cảnh thao tác nhanh.
- Kho dữ liệu có hướng đúng: product list, tồn kho, branch stock, movements, lots, UOM, audit trail.
- Đã có primitive tốt như `ListPageLayout`, `PageHeader`, `FilterSidebar`, `DataTable`, `SummaryCard`.
- POS F&B đã có các khối nghiệp vụ khá sâu: order type, customer, discount, coupon, free item, pre-bill, kitchen, delivery platform.

### Vấn đề chính

- Giao diện ERP hơi "xanh đều": nền, border, card, active state và skeleton cùng nghiêng về một sắc xanh nhạt, làm mỏi mắt và giảm thứ bậc.
- Typography có nhiều cỡ chữ quá nhỏ trong POS (`8px`, `9px`, `10px`, `11px`), tạo cảm giác chật và kém cao cấp.
- Mobile đang bị ảnh hưởng từ tư duy desktop: action row tràn ngang, KPI chiếm nhiều chiều cao, bảng dữ liệu/skeleton không phải pattern tốt cho mobile.
- Empty state còn yếu: nhiều màn hình hiện "không có sản phẩm/không tìm thấy" nhưng chưa hướng dẫn bước tiếp theo theo đúng vai trò.
- POS Retail chưa có "readiness state" rõ: chi nhánh, ca bán, quyền, kết nối, hàng đợi offline nên được gom thành một thanh trạng thái vận hành.
- POS F&B local bị kẹt loading skeleton trong lần review; cần có timeout/error state thay vì để người dùng nhìn skeleton vô hạn.
- `fnb.onebiz.com.vn` hiện redirect về đăng nhập generic ERP, chưa cho cảm giác đây là F&B POS riêng.

## 3. Design direction nên theo

OneBiz nên đi theo hướng "quiet professional operations": tinh gọn, chắc tay, nhiều thông tin nhưng không ồn ào. Sản phẩm nội bộ không cần hero/marketing; cần rõ ràng, nhanh, ít làm mỏi mắt và tạo niềm tin khi nhân viên thao tác nhiều giờ liên tục.

### Màu sắc

- Giảm nền xanh nhạt trên toàn app; chuyển sang neutral surface: `#f6f7f9`, `#ffffff`, border `#e5e7eb`.
- Giữ brand blue làm màu hành động chính, không dùng cho mọi vùng nền.
- Tạo semantic colors riêng:
  - Tồn kho thấp: amber.
  - Hết hàng/cảnh báo: red.
  - Đủ hàng/hoạt động tốt: green.
  - Đang xử lý/offline queue: blue/indigo.
  - Tạm khóa/ngừng bán: gray.
- Tránh hard-code màu riêng lẻ trong component, vì sẽ khó làm theme và dark/light sau này.

### Typography

- Đặt `letter-spacing: 0` cho UI text.
- Hạn chế chữ dưới `12px`; chỉ dùng `11px` cho metadata phụ, không dùng cho action/label quan trọng.
- Scale đề xuất:
  - Page title: 20-24px.
  - Section title: 16-18px.
  - Body/table: 13-14px.
  - Metadata: 12px.
- POS cần ưu tiên đọc nhanh: tên món/sản phẩm tối thiểu 14px, giá và tổng tiền 15-18px.

### Surface và spacing

- Card radius nên ổn định 8px; không nên mỗi nơi một radius.
- Giảm shadow xanh/ambient shadow; dùng border và subtle shadow ít hơn.
- Dùng full-width band/layout cho section, chỉ dùng card cho item lặp lại, modal, panel công cụ.
- Toolbar nên có height và wrapping rõ, tránh tràn ngang trên tablet/mobile.

## 4. Quản lý kho

### Hiện trạng quan sát

Màn hình `hang-hoa/ton-kho` và `hang-hoa` có cấu trúc đầy đủ: bộ lọc trái, header/action, search, KPI cards, table, inline detail. Desktop khá dùng việc, nhưng tablet bị chật toolbar và mobile bị đẩy action/KPI xuống quá nhiều chiều cao. Mobile hiện tại phù hợp "xem nhanh" hơn là thao tác bảng dữ liệu đầy đủ.

Dấu hiệu trong repo:

- `src/app/(main)/hang-hoa/ton-kho/page.tsx` dùng `ListPageLayout`, `FilterSidebar`, `ActiveFiltersBar`, `SummaryCard`, `DataTable` ở cùng page, cho thấy kiến trúc có primitive tốt nhưng page vẫn ôm nhiều responsibility.
- `src/app/(main)/hang-hoa/page.tsx` cũng dùng pattern tương tự, có nhiều detail tab và summary card. Đây là điểm tốt để chuẩn hóa sang một inventory shell dùng chung.

### Đề xuất desktop

- Chuyển KPI cards thành KPI strip gọn hơn:
  - Tổng SKU.
  - Giá trị tồn.
  - Sắp hết hàng.
  - Hết hàng.
  - Vượt định mức.
- Cho phép collapse filter sidebar và lưu trạng thái filter view.
- Table cần có pinned columns:
  - Mã hàng/tên hàng.
  - Tồn khả dụng.
  - Trạng thái.
- Thêm density toggle: `Compact / Comfortable`, vì quản lý kho có người cần quét nhiều dòng.
- Detail nên hiện ở side panel bên phải khi chọn row, thay vì mở rộng quá dài trong bảng:
  - Tồn theo chi nhánh.
  - Lot/hạn sử dụng.
  - Lịch sử nhập xuất gần nhất.
  - Định mức và đề xuất hành động.
- Thay badge chung bằng stock health pill:
  - `Hết hàng`, `Dưới định mức`, `Cần nhập`, `Ổn định`, `Dư tồn`.
- Empty state nên hành động được:
  - `Nhập tồn đầu kỳ`.
  - `Import danh sách hàng`.
  - `Bỏ bớt filter`.
  - `Tạo hàng hóa mới`.

### Đề xuất tablet

- Filter nên là drawer/side sheet, không chiếm cố định quá nhiều ngang.
- Header action nên gom secondary actions vào nút more menu.
- Search và active filters nên sticky trên đầu danh sách.
- Bảng tablet nên có pinned first column và horizontal scroll có chỉ báo rõ.
- KPI nên thành 2 hàng compact hoặc scroll ngang, không dùng card cao.

### Đề xuất mobile

Mobile kho không nên cố gắng hiển thị table. Nên có layout card/list:

- Top sticky:
  - Title.
  - Search.
  - Filter button có count.
  - More actions.
- KPI mini strip scroll ngang, mỗi KPI nhỏ và cao khoảng 56-64px.
- Inventory card mỗi dòng:
  - Tên hàng + mã hàng.
  - Chi nhánh/kho.
  - Tồn hiện tại, khả dụng, định mức.
  - Trạng thái màu.
  - Action nhanh: xem chi tiết, tạo phiếu nhập/xuất/kiểm kê.
- Bottom safe padding để không bị bottom nav che nội dung.
- Filter bottom sheet có sections rõ: chi nhánh, nhóm hàng, trạng thái tồn, lô/HSD, nhà cung cấp.

### Data flow/architecture

- Tách logic page thành hooks + components:
  - `useInventoryFilters`.
  - `useInventoryList`.
  - `InventoryKpiStrip`.
  - `InventoryTable`.
  - `InventoryMobileList`.
  - `InventoryDetailPanel`.
- Query state nên sync URL để share view và reload không mất bộ lọc.
- Data table nên nhận schema columns, cell renderer và responsive variant thay vì mỗi page tự ghép nhiều logic.

## 5. POS Retail

### Hiện trạng quan sát

POS Retail có bố cục đúng: header, category/product, cart/payment, mode tabs. Desktop có cảm giác đầy đủ tính năng, nhưng chrome tối và rất nhiều chi tiết nhỏ làm UI nặng. Mobile đang là bản thu nhỏ của desktop nên header chật, nhiều nút chen nhau, product area trống, cart bằng FAB.

Dấu hiệu trong repo:

- `src/app/pos/page.tsx` là file rất lớn và có inline `<style>` quanh dòng 1696.
- Cùng file có nhiều arbitrary font size `text-[8px]`, `text-[9px]`, `text-[10px]`, `text-[11px]`, đặc biệt ở header, payment, cart item và draft UI. Đây là nguyên nhân tạo cảm giác POS hơi chật và thiếu cao cấp.

### Đề xuất desktop

- Tạo `POSReadinessBar` trên đầu:
  - Chi nhánh.
  - Ca bán.
  - Kết nối.
  - Thiết bị/bản in.
  - Hàng đợi offline.
- Nếu chưa chọn chi nhánh, hiện màn hình chọn chi nhánh riêng, không để user vào POS trong trạng thái rỗng.
- Bố cục desktop nên có 3 vùng rõ:
  - Category rail 88-120px.
  - Product grid/list ở giữa.
  - Cart 420-480px, có sticky checkout footer.
- Giảm width cart quá lớn để product area còn đất.
- Product card nên có:
  - Tên sản phẩm.
  - Giá.
  - Tồn/available nếu cần.
  - Barcode/SKU nhỏ.
  - Trạng thái hết hàng/ngừng bán.
- Payment section nên là checkout step:
  - Giỏ hàng.
  - Khách hàng/khuyến mãi.
  - Thanh toán.
  - In hóa đơn.
- Các hành động phụ như giữ đơn, nhập barcode, chiết khấu nâng cao, ghi chú nên gom vào toolbar/more menu.

### Đề xuất tablet

- Tablet ngang: 2 pane product + cart, category thành chip ngang.
- Tablet dọc: product-first, cart drawer từ phải hoặc bottom sheet.
- Touch target tối thiểu 44px; không dùng button nhỏ 28-32px cho hành động hay dùng.
- Mode tabs nên thành segmented control gần checkout, không chiếm quá nhiều chrome.

### Đề xuất mobile

Mobile POS Retail nên là flow riêng:

1. Search/scan-first screen.
2. Product list/card grid đơn giản.
3. Floating cart summary: số lượng + tổng tiền.
4. Cart bottom sheet.
5. Checkout full-screen step.

Mobile header chỉ nên có:

- Chi nhánh/ca bán đang hoạt động.
- Search/scan.
- More menu.
- Cart summary.

### Visual polish

- Dark chrome có thể giữ, nhưng nên giảm độ nặng bằng nền navy/neutral ít bao phủ hơn và surface sáng hơn ở vùng thao tác.
- Giá tiền và tổng tiền cần là visual anchor lớn nhất.
- Selected state của category/mode/payment nên rõ nhưng không lòe loẹt.
- Empty product state nên nói rõ lý do:
  - Chưa chọn chi nhánh.
  - Chưa có bảng giá.
  - Filter không có kết quả.
  - Chưa đồng bộ sản phẩm.

### Technical UX cần sửa sớm

- Di chuyển inline `<style>` trong POS page sang CSS/module riêng để giảm rủi ro hydration và dễ maintain.
- Chuẩn hóa font size thay vì nhiều arbitrary class quá nhỏ.
- Trang thiếu quyền nên nói rõ người dùng cần quyền nào và liên hệ ai, không chỉ `Không có quyền truy cập`.

## 6. POS F&B

### Hiện trạng quan sát

Production `https://fnb.onebiz.com.vn` redirect về trang đăng nhập. Trang đăng nhập sạch, nhưng generic ERP, chưa có nhận diện F&B POS. Local `/pos/fnb` trong lần review bị dừng ở loading skeleton, nên cần thêm error/timeout state. Code F&B cho thấy module đã có nhiều flow đúng: F&B header, cart, order type, delivery, pre-bill, kitchen, payment, mobile cart FAB.

Dấu hiệu trong repo:

- `src/app/pos/fnb/page.tsx` trả về `FnbLoadingSkeleton` ở các nhánh loading quanh dòng 1645 và 1691.
- `src/app/pos/fnb/components/fnb-cart.tsx` dùng `HelpTip` trong nhiều vùng của cart; lần quan sát trước browser có cảnh báo nested button, nên nên kiểm tra lại cấu trúc trigger/help button.
- `src/app/pos/fnb/components/fnb-cart.tsx` đang có `DELIVERY_PLATFORMS` hard-code màu theo platform, nên chuyển sang token.
- `src/app/pos/fnb/components/fnb-header.tsx` đi đúng hướng với header sáng, nhưng mobile cần gom lại để không ăn quá nhiều chiều cao.

### Đề xuất production login

Trang đăng nhập F&B nên cho người dùng biết họ đang vào hệ điều hành bán hàng nhà hàng, không phải ERP chung:

- Đổi headline thành `ONEBIZ F&B POS`.
- Subcopy ngắn: "Đăng nhập để bán hàng, quản lý bàn, gửi bếp và thanh toán tại chi nhánh."
- Hiện status nhỏ:
  - Kết nối máy chủ.
  - Phiên bản/PWA.
  - Thiết bị này có thể cài đặt ứng dụng.
- Cho biết tài khoản thuộc doanh nghiệp nào sau khi nhập email/phone nếu backend cho phép.
- Giữ card đăng nhập gọn, nhưng thêm product identity và icon F&B nhẹ.

### Đề xuất POS F&B desktop

- Header hiện tại đi đúng hướng light/professional. Nên tách rõ 4 cụm:
  - Chi nhánh + ca.
  - Bàn/khu vực.
  - Search món.
  - Bếp/thiết lập/kết nối.
- Thêm `FnbReadinessBar` khi thiếu chi nhánh, chưa mở ca, mất kết nối, chưa đồng bộ menu.
- Category sidebar nên có số món đang có và số món hết hàng.
- Product card nên có cảm giác F&B hơn:
  - Ảnh món hoặc color thumbnail có icon.
  - Tên món 2 dòng.
  - Giá.
  - Badge combo/topping/hết món.
  - Nút thêm nhanh và nút tùy chỉnh.
- Empty menu nên có CTA theo vai trò:
  - Đồng bộ menu.
  - Tạo món.
  - Chọn chi nhánh.
  - Bỏ filter.

### Đề xuất cart F&B

Cart F&B là nơi có nhiều nghiệp vụ, cần làm gọn:

- Header cart chỉ giữ: order type, bàn/khách, tổng tiền.
- Ghi chú, mã giảm giá, free item, delivery fee, service charge đưa vào các section có collapse.
- Footer sticky có 2 hành động chính:
  - Gửi bếp/In bếp.
  - Thanh toán.
- Các hành động phụ: in tạm tính, tách/gộp, hủy món, khuyến mãi nâng cao nên vào more menu.
- Sửa nested button trong HelpTip/ghi chú để tránh lỗi accessibility và event focus.
- Màu delivery platform nên dùng token semantic thay vì hard-code từng hex.

### Đề xuất tablet/mobile F&B

- Mobile F&B cần ưu tiên theo ngữ cảnh:
  - Nếu bán tại chỗ: chọn khu vực/bàn trước.
  - Nếu takeaway/delivery: search món trước.
- Header mobile tối đa 2 hàng:
  - Hàng 1: chi nhánh/ca + more.
  - Hàng 2: search + cart.
- Cart là bottom sheet có snap points:
  - Collapsed: số món + tổng tiền.
  - Half: danh sách món.
  - Full: checkout/payment.
- Floor plan mobile nên là canvas/grid full screen, có filter khu vực và badge thời gian chờ.
- Tablet F&B nên có layout:
  - Left: floor/category.
  - Center: menu/order.
  - Right: cart, có thể ẩn/hiện.

### Loading/error state

Không nên để skeleton vô hạn. Quy tắc đề xuất:

- 0-2 giây: skeleton bình thường.
- 2-8 giây: hiện "Đang tải menu/chi nhánh/ca bán..." kèm step đang tải.
- Sau 8-12 giây: hiện recoverable state:
  - Thử lại.
  - Kiểm tra kết nối.
  - Chọn lại chi nhánh.
  - Tiếp tục chế độ offline nếu có cache.

## 7. Component nên tạo dùng chung

- `OperationalShell`: shell cho các màn hình nghiệp vụ nội bộ, có header/action/filter/content/detail.
- `ResponsiveActionBar`: desktop hiện button, tablet/mobile gom secondary vào menu.
- `KpiStrip`: thay thế card KPI cao, hỗ trợ horizontal scroll mobile.
- `StatusPill`: tokenized semantic status cho kho/POS/F&B.
- `DesignedEmptyState`: empty state có icon, lý do, primary action, secondary action.
- `InventoryMobileCard`: card tồn kho mobile.
- `InventoryDetailPanel`: panel chi tiết dùng chung cho hàng hóa/tồn kho.
- `POSReadinessBar`: chi nhánh/ca/kết nối/offline queue.
- `BranchRequiredState`: trạng thái bắt buộc chọn chi nhánh.
- `CheckoutActionFooter`: footer sticky cho cart retail/F&B.
- `CartBottomSheet`: pattern mobile POS.

## 8. Thứ tự ưu tiên triển khai

### P0 - Sửa những điểm làm sản phẩm kém mượt

1. POS F&B: thêm timeout/error state cho loading skeleton.
2. POS F&B: kiểm tra và sửa nested button trong cart HelpTip/ghi chú.
3. POS Retail: đưa inline style ra CSS/module, giảm risk hydration.
4. Mobile kho: thêm bottom safe padding và gom action row vào more menu.
5. Các trang chưa chọn chi nhánh/chưa mở ca/thiếu dữ liệu: hiện state rõ ràng thay vì để màn hình rỗng.

### P1 - Nâng cấp responsive và flow chính

1. Kho: thêm mobile card list và filter bottom sheet.
2. Kho: KPI strip compact và table pinned column.
3. POS Retail: mobile scan/search-first + cart bottom sheet.
4. POS Retail/F&B: readiness bar cho chi nhánh, ca, kết nối, offline queue.
5. F&B: thiết kế lại cart thành các section collapse và footer sticky.

### P2 - Làm mịn visual system

1. Chuẩn hóa color tokens, radius, shadow, typography.
2. Giảm nền xanh đều, tăng neutral surface.
3. Chuẩn hóa empty state, skeleton, status pill.
4. Token hóa delivery platform/status colors.
5. Tạo density mode cho các bảng ERP.

### P3 - Mockup/redesign có kiểm chứng

1. Tạo mockup route cho kho mới: `/mockup/inventory-polish`.
2. Tạo mockup route cho POS Retail mới: `/mockup/pos-retail-polish`.
3. Tạo mockup route cho POS F&B mới: `/mockup/fnb-polish`.
4. Test bằng viewport 1440, 1024/820, 390.
5. Chọn 1 flow pilot để migrate trước thay vì đổi toàn bộ một lần.

## 9. Kiến trúc frontend/service flow

### Điểm nên giữ

- App Router theo module là đúng.
- Các primitive ERP như `PageHeader`, `ListPageLayout`, `FilterSidebar`, `DataTable` nên tiếp tục làm nền.
- POS tách route riêng là hợp lý vì ngữ cảnh khác ERP.

### Điểm nên cải thiện

- Giảm page component quá lớn, đặc biệt POS Retail. Nên tách thành hooks + components theo domain.
- Tách UI state và business state:
  - UI: drawer, selected row, density, view mode.
  - Business: branch, shift, cart, pricebook, inventory availability.
  - Sync/network: loading, retry, offline queue.
- Query/filter state nên có contract rõ và sync URL với các màn hình list.
- POS state nên có state machine nhẹ:
  - `needsBranch`.
  - `needsShift`.
  - `ready`.
  - `offlineReady`.
  - `syncing`.
  - `blocked`.
- Skeleton/error/empty nên là một phần của service contract, không phải mỗi component tự xử lý.

## 10. Kết quả thiết kế mong muốn

Nếu làm đúng thứ tự, OneBiz sẽ có cảm giác:

- Kho: giống một công cụ điều hành tồn kho chuyên nghiệp, đọc nhanh, lọc nhanh, ra quyết định nhanh.
- POS Retail: giống một máy bán hàng tốc độ cao, ít nhiễu, chạm đúng, checkout rõ.
- POS F&B: giống một sản phẩm riêng cho nhà hàng/cafe, có bàn, món, bếp, ca làm và giao hàng được ưu tiên đúng mức.
- Toàn hệ thống: bớt "web admin mặc định", tinh tế hơn nhờ spacing, typography, status, empty state và responsive được thiết kế có chủ đích.
