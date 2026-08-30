# Master plan thiết lập sản phẩm F&B và Bảng giá

> Trạng thái: CEO đã duyệt năm quyết định nền ở mục 14. Phần F&B và Bảng giá đã
> được rà soát trên cả Web/POS; toàn bộ quyết định triển khai ở mục 23 đã được
> xác nhận. Migration
> nháp 00361/00362 đã tồn tại trong nhánh nhưng chưa chạy trên
> production; lần review plan này không tạo migration và không đổi dữ liệu.
> Ngày lập: 30/08/2026.

## 1. Mục tiêu

Một sản phẩm F&B chỉ có **một nơi thiết lập vận hành**, dù món có hay không có
size. Người quản trị không cần biết BOM cha, BOM variant, `bom_code`, bảng định
lượng hay RPC nào đang được dùng.

Màn hình phải trả lời được trong một lượt:

1. Món bán ở chi nhánh nào?
2. Có những size nào, size mặc định và giá bán là bao nhiêu?
3. Mỗi size dùng bao nhiêu nguyên liệu, theo đơn vị pha chế nào?
4. Mức đường/sữa/syrup/topping làm thay đổi giá và định lượng ra sao?
5. Giá vốn từng size/từng cấu hình cơ sở là bao nhiêu?
6. POS, phiếu bếp, thanh toán, trừ kho và hoàn kho sẽ nhận dữ liệu nào?

## 2. Điều đã học và điều không sao chép

### iPOS

- Menu, size, giá bán, cost nguyên liệu, COS và Recipe Sheet được liên kết trực
  tiếp; từ món có thể mở ngay công thức.
- Định lượng là lượng thực tế cho một phần bán, không chỉ là tỷ lệ trình bày.
- Bài học áp dụng: hiển thị **giá bán + giá vốn + công thức** trong cùng ngữ cảnh
  của phần bán.

Nguồn:

- https://ipos.vn/fnbreport1h2026-menu-recipe/
- https://ipos.vn/dinh-muc-nguyen-lieu/

### KiotViet Nhà hàng

- Quản lý menu tập trung; size/thuộc tính, topping, thành phần nguyên liệu và
  chi nhánh đều đi từ món.
- Phân biệt rõ topping thường, topping chế biến và topping sản xuất; mỗi loại có
  quy tắc trừ tồn riêng.
- Đơn vị quy đổi phải dựa trên đơn vị đã khai, không cho tạo tên trùng tùy tiện.
- Một topping có thể gắn nhiều món, tránh tạo bản sao.
- Bài học áp dụng: **một đối tượng, một cơ chế trừ kho**; tái sử dụng nhóm/lựa
  chọn; đơn vị chọn từ dữ liệu chuẩn.
- Giá nhiều chi nhánh được quản trị tại màn Bảng giá/Thiết lập giá riêng, có
  phạm vi chi nhánh, khách hàng và thời gian; không nhồi ma trận giá chi nhánh
  vào form thông tin của từng sản phẩm.

Nguồn:

- https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/fnb-thuc-don/topping/
- https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/fnb-thuc-don/danh-sach-mon-trong-thuc-don/
- https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/huong-dan-bar-cafe-nha-hang/quan-ly-bang-gia/
- https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/fnb-hang-hoa/thiet-lap-gia/

### Toast

- Items Database là nơi xem và quản lý menu, item, modifier trên nhiều location.
- Cùng một item/modifier có thể được dùng lại; chỉ tạo bản khác khi giá, định
  lượng hoặc quyền sở hữu thực sự khác.
- Hỗ trợ thuộc tính/giá theo location nhưng vẫn giữ dữ liệu gốc tập trung.
- Bài học áp dụng: **một sản phẩm gốc, nhiều phạm vi áp dụng hoặc phiên bản có
  chủ đích**, không nhân bản sản phẩm theo chi nhánh.

Nguồn:

- https://central.toasttab.com/articles/Knowledge/Using-the-Items-Database
- https://central.toasttab.com/articles/Knowledge/Location-Specific-Pricing-Master-Menu-Management-1492786563831
- https://central.toasttab.com/articles/Knowledge/Shallow-and-Deep-Copying-Menu-Items-and-Modifiers

### Starbucks

- Luồng chọn đồ uống đặt **size trước**, sau đó mới customize.
- Mỗi nhóm customize hiển thị rõ giá trị mặc định: loại sữa, số shot, số pump,
  topping; user thay đổi trên nền công thức chuẩn.
- Bài học áp dụng cho POS và màn setup: size là trục chính; modifier là thay đổi
  trên công thức của size, không phải một hệ size thứ hai.

Nguồn:

- https://www.starbucks.com/menu/product/413/hot
- https://about.starbucks.com/stories/2025/ways-to-customize-your-beverage-at-starbucks/

### Luckin Coffee

- Menu phụ thuộc cửa hàng phục vụ; ứng dụng ghi nhớ cấu hình đồ uống yêu thích
  và phục hồi ở lần đặt sau.
- Bài học áp dụng: chi nhánh là phạm vi hiệu lực; có thể phát triển mẫu cấu hình
  dùng lại sau khi luồng setup cốt lõi ổn định.
- Không có tài liệu công khai đủ chi tiết về màn quản trị công thức nội bộ, nên
  không suy diễn hoặc sao chép kiến trúc backend của Luckin.

Nguồn:

- https://investor.luckincoffee.com/static-files/b3e2a29b-7e43-4a34-b5e0-cfe24553efb5
- https://investor.luckincoffee.com/investor-relations

### FABi

- Tài liệu công khai xác nhận menu/hiển thị được cấu hình theo nhà hàng và kênh.
- Không có đủ tài liệu công khai về công thức theo size để dùng làm chuẩn kỹ
  thuật. Chỉ dùng để đối chiếu nguyên tắc phạm vi điểm bán.

Nguồn:

- https://ipos.vn/wp-content/uploads/2020/10/Tai-lieu-van-hanh_O2O_Web_Fabi_V2.0.pdf

## 3. Hiện trạng OneBiz

Nền dữ liệu hiện tại đúng hướng nhưng trải nghiệm bị chia:

| Phần | Nơi nhập hiện tại | Cách lưu hiện tại |
| --- | --- | --- |
| Món không size | Tab Công thức BOM | BOM của sản phẩm |
| Món có size | Tab Quy cách | Variant + BOM của từng variant |
| Mức đường chính xác | Công thức hoặc ma trận Quy cách | `bom_modifier_option_quantities` |
| Nhóm tùy chọn | Tab Tùy chọn F&B | Link sản phẩm/nhóm hàng |
| Chi nhánh bán | Tab Tùy chọn F&B | Chính sách menu sản phẩm |
| Chi nhánh công thức | Tab Công thức | `bom.branch_id`, một chi nhánh |
| Giá size | Tab Quy cách | `product_variants.sell_price` |
| Giá vốn | Hai cách hiển thị | UI, BOM cache, product/variant và báo cáo hiện còn nhiều đường đọc `cost_price` |

Nút Lưu đang gọi tuần tự nhiều lớp: sản phẩm, quy đổi đơn vị, modifier, BOM cha,
variant/BOM size và phạm vi menu. Vì vậy vẫn có trạng thái “sản phẩm đã lưu nhưng
phần X chưa lưu”. Đây là vấn đề hợp đồng lưu, không chỉ là vấn đề bố cục.

## 4. Kiến trúc thông tin đích

Giữ các tab chung của hàng hóa, nhưng thay ba tab BOM/Tùy chọn/Quy cách bằng một
tab **Thiết lập F&B**.

### Tab Thông tin

- Mã, tên, nhóm hàng, kênh bán, mô tả, hình ảnh.
- Đơn vị bán của món.
- Không chứa công thức hoặc quy đổi nguyên liệu.

### Tab Giá & trạng thái

- Giá niêm yết của món hoặc giá niêm yết theo size.
- Trạng thái kinh doanh.
- Chỉ hiển thị tóm tắt các Bảng giá đang chứa món và nút mở đúng màn **Bảng
  giá**; không sửa giá theo chi nhánh trong form sản phẩm.
- Giá theo chi nhánh tiếp tục dùng hệ thống Bảng giá hiện có; không tạo thêm
  bảng dữ liệu hoặc cơ chế giá thứ ba.

### Tab Thiết lập F&B

Một workspace cuộn dọc, theo đúng thứ tự nghiệp vụ:

1. **Phạm vi bán**
2. **Quy cách và giá bán**
3. **Công thức và giá vốn**
4. **Tùy chọn làm thay đổi món**
5. **Kiểm tra trước khi lưu**

Không dùng các tab con làm mất dữ liệu nháp. Các phần có thể thu gọn nhưng trạng
thái vẫn nằm trong cùng một form và một draft.

## 5. Mô hình thống nhất cho món có và không có size

### Món không size

- UI hiển thị một cột ảo **Mặc định**.
- Không tạo variant giả trong DB.
- Công thức vẫn là BOM sản phẩm như hiện tại.
- POS không hỏi size.

### Món có size

- Mỗi size là một `product_variant` và có đúng một BOM riêng.
- Bắt buộc đúng một size mặc định.
- Giá bán và giá vốn hiển thị ngay trên từng cột size.
- POS chọn size trước, sau đó mới hiển thị modifier phù hợp.

### Ma trận công thức chung

| Nguyên liệu | ĐVT pha chế | Mặc định hoặc Size M | Size L | Theo lựa chọn |
| --- | --- | ---: | ---: | --- |
| Cà phê | g | 16 | 22.9 | Cố định |
| Đường | g | 6 | 9 | Mức đường |
| Ly | cái | 1 | 1 | Cố định |

- ĐVT pha chế chỉ được chọn từ đơn vị tồn và các quy đổi đã khai của nguyên liệu.
- Dưới mỗi ô hiển thị lượng quy đổi về đơn vị tồn.
- Giá vốn F&B cập nhật tức thời từ **giá bán Retail** của thành phần và hệ số
  quy đổi; không đọc `cost_price` của thành phần.
- Không gõ mã BOM. Hệ thống sinh mã kỹ thuật; user chỉ thấy khi mở “Thông tin
  kỹ thuật”.

## 6. Tùy chọn và định lượng

### Nguyên tắc

- **Size** là variant, không đồng thời là modifier.
- **Mức đường/sữa/syrup** là modifier có định lượng chính xác theo món và size.
- **Topping chế biến** dùng BOM của topping.
- **Topping nhập sẵn** trừ trực tiếp SKU/NVL theo phần.
- **Mức đá/ghi chú pha chế** không trừ kho nếu không gắn nguyên liệu.
- Một lựa chọn không được vừa scale BOM vừa trừ thẳng một SKU.
- Tên lựa chọn là chữ hiển thị tự do, ví dụ **Bình thường**, **Ít ngọt**,
  **Không đường**. Không suy định lượng hoặc trạng thái mặc định từ tên này.
- `option_id` là định danh ổn định; tên hiển thị, lựa chọn mặc định và định lượng
  nguyên liệu là ba dữ liệu độc lập.

### Cách nhập

Khi dòng nguyên liệu chọn “Theo Mức đường”, bảng chi tiết mở ngay bên dưới:

| Lựa chọn | Mặc định hoặc Size M | Size L |
| --- | ---: | ---: |
| Không đường | 0 g | 0 g |
| Ít ngọt | 5 g | 7 g |
| Bình thường (mặc định) | 6 g | 9 g |
| Thêm ngọt | 7 g | 11 g |

Hệ thống không tự suy lượng từ tên hoặc từ món khác. Có thể có nút **Gợi ý theo
mức chuẩn** để điền nháp theo tỷ lệ do user chọn, nhưng user phải xác nhận và
được sửa từng ô trước khi lưu. Đổi tên lựa chọn không được làm đổi định lượng,
mặc định hoặc lịch sử đơn hàng.

## 7. Chi nhánh và công thức

Tách rõ hai khái niệm:

1. **Phạm vi bán:** chi nhánh nào nhìn thấy và bán được món.
2. **Phiên bản công thức:** tại chi nhánh đó dùng công thức nào.

Mô hình đề xuất:

- Mỗi món có một **công thức mặc định** dùng cho các chi nhánh đã chọn.
- Chỉ khi thực tế khác nhau mới tạo **phiên bản công thức chi nhánh**.
- Một phiên bản công thức có thể gán cho nhiều chi nhánh.
- Một chi nhánh bán món phải phân giải đúng một công thức cho mỗi size.
- Không cho hai phiên bản cùng hiệu lực trên một chi nhánh/size.
- Không nhân bản sản phẩm chỉ vì khác chi nhánh.

Điểm này cần một lớp assignment nhiều-nhiều mới hoặc mở rộng schema hiện có;
không ép `bom.branch_id` một giá trị phải giả vờ đại diện nhiều chi nhánh.

## 8. Hợp đồng lưu

### Yêu cầu bắt buộc

- Một nút **Lưu thiết lập F&B**.
- Server kiểm toàn bộ payload trước khi ghi.
- Variant, BOM, BOM item, định lượng option, modifier link và phạm vi chi nhánh
  cùng thành công hoặc cùng rollback.
- Không còn toast “đã lưu sản phẩm nhưng BOM lỗi”.
- Request có idempotency key để bấm lại không tạo BOM/variant trùng.
- Mọi bản ghi khóa theo tenant và quyền `products.edit`.

### Draft

- Chuyển section, thu gọn section hoặc chuyển tab chung không mất dữ liệu.
- Đóng popup khi có thay đổi phải cảnh báo.
- Draft lưu theo `tenant + product + user`, có version schema và hết hạn.
- Sau khi lưu thành công mới xóa draft.

## 9. Giá và giá vốn

- Giá bán của món không size lấy từ sản phẩm.
- Giá bán món có size lấy từ variant; sản phẩm cha phản chiếu giá size mặc định
  để danh sách và báo cáo cũ tiếp tục hoạt động.
- Giá vốn luôn do công thức tính; ô giá vốn trong setup F&B là chỉ đọc.
- Variant và sản phẩm cha được cập nhật giá vốn tính toán trong cùng giao dịch.
- Thay đổi đơn vị pha chế phải tính lại lượng tồn và giá vốn ngay, không đổi giá
  bán.
- Giá theo chi nhánh tiếp tục đi qua màn **Bảng giá** riêng; không trộn vào công
  thức và không sửa trực tiếp trong form sản phẩm.

### Giá thành phần Retail dùng tại quán F&B

- Ở chi nhánh quán, màn **Thành phần tại quán** đang hiển thị SKU kênh
  `retail`; đây không phải danh sách NVL thô. Cột hiện tại dùng `costPrice` dưới
  nhãn `Giá vốn` là sai góc nhìn vận hành.
- Cột này đổi thành **Giá vốn F&B** và lấy **giá bán Retail chung** của SKU
  thành phần (`sellPrice`), không lấy giá vốn gốc của SKU Retail, giá
  Shopee/Grab hoặc bảng giá theo khách hàng.
- Quy tắc nguồn giá là bắt buộc và duy nhất: **giá vốn món F&B = tổng giá bán
  Retail của các thành phần theo định lượng và quy đổi đơn vị**. Không fallback
  sang `costPrice` của thành phần.
- Dự toán giá vốn công thức F&B tại quán dùng cùng nguồn giá Retail sau khi quy
  đổi đúng đơn vị. Ví dụ thành phần bán theo Túi nhưng công thức dùng G thì giá
  một G được suy từ giá Retail của Túi và hệ số quy đổi đã khai báo.
- Khi thành phần được cấp/bán nội bộ cho quán, chứng từ chỉ snapshot đúng giá
  bán Retail đã áp dụng; chứng từ không tạo một nguồn giá vốn F&B khác.
- Báo cáo chi nhánh F&B dùng snapshot giá bán Retail để phản ánh hiệu quả quán.
  Báo cáo hợp nhất toàn công ty vẫn dùng giá vốn gốc và loại lãi nội bộ, tránh
  đội giá vốn toàn chuỗi.
- Đổi giá Retail về sau không được làm đổi giá vốn lịch sử của hóa đơn, phiếu
  bếp hoặc kỳ báo cáo đã chốt.

### Resolver giá vốn F&B riêng

Không dùng `resolve_sale_price` để tính giá vốn. Hai resolver có mục đích khác
nhau và phải được test độc lập:

- `resolve_sale_price`: xác định số tiền khách phải trả theo kênh, chi nhánh,
  size, nền tảng và Bảng giá.
- `resolve_fnb_component_cost`: xác định giá bán Retail chung của từng thành
  phần tại thời điểm tính, sau đó quy đổi về đơn vị tồn/pha chế.

Input tối thiểu của resolver giá vốn gồm tenant, branch, BOM/variant, material,
input quantity/unit, modifier exact quantity và thời điểm máy chủ. Output gồm
giá Retail gốc, hệ số quy đổi, lượng đã quy đổi, thành tiền và mã nguồn
`retail-list-price`.

Preflight phải thống kê mọi material đang dùng trong BOM F&B. Material không có
SKU Retail hợp lệ, không có giá bán Retail dương hoặc thiếu quy đổi đơn vị phải
hiện lỗi readiness và chặn lưu/bán; tuyệt đối không âm thầm dùng `cost_price = 0`
hay fallback sang giá vốn gốc.

Phạm vi sửa không chỉ ở danh sách Thành phần. P0 phải thay đồng bộ:

1. BOM editor và `per-size-recipe-matrix`.
2. `bom.cached_cost`, `bom_unit_cost` và đồng bộ cost của product/variant F&B.
3. Trigger/RPC chốt `invoice_items.unit_cost` cho hóa đơn F&B.
4. `stock_movements`/dòng tiêu hao BOM cần đủ snapshot thành phần để truy nguyên.
5. Báo cáo COGS theo BOM, lợi nhuận chi nhánh và báo cáo hợp nhất.

Schema đã có `stock_movements.unit_cost` và `invoice_items.unit_cost`, nên ưu
tiên ghi đúng hai cột này thay vì tạo bản sao. Dòng `bom_consume` ghi giá bán
Retail trên một đơn vị tồn của material; invoice item ghi tổng giá vốn F&B cho
một phần bán. Preflight quyết định có cần thêm `cost_source` và bảng breakdown
theo `invoice_item_id` hay không; nếu một hóa đơn có hai dòng cùng món nhưng
khác size/modifier thì bắt buộc snapshot phải phân biệt được từng dòng.

Snapshot mới áp cho giao dịch phát sinh sau cutover. Dữ liệu lịch sử thiếu
snapshot phải gắn nhãn **Ước tính theo giá hiện tại**; không backfill như thể đó
là giá thật nếu không có chứng từ nguồn đáng tin cậy.

### Bảng giá nhiều chi nhánh

OneBiz đã có `price_tiers`, `price_tier_items`, liên kết bảng giá mặc định trên
chi nhánh và khả năng lưu giá theo `variant_id`. Phần này được hoàn thiện trên
nền hiện có, không tạo bảng giá song song:

- **Bảng giá chung** là giá niêm yết đang lưu trên sản phẩm/variant và là nguồn
  fallback toàn hệ thống; không tạo thêm một bản sao toàn bộ giá chung.
- Một SKU vẫn là một sản phẩm; không nhân bản SKU khi chi nhánh có giá khác.
- **Bảng giá chi nhánh** là bảng ngoại lệ thưa: chỉ chứa SKU/size có giá khác
  giá chung. Cùng một bảng ngoại lệ có thể được nhiều chi nhánh sử dụng.
- Màn Bảng giá cho phép chọn một hoặc nhiều chi nhánh áp dụng và xem rõ chi
  nhánh nào đang dùng bảng đó.
- Trong một bảng giá, món có size hiển thị từng dòng/cột size; giá được lưu theo
  đúng `variant_id`.
- Cho phép sửa hàng loạt, nhân bản bảng giá, tìm theo món/size và đối chiếu với
  giá niêm yết.
- Một chi nhánh tại một thời điểm chỉ phân giải một bảng giá F&B ngoại lệ có
  hiệu lực. Thứ tự phân giải bắt buộc là: `giá SKU+size trong bảng chi nhánh` ->
  `giá SKU trong bảng chi nhánh` -> `giá niêm yết size` -> `giá niêm yết món`.
- SKU/size không nằm trong bảng chi nhánh mặc nhiên lấy giá chung; không yêu cầu
  copy lại toàn bộ menu vào mỗi bảng giá.
- POS lưu snapshot giá và nguồn giá đã áp dụng để hóa đơn cũ không đổi khi bảng
  giá được chỉnh về sau.
- Form sản phẩm chỉ có tóm tắt “Đang thuộc N bảng giá” và liên kết mở màn Bảng
  giá với bộ lọc sẵn theo SKU; không đặt ma trận chi nhánh trong popup sản phẩm.

`branches.price_tier_id` hiện chỉ biểu diễn được một bảng đang gán, không đủ cho
lịch tương lai và lịch sử. P0 cần lớp assignment riêng, ví dụ
`branch_price_tier_assignments`, gồm tenant, branch, tier, chế độ thời hạn,
`starts_at`, `ends_at`, trạng thái, người tạo và revision. Constraint/RPC phải
chặn hai khoảng hiệu lực F&B giao nhau trên cùng chi nhánh.

Dữ liệu `branches.price_tier_id` hiện có được chuyển thành assignment
`Không thời hạn`. Trong giai đoạn tương thích, resolver mới đọc assignment trước
và chỉ fallback cột cũ cho bản ghi chưa chuyển; không duy trì hai đường ghi lâu
dài. Sau UAT mới khóa đường ghi cũ và giữ cột chỉ để rollback có kiểm soát.

Khi tạo một bảng có thời hạn bắt đầu trong tương lai trong lúc assignment hiện
tại đang `Không thời hạn`, UI/RPC phải yêu cầu thao tác **Thay thế từ thời điểm
này** và kết thúc assignment cũ ngay trước mốc mới trong cùng transaction. Không
cho user tự tạo hai khoảng chồng nhau rồi dựa vào `priority` để đoán bảng thắng.

### Phân quyền và kiểm soát giá

- Owner/Chủ doanh nghiệp được quyền theo cơ chế bypass hiện có.
- Admin hoặc vai trò tùy chỉnh chỉ được tạo, sửa, nhân bản, gán chi nhánh, nhập
  Excel hoặc xóa Bảng giá khi có `products.manage_prices`.
- `products.edit` không đủ để sửa Bảng giá; quyền sửa giá tại POS
  `pos_fnb.edit_price` cũng không cấp quyền quản trị Bảng giá.
- UI ẩn/khóa lệnh không đủ: mọi RPC ghi Bảng giá phải kiểm lại tenant và
  `user_has_permission(..., 'products.manage_prices')` trong database.
- Gán Bảng giá cho chi nhánh đồng thời cần quyền quản lý giá; không dùng quyền
  quản lý chi nhánh để đi vòng sửa giá.
- Mọi thay đổi ghi audit gồm người sửa, thời điểm, bảng giá, phạm vi chi nhánh,
  SKU/variant, giá cũ, giá mới và lý do khi sửa hàng loạt.
- Nhân viên POS chỉ nhận giá đã phân giải; không thấy công cụ quản trị Bảng giá.
- Tổng/chi tiết Giá vốn F&B chỉ trả về và hiển thị khi có
  `products.view_cost`. User có `products.edit` nhưng thiếu quyền xem giá vốn
  vẫn sửa được định lượng, nhưng server không trả breakdown tiền.

### Kế hoạch hoàn thiện Bảng giá

1. **Read model:** dựng màn hình gồm Bảng giá chung và các bảng ngoại lệ, hiển
   thị chi nhánh áp dụng, số SKU/size khác giá và ngày cập nhật cuối.
2. **Editor ngoại lệ:** ma trận sản phẩm/size, tìm kiếm, lọc nhóm hàng, thêm/xóa
   dòng ngoại lệ, sửa hàng loạt và so sánh trực tiếp với giá chung.
3. **Phạm vi chi nhánh:** chọn nhiều chi nhánh cho một bảng; cảnh báo trước khi
   chuyển chi nhánh khỏi bảng cũ và không cho hai bảng F&B cùng hiệu lực.
4. **RPC nguyên tử:** lưu item giá + assignment chi nhánh trong một giao dịch,
   kiểm `products.manage_prices`, tenant, variant thuộc đúng sản phẩm và chống
   trùng `(price_tier_id, product_id, variant_id, min_qty)`.
5. **Resolver và audit:** dùng đúng chuỗi fallback, snapshot giá vào hóa đơn,
   ghi nguồn `common/branch-tier`, audit thay đổi và contract test POS F&B.

Các bước trên dùng `price_tiers`, `price_tier_items`, giá product/variant và
chuyển dần `branches.price_tier_id` sang assignment thời hạn. Chỉ thêm schema
sau preflight cho assignment, unique constraint, RPC hoặc trường audit cần
thiết; không tạo một hệ thống Bảng giá thứ hai.

## 10. POS, bếp, kho và in

### POS

- Chọn món -> chọn size (nếu có) -> chọn modifier.
- Tự chọn size và modifier mặc định nhưng hiển thị rõ, cho phép đổi.
- Chỉ hiển thị món tại chi nhánh đang đăng nhập.
- Nếu chi nhánh không phân giải được công thức thì chặn bán trước khi gửi bếp.

### Phiếu bếp/KDS

- Snapshot tên món, size, lựa chọn và định lượng vận hành tại thời điểm đặt.
- In size và các lựa chọn khác mặc định khi chúng ảnh hưởng pha chế.
- Thứ tự nhóm ổn định: size, nhiệt độ/đá, mức ngọt, sữa/syrup, topping, ghi chú.

### Kho

- Thanh toán trừ BOM đúng size, đúng option, đúng chi nhánh.
- FIFO, movement và branch stock dùng cùng `branch_id` hóa đơn.
- Trả/hủy hoàn đúng snapshot đã trừ, không đọc công thức mới rồi hoàn sai.
- Không có hai movement cho cùng một hiệu ứng lựa chọn.

## 11. Responsive và khả năng thao tác

### Desktop

- Ma trận nguyên liệu × size hiển thị đầy đủ.
- Cột tên nguyên liệu và ĐVT cố định khi cuộn ngang.
- Tổng giá vốn cố định ở cuối mỗi cột size.

### Tablet

- Giữ ma trận nhưng cho cuộn ngang có chỉ báo rõ.
- Thanh Lưu/Hoàn tác cố định phía dưới, không che nội dung.

### Mobile

- Không ép ma trận rộng vào màn hình.
- Chọn một size bằng segmented control, sau đó sửa công thức size đó.
- Chuyển size không mất draft; có chỉ báo size nào còn lỗi.

## 12. Roadmap triển khai

Mục 12 mô tả workstream **Thiết lập sản phẩm F&B**. Thứ tự phát hành tổng thể
giữa F&B, Bảng giá, POS và báo cáo được khóa tại mục 20; khi hai mục khác nhau,
mục 20 là release gate ưu tiên cao hơn.

### Pha 0 - Chốt quyết định nghiệp vụ

- CEO đã duyệt năm điểm ở mục 14.
- Không thay đổi production.

### Pha 1 - Domain model và read adapter

- Tạo `FnbProductSetupDraft` thống nhất cho món một cỡ/nhiều cỡ.
- Adapter đọc BOM cha thành cột ảo Mặc định và BOM variant thành cột size.
- Adapter đọc modifier, exact quantities, UOM, menu scope và cost.
- Test dữ liệu cũ mở lên không đổi nghĩa.
- Định nghĩa resolver giá bán dùng chung cho POS/preview và adapter resolver giá
  vốn F&B từ Retail; không để mỗi màn tự chọn nguồn/fallback khác nhau.

### Pha 2 - Workspace UI trên Preview

- Xây `FnbProductSetupWorkspace` thay cho ba bề mặt rời rạc.
- Chưa xóa tab cũ; bật bằng feature flag trên Preview.
- Kiểm desktop/tablet/mobile và draft persistence.
- Hoàn thiện màn Bảng giá riêng: phạm vi nhiều chi nhánh, món/size, fallback và
  liên kết lọc từ sản phẩm. Không đưa editor giá chi nhánh vào workspace F&B.

### Pha 3 - RPC lưu nguyên tử

- Preflight schema read-only.
- Migration bổ sung assignment công thức nhiều chi nhánh theo quyết định đã
  duyệt ở mục 14; chỉ viết sau preflight schema/dữ liệu.
- RPC validate toàn payload rồi lưu setup F&B trong một transaction.
- RLS/permission/tenant guard và idempotency.
- RPC Bảng giá riêng kiểm `products.manage_prices`, lưu assignment nhiều chi
  nhánh và item SKU/variant nguyên tử, kèm audit trước/sau.
- Rollback script và postflight read-only.

### Pha 4 - Nối luồng thực tế

- Danh sách sản phẩm và popup sửa đọc workspace mới.
- POS chọn size trước modifier.
- KDS/in bếp nhận snapshot thống nhất.
- Thanh toán, trả hàng, FIFO và stock movement giữ logic hiện hành nhưng test lại
  bằng contract mới.

### Pha 5 - UAT lát cắt dọc

Chỉ dùng bốn mẫu:

1. Hồng Trà không size, có mức đường chính xác.
2. Xưởng Gu Việt M/L, công thức phi tuyến theo size.
3. Một topping chế biến có BOM.
4. Một món dùng chung nhiều chi nhánh, có một override công thức.

Mỗi mẫu phải qua POS -> bếp -> thanh toán -> kho -> trả hàng -> báo cáo.

### Pha 6 - Chuyển đổi và dọn giao diện

- Khi UAT đạt mới bỏ ba bề mặt setup cũ.
- Không xóa dữ liệu BOM/variant cũ.
- Cập nhật checklist vận hành và hướng dẫn nhập hàng loạt.
- Nhân dữ liệu theo từng nhóm món, không nhập toàn bộ cùng lúc.

## 13. Tiêu chí nghiệm thu

- User không cần biết món có size phải vào tab khác.
- Món không size và có size dùng cùng một component công thức.
- Không thể lưu hai default hoặc không có default khi size bắt buộc.
- Không thể chọn đơn vị ngoài hệ quy đổi của nguyên liệu.
- Giá vốn danh sách, popup và POS cùng một nguồn tính.
- Chuyển section/tab/thiết bị không mất draft.
- Một lần lưu không để lại dữ liệu một phần.
- Một sản phẩm dùng được nhiều chi nhánh mà không nhân bản SKU.
- SKU/size không có ngoại lệ chi nhánh luôn nhận đúng giá chung.
- User chỉ có `products.edit` không thể sửa/gán Bảng giá; Owner hoặc user có
  `products.manage_prices` mới thực hiện được.
- Lịch sử hóa đơn giữ nguyên giá đã bán sau khi Bảng giá thay đổi.
- Mỗi chi nhánh/size phân giải đúng một BOM.
- POS, KDS, in, thanh toán, kho và hoàn trả khớp cùng snapshot.
- Món cũ không size tiếp tục bán như trước.

## 14. Năm quyết định CEO đã duyệt

1. **Tên và cấu trúc:** dùng một tab `Thiết lập F&B` gồm Phạm vi bán -> Quy cách
   -> Công thức -> Tùy chọn -> Kiểm tra. Trạng thái: **đã duyệt**.
2. **Chi nhánh:** một công thức mặc định, chỉ tạo override khi khác; một override
   gán được nhiều chi nhánh. Trạng thái: **đã duyệt**.
3. **Giá:** giá niêm yết theo size nằm trong Thiết lập F&B; giá theo chi nhánh
   quản trị tại màn Bảng giá riêng như cơ chế OneBiz đang có, không tạo cơ chế
   giá thứ ba. Trạng thái: **đã duyệt sau điều chỉnh**.
4. **Tên và gợi ý định lượng:** tên lựa chọn do user tự nhập như Bình thường/Ít
   ngọt; mặc định và số gram lưu riêng. Nút gợi ý chỉ tạo nháp từ mức chuẩn,
   không tự lưu. Trạng thái: **đã duyệt sau điều chỉnh**.
5. **Giá vốn F&B:** tổng giá vốn món F&B bắt buộc lấy giá bán Retail của các
   thành phần theo định lượng và quy đổi đơn vị; không lấy hoặc fallback
   `cost_price` của thành phần. Trạng thái: **đã duyệt**.

Workstream giao diện F&B chỉ bắt đầu trên domain thống nhất này và sau các gate
P0 liên quan ở mục 20. Không tạo thêm luồng setup sản phẩm hoặc luồng giá song
song.

## 15. Kết quả rà soát Web và POS ngày 30/08/2026

| Bề mặt | Đã có | Khoảng trống phải xử lý |
| --- | --- | --- |
| Bảng giá | CRUD tier, thêm đơn/hàng loạt, chỉnh %, nhân bản; giá chung đã nằm ở product/variant | Chưa có chế độ xem Giá chung thống nhất, phạm vi chi nhánh trực quan, lịch sử và lưu nguyên tử |
| Dữ liệu giá | `price_tier_items` hỗ trợ SKU, variant, `min_qty` | Chưa có unique key, assignment có thời hạn và audit chuyên biệt |
| Chi nhánh | `branches.price_tier_id`, nhiều chi nhánh có thể trỏ cùng tier | Đang gán ở form chi nhánh; RPC chỉ kiểm `system.manage_branches`, chưa bắt quyền giá |
| Điều hướng | Có `/hang-hoa/thiet-lap-gia` và overview `/cai-dat/bang-gia` | Hai lối vào dễ hiểu thành hai hệ thống; nav chưa khóa `products.manage_prices` |
| POS F&B món thường | Tier chi nhánh override giá món cha, fallback giá niêm yết | Chỉ áp phía browser; gửi bếp chưa tái phân giải giá authoritative |
| POS F&B món có size | Variant và giá size đã được load | Tier theo `variant_id` chưa được áp vào popup size dù backend đã hỗ trợ |
| POS Retail | Có lớp kiểm giá phía server theo khách/tier/variant | Chưa dùng chung resolver với F&B nên hai POS có thể lệch quy tắc |
| Gửi bếp/thanh toán | `kitchen_order_items.unit_price` và hóa đơn giữ snapshot | Snapshot chưa lưu rõ nguồn giá/tier; giá gửi bếp có thể xuất phát từ client |
| Khuyến mãi | Server tính lại benefit khi thanh toán | Cần cố định thứ tự giá nền -> modifier -> khuyến mãi/coupon |
| Giá nền tảng | Có giá Shopee/Grab riêng | Cần quy định rõ ưu tiên so với bảng giá chi nhánh và test variant |
| Giá nền tảng theo size | `product_platform_prices` hiện chỉ có `product_id`, không có `variant_id` | Đã duyệt mở rộng `variant_id`; cần migration/RPC/UI và resolver fallback đúng thứ tự |
| Phân quyền | Đã có `products.manage_prices` | Trang/service/RLS giá chưa sử dụng nhất quán quyền này |
| Audit | Có `audit_log` chung | CRUD giá hiện chưa ghi before/after bắt buộc trong cùng transaction |
| Giá vốn F&B | Có BOM cache, cost product/variant và `invoice_items.unit_cost` | Các đường hiện chủ yếu đọc `cost_price`; chưa dùng thống nhất giá bán Retail và snapshot thành phần |

Kết luận: nền dữ liệu có thể tái sử dụng, nhưng chưa được xem là hoàn thiện vì
đường tiền trên POS F&B chưa thống nhất cho variant và chưa đủ server authority.

## 16. Hợp đồng giá chuẩn toàn hệ thống

### Các lớp giá

1. **Giá chung:** `products.sell_price` cho món không size và
   `product_variants.sell_price` cho từng size.
2. **Giá chi nhánh:** dòng ngoại lệ trong `price_tier_items`; bảng được gán qua
   `branches.price_tier_id`.
3. **Giá nền tảng giao hàng:** cấu hình Shopee/Grab hiện có, chỉ áp khi tab đơn
   chọn đúng nền tảng.
4. **Phụ thu lựa chọn:** giá topping/modifier được cộng sau giá món/size.
5. **Khuyến mãi/coupon/chiết khấu:** tính sau khi đã có giá bán và phụ thu hợp
   lệ; không ghi ngược vào Bảng giá.
6. **Sửa giá thủ công tại POS:** ngoại lệ có quyền riêng, lý do và audit; không
   được biến thành giá niêm yết hoặc giá chi nhánh.

### Resolver giá bán duy nhất

Tạo một hợp đồng `resolve_sale_price` dùng chung cho Preview, POS Retail, POS
F&B, kiểm tra trước gửi bếp và báo cáo đối chiếu. Input tối thiểu:

- tenant, branch, channel, delivery platform;
- product, variant, quantity;
- customer khi kênh Retail cần bảng giá khách hàng;
- thời điểm máy chủ.

Kết quả phải gồm:

- `unit_price`, `list_price`, `source`;
- `price_tier_id`, `price_tier_item_id` nếu có;
- `product_id`, `variant_id`, quantity threshold;
- thời điểm/phiên bản giá được phân giải.

### Thứ tự phân giải

**POS F&B trực tiếp:** giá variant trong tier chi nhánh -> giá món trong tier
chi nhánh -> giá chung variant -> giá chung món.

**POS F&B nền tảng:** giá nền tảng đang cấu hình -> tier chi nhánh -> giá chung.
Đây là cách giữ hành vi hiện tại; trước khi mở giá nền tảng theo từng chi nhánh
phải có quyết định nghiệp vụ riêng.

Với món có size, resolver không được dùng một giá product-level cho mọi size một
cách âm thầm. Thứ tự đã duyệt: giá nền tảng variant -> giá nền tảng product ->
tier chi nhánh variant -> tier chi nhánh product -> giá chung variant -> giá
chung product.

**POS Retail:** tier khách hàng -> giá chung variant -> giá chung sản phẩm, giữ
nghĩa hiện tại nhưng chuyển sang cùng resolver.

Mọi fallback phải trả cả nguồn; không được chỉ trả một con số khiến POS và audit
không biết giá đến từ đâu.

Giá phân giải của món F&B đang bật bán phải lớn hơn 0. Giá 0 chỉ được tồn tại ở
SKU nháp/chưa sẵn sàng; bán miễn phí phải đi qua chính sách khuyến mãi hoặc sửa
giá có quyền và audit, không tạo ngoại lệ Bảng giá 0 để đi vòng kiểm soát.

## 17. Master plan giao diện quản trị giá

### Một nơi quản trị chính

- `/hang-hoa/thiet-lap-gia` là màn Bảng giá chính duy nhất.
- `/cai-dat/bang-gia` chỉ redirect hoặc hiển thị liên kết ngắn; không duy trì
  một overview có logic riêng.
- Menu gọi thống nhất là **Bảng giá**, có permission rõ ràng.

### Ba chế độ xem

1. **Giá chung:** bảng dày, tìm/lọc theo mã, tên, nhóm và kênh; món có size mở
   các dòng M/L; sửa hàng loạt nhưng vẫn theo quyền quản lý giá.
2. **Giá chi nhánh:** danh sách bảng ngoại lệ, chi nhánh áp dụng, số dòng khác
   giá, trạng thái/thời gian hiệu lực và người cập nhật cuối.
3. **Lịch sử thay đổi:** lọc theo bảng giá, chi nhánh, SKU/size, người sửa và
   thời gian; xem before/after và lý do.

### Editor bảng ngoại lệ

- Header: tên, mã, kênh, trạng thái, thời gian hiệu lực, các chi nhánh áp dụng.
- Bảng: SKU, tên, size, giá chung, giá riêng, chênh lệch tiền và %, hiệu lực.
- Chỉ thêm dòng khác giá; có lệnh **Trả về giá chung** để xóa ngoại lệ.
- Chọn nhiều dòng để tăng/giảm số tiền hoặc %, nhưng phải preview trước khi lưu.
- Tìm kiếm và nhập Excel theo SKU + size; dòng lỗi không được ghi âm thầm.
- Cảnh báo nếu bảng không còn chi nhánh, chi nhánh đang dùng bảng khác hoặc
  variant đã ngừng hoạt động.
- Không dùng card lồng nhau; desktop dùng bảng, mobile dùng từng SKU với size
  thu gọn và thanh Lưu cố định.

### Liên kết từ sản phẩm và chi nhánh

- Popup sản phẩm chỉ hiển thị giá chung và badge “Có N bảng giá riêng”; nút mở
  Bảng giá đã lọc theo SKU, không sửa giá chi nhánh tại đây.
- Form chi nhánh chỉ hiển thị bảng đang áp dụng và link sang Bảng giá; thay đổi
  assignment phải qua RPC quản lý giá.
- Thiết lập F&B vẫn quản lý size/công thức/định lượng, không quản lý giá chi
  nhánh.

## 18. Phân quyền, RPC và audit

### Quyền giao diện

- `products.view`: xem giá chung và giá đang áp dụng nếu vai trò được phép xem
  danh mục; không có lệnh thay đổi.
- `products.manage_prices`: tạo/sửa/xóa/nhân bản/import/export, đổi hiệu lực và
  gán bảng cho chi nhánh.
- Owner bypass theo hệ thống hiện có.
- `products.edit`, `system.manage_branches` hoặc `pos_fnb.edit_price` đứng riêng
  không đủ để quản trị Bảng giá.

### Quyền máy chủ

- Thu hồi ghi trực tiếp từ browser vào `price_tiers` và `price_tier_items` sau
  khi RPC mới hoạt động.
- RPC security definer kiểm auth, active profile, tenant,
  `products.manage_prices`, product/variant ownership và branch scope.
- RPC gán tier nhiều chi nhánh khóa các branch liên quan `FOR UPDATE`, thay item
  và assignment trong một transaction.
- Assignment thời hạn dùng UTC trong database, hiển thị theo timezone tenant;
  `Không thời hạn` có `ends_at = null`. RPC kiểm `starts_at < ends_at`, chặn
  khoảng giao nhau và dùng thời gian máy chủ, không tin đồng hồ browser.
- Unique key chống trùng `(price_tier_id, product_id, variant_id, min_qty)`;
  chuẩn hóa `variant_id null` bằng constraint/index phù hợp PostgreSQL.

### Audit bắt buộc

- Ghi cùng transaction, không dùng helper best-effort phía browser.
- `entity_type`: `price_tier`, `price_tier_item`, `branch_price_assignment`.
- Lưu old/new, reason, actor, tenant, branch IDs, SKU/variant và batch ID.
- Sửa hàng loạt có một batch header và chi tiết từng dòng để vừa đọc nhanh vừa
  truy nguyên được.

## 19. POS F&B và tính toàn vẹn tiền

### Trước khi thêm món

- Menu món thường hiển thị giá đã resolve theo chi nhánh.
- Popup size nhận `rulesMap/byVariant`, không dùng trực tiếp `variant.sell_price`
  nếu tier có giá variant.
- Banner hiển thị Bảng giá đang áp dụng và số SKU/size có ngoại lệ; không chỉ
  đếm món cha.

### Khi gửi bếp

- Server gọi lại resolver bằng branch/product/variant/quantity và không tin
  `unitPrice` từ browser.
- Nếu giá client khác giá server, trả lỗi có mã rõ và cho POS tải lại; không âm
  thầm đổi giá sau khi nhân viên đã xác nhận.
- Chỉ chấp nhận giá thủ công khi payload có quyền `pos_fnb.edit_price`, reason
  và audit/OTP theo chính sách hiện hành.
- Snapshot trên kitchen item gồm giá, nguồn, tier/item, variant và modifier.

### Khi thanh toán, in và báo cáo

- Thanh toán dùng snapshot gửi bếp, không resolve theo bảng giá mới.
- Invoice item giữ variant ID/label, price source, tier ID, list price và unit
  price thực bán; bill in chỉ hiện thông tin khách cần, audit giữ phần kỹ thuật.
- Khuyến mãi/coupon tính phía server trên snapshot hợp lệ.
- Trả/hủy dùng invoice snapshot; không đọc giá hiện tại để tính lại.
- Báo cáo doanh thu theo giá thực bán; báo cáo hiệu quả Bảng giá phân nhóm theo
  source/tier/branch và so sánh với giá chung tại thời điểm bán.

## 20. Migration và rollout theo mức ưu tiên

### P0 - Đúng tiền và đúng quyền

1. Preflight read-only toàn bộ schema, grant, RLS, duplicate tier item và branch
   assignment hiện có.
2. Bổ sung assignment có thời hạn, unique/index và RPC quản lý giá có
   `products.manage_prices` + audit; chuyển dữ liệu `branches.price_tier_id` cũ.
3. Khóa trang/nav/action; sửa `save_branch_atomic` để không dùng
   `system.manage_branches` đi vòng đổi tier.
4. Hợp nhất resolver và sửa POS F&B áp tier cho variant.
5. Server tái phân giải giá khi gửi bếp; snapshot nguồn giá.
6. Tạo resolver giá vốn F&B từ giá bán Retail, nối BOM cache/editor/size,
   `invoice_items.unit_cost`, stock movement snapshot và báo cáo COGS.
7. Contract test món thường, size, branch fallback, giá vốn F&B và quyền trước
   khi merge.

### P1 - Workspace Bảng giá hoàn chỉnh

1. Hợp nhất hai lối vào thành một màn chính.
2. Xây Giá chung, Giá chi nhánh và Lịch sử.
3. Editor ngoại lệ thưa, assignment nhiều chi nhánh, preview thay đổi.
4. Import/export Excel và bulk edit nguyên tử.
5. Responsive desktop/tablet/mobile và giữ draft khi đổi tab/ứng dụng.

### P2 - Hợp nhất với Thiết lập F&B

1. Xây workspace F&B ở các pha 1-3 phía trên.
2. Link sản phẩm <-> Bảng giá bằng filter, không nhúng editor chi nhánh.
3. Đồng bộ readiness: menu, size, BOM, modifier, giá chung và giá hiệu lực theo
   chi nhánh trong một màn kiểm tra trước vận hành.

### P3 - Lát cắt UAT và phát hành

1. Test Xưởng Tư Búa trước với Hồng Trà và Xưởng Gu Việt M/L.
2. Chạy Preview trên desktop, tablet, điện thoại và POS thực tế.
3. Đối chiếu menu -> bếp -> hóa đơn -> kho -> trả/hủy -> báo cáo.
4. Feature flag theo tenant/branch; rollout một chi nhánh rồi mới toàn chuỗi.
5. Có rollback function/grant/UI flag; không rollback bằng xóa dữ liệu giá đã
   được snapshot vào hóa đơn.

## 21. Ma trận kiểm thử bắt buộc

- Món không size: có/không có ngoại lệ chi nhánh.
- Món M/L: chỉ M khác giá, chỉ L khác giá, cả hai khác giá, không dòng nào khác.
- Cùng tier gán 2-3 chi nhánh; chuyển một chi nhánh sang tier khác.
- SKU không có trong tier phải về giá chung; variant không có dòng riêng phải về
  giá chung variant trước giá món cha.
- Tier ngừng hiệu lực hoặc bị xóa mềm trong lúc POS đang mở.
- Assignment `Không thời hạn`, `Có thời hạn`, lên lịch thay thế và hai khoảng
  chồng nhau; resolver chỉ nhận tier `is_active` tại thời gian máy chủ.
- Hai quản trị viên sửa cùng bảng; optimistic revision phải chặn lost update.
- User chỉ có `products.edit`, `system.manage_branches`, `pos_fnb.edit_price`;
  từng quyền riêng không được sửa tier.
- Owner và user có `products.manage_prices` lưu thành công, audit đầy đủ.
- Giá nền tảng, modifier có phụ thu, promotion, coupon và sửa giá có quyền.
- Gửi bếp offline/retry/idempotency; thanh toán sau khi bảng giá đã đổi.
- In lại hóa đơn, trả/hủy và báo cáo vẫn dùng snapshot cũ.
- Import có SKU sai, variant sai, dòng trùng và giá âm/0.
- Thành phần Retail tại quán: danh sách và dự toán BOM dùng giá Retail đã quy
  đổi; chứng từ đã nhận dùng snapshot; đổi giá Retail không sửa lịch sử.
- Material F&B thiếu giá Retail, giá bằng 0, sai channel hoặc thiếu UOM phải bị
  readiness/lưu/bán chặn; không fallback sang `cost_price`.
- Mức đường exact quantity và từng size phải tạo `unit_cost` khác nhau đúng theo
  giá Retail của đường; topping BOM và topping nhập sẵn đều không tính hai lần.
- Hóa đơn F&B mới phải snapshot `unit_cost`; báo cáo không được tính lại lịch sử
  từ `bom.cached_cost` hoặc giá Retail hiện tại.
- Báo cáo quán giữ snapshot giá bán Retail, còn báo cáo hợp nhất loại đúng lãi
  nội bộ.
- Desktop 1440/1024, tablet và mobile; text/giá không tràn, draft không mất khi
  chuyển tab hoặc ứng dụng.

## 22. Điều kiện hoàn thành master plan

- Chỉ còn một trang Bảng giá chính, một resolver giá bán và một resolver giá vốn
  F&B với trách nhiệm tách biệt.
- Không có đường ghi giá nào bỏ qua `products.manage_prices` và audit.
- POS F&B món cha và variant dùng đúng giá chi nhánh.
- Server là nguồn quyết định giá tại thời điểm gửi bếp.
- Bảng ngoại lệ không yêu cầu copy SKU đang dùng giá chung.
- Giá vốn F&B của thành phần tại quán không còn đọc nhầm `costPrice` Retail;
  báo cáo chi nhánh và báo cáo hợp nhất dùng đúng hai góc nhìn.
- Bảng giá `Không thời hạn`/`Có thời hạn` có assignment và lịch sử thật, không
  giả lập bằng riêng `branches.price_tier_id`.
- Hóa đơn cũ không đổi khi bảng giá, tên size hoặc tên modifier thay đổi.
- Thiết lập F&B và Bảng giá liên kết rõ nhưng không trộn trách nhiệm.
- UAT lát cắt dọc đạt ở Xưởng Tư Búa trước khi mở toàn chuỗi.

## 23. Quyết định triển khai trước P0

1. **Giá nền tảng:** **đã duyệt**. Giữ ưu tiên Shopee/Grab trên tier chi nhánh
   như hành vi hiện tại. Nếu cần giá Shopee/Grab khác theo từng chi nhánh sẽ là
   bước mở rộng sau, không tự suy trong P0.
2. **Thời gian hiệu lực:** **đã duyệt**. Mỗi Bảng giá chọn một trong hai chế độ:
   `Không thời hạn` hoặc `Có thời hạn` với ngày bắt đầu/kết thúc. P0 vẫn chỉ
   cho một tier F&B có hiệu lực trên mỗi chi nhánh tại cùng một thời điểm; RPC
   phải chặn khoảng hiệu lực chồng nhau.
3. **Quyền xem:** **đã duyệt**. `products.view` được xem giá bán; chỉ Owner hoặc
   người có `products.manage_prices` được tạo, sửa, gán, import, export hay xóa
   Bảng giá. Giá vốn/lợi nhuận tiếp tục theo quyền riêng `products.view_cost`
   và `products.view_profit`.
4. **Giá nền tảng theo size:** **đã duyệt sau review**. Thêm `variant_id` tùy
   chọn cho giá Shopee/Grab/Gojek/Be. Món có size được phép đặt giá riêng M/L;
   nếu size không có dòng riêng thì fallback giá nền tảng món cha rồi mới tới
   Bảng giá chi nhánh và giá chung. Không nhân bản sản phẩm.

## 24. Bảng điều phối toàn bộ việc đã nêu trên Web và POS

Mục này là danh sách điều hành chung. Các phần đã merge vẫn phải qua UAT; không
được hiểu `đã merge` là đã nghiệm thu production.

| Workstream | Hiện trạng 30/08/2026 | Việc còn lại | Ưu tiên |
| --- | --- | --- | --- |
| Thiết lập sản phẩm F&B | Size, exact quantity, UOM và sửa xung đột mức đường đã có các lớp nền; giao diện vẫn rải giữa Thông tin, Công thức và Quy cách | Xây workspace thống nhất mục 4-8, draft xuyên section, lưu nguyên tử, nhiều chi nhánh và readiness | P0-P2 |
| Mức đường và kho | Hồng Trà đã dùng exact quantity; Hồng Trà Mật Ong còn một mức 60% bằng 0 cần user xác nhận nghiệp vụ | Migration 00361/00362 chỉ chạy sau preflight và xác nhận; test trừ/hoàn đúng kho chi nhánh qua POS thực | P0 |
| Bảng giá | Có tier và item nhưng quyền, RPC, variant F&B và audit chưa khép kín | Thực hiện mục 16-20; không mở rộng UI trước khi resolver server và permission đạt | P0-P1 |
| Giá thành phần tại quán | Tab Thành phần và các hàm BOM/cache/report hiện còn đọc `costPrice` | Resolver giá vốn F&B bắt buộc lấy giá bán Retail theo định lượng/quy đổi; snapshot khi bán và báo cáo hợp nhất loại lãi nội bộ | P0 |
| POS F&B giá/size | Chọn size và modifier đã có; tier chi nhánh chưa phủ variant và server gửi bếp chưa tái phân giải giá | Dùng resolver chung, snapshot nguồn giá, kiểm size/modifier/BOM trước gửi bếp | P0 |
| Sơ đồ bàn Web/POS | Responsive desktop/tablet/mobile, hiển thị vật thể trên POS và vùng chọn decoration đã merge qua PR #294, #296-#298 | UAT click/drag/resize/lock với bàn, cầu thang, cửa, cây, quầy; kiểm cùng bố cục theo tỉ lệ trên thiết bị thật | P1 UAT |
| Đơn đặt hàng | Nhãn `Đã có hóa đơn số ...`, nhiều mã hóa đơn và chọn vật thể đã merge trong PR #294 | UAT dữ liệu cũ/mới; chỉ giữ `Chờ xử lý` khi chưa có hóa đơn, màu xanh khi đã có hóa đơn; không suy hoàn tất từ số lượng khớp | P1 UAT |
| Giữ trạng thái trang | Một số list/POS đã có draft hoặc refresh có kiểm soát; chưa có bằng chứng mọi route đều giữ scroll, tab và popup | Lập inventory route, chuẩn hóa route state + scroll restoration + draft policy; không tắt refresh dữ liệu nền | P1 |
| Điều hướng sidebar | Yêu cầu ERP mở cùng tab, riêng POS/KDS mở tab mới; một số `target=_blank` vẫn cần phân loại | Audit toàn bộ nav/action, áp helper điều hướng thống nhất và test back/forward | P1 |
| Menu Hệ thống | `Cài đặt in ấn` đã xuất hiện trong nhóm Hệ thống theo ảnh nghiệm thu gần nhất | Test quyền, trạng thái sidebar thu gọn/mở rộng và mobile; không tạo mục trùng | P2 UAT |
| Món còn lại | Hồng Trà là lát cắt đầu; Xưởng Gu Việt M/L là lát cắt size tiếp theo | Chỉ nhân setup theo nhóm sau khi hai lát cắt dọc đạt POS -> bếp -> kho -> trả/hủy -> báo cáo | P3 |

## 25. Thứ tự thực thi chung

### Đợt A - Khóa tính đúng nghiệp vụ

1. Toàn bộ quyết định mục 23 đã chốt; xác minh nghiệp vụ lượng đường 60% của
   Hồng Trà Mật Ong trước khi sửa dữ liệu.
2. Preflight production read-only cho 00361/00362, Bảng giá và dữ liệu variant.
3. Làm price resolver server, permission/RPC/audit và sửa POS F&B variant.
4. Xây resolver Giá vốn F&B từ giá bán Retail và nối toàn bộ BOM/cache,
   product/variant, hóa đơn, stock movement và báo cáo; không ghi đè giá vốn gốc
   của SKU Retail.
5. UAT mức đường theo đúng kho chi nhánh; chưa nhân sang món khác nếu lệch.

### Đợt B - Hợp nhất trải nghiệm quản trị

1. Xây workspace Thiết lập F&B thống nhất cho món có/không size.
2. Xây màn Bảng giá chính duy nhất và liên kết lọc hai chiều với sản phẩm.
3. Chuẩn hóa draft, scroll/tab restoration và điều hướng cùng tab trên ERP.
4. Giữ feature flag; tab cũ chỉ bỏ sau khi đối chiếu dữ liệu đạt.

### Đợt C - Nghiệm thu vận hành

1. UAT Xưởng Tư Búa trên desktop, tablet, điện thoại.
2. UAT sơ đồ bàn Web/POS và trạng thái đơn đặt hàng đã merge.
3. UAT Hồng Trà, Hồng Trà Mật Ong, Xưởng Gu Việt M/L và một topping có BOM.
4. Đối chiếu POS -> bếp/in -> thanh toán -> kho -> hoàn/trả -> báo cáo.

### Đợt D - Mở rộng có kiểm soát

1. Rollout một chi nhánh, theo dõi audit và chênh lệch giá/kho.
2. Nhân setup theo từng line sản phẩm, không copy toàn bộ menu một lần.
3. Sau khi ổn định mới mở lịch giá, import hàng loạt và báo cáo hiệu quả tier.

## 26. Nguyên tắc không được phá khi triển khai

- Không tạo thêm màn công thức hoặc cơ chế giá thứ ba.
- Không nhân SKU chỉ vì khác chi nhánh, giá hoặc công thức.
- Không để client quyết định cuối cùng về giá hay lượng trừ kho.
- Không đổi giá hóa đơn cũ khi cấu hình hiện tại thay đổi.
- Không dùng `products.edit` hoặc quyền chi nhánh để đi vòng quyền quản lý giá.
- Không tắt tải dữ liệu nền chỉ để giữ vị trí; lưu UI state và hợp nhất dữ liệu
  mới có chủ đích.
- Không merge migration trước preflight, test tự động, rollback và postflight.
- Không mở toàn chuỗi trước khi lát cắt Xưởng Tư Búa đạt đầy đủ.
