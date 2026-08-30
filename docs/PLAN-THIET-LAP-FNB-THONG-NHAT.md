# Kế hoạch hợp nhất thiết lập sản phẩm F&B

> Trạng thái: đề xuất để CEO duyệt, chưa triển khai UI hoặc thay đổi dữ liệu.
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

Nguồn:

- https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/fnb-thuc-don/topping/
- https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/fnb-thuc-don/danh-sach-mon-trong-thuc-don/

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
| Giá vốn | Hai cách hiển thị | Suy từ BOM rồi ghi vào variant/sản phẩm |

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

- Giá mặc định của món hoặc bảng tóm tắt giá theo size.
- Trạng thái kinh doanh.
- Giá theo bảng giá tiếp tục dùng hệ thống bảng giá hiện có; không tạo thêm một
  cơ chế giá theo chi nhánh trong dự án này.

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
- Giá vốn cập nhật tức thời từ giá vốn nguyên liệu và hệ số quy đổi.
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

### Cách nhập

Khi dòng nguyên liệu chọn “Theo Mức đường”, bảng chi tiết mở ngay bên dưới:

| Lựa chọn | Mặc định hoặc Size M | Size L |
| --- | ---: | ---: |
| Không đường | 0 g | 0 g |
| 80% | 5 g | 7 g |
| 100% (mặc định) | 6 g | 9 g |
| 120% | 7 g | 11 g |

Hệ thống không tự suy 80/120% từ món khác. Có thể có nút **Gợi ý từ 100%** để
điền nháp, nhưng user phải xác nhận và được sửa từng ô trước khi lưu.

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
- Giá theo chi nhánh tiếp tục đi qua Bảng giá; không trộn vào công thức.

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

### Pha 0 - Chốt quyết định nghiệp vụ

- CEO duyệt bốn điểm ở mục 14.
- Không thay đổi production.

### Pha 1 - Domain model và read adapter

- Tạo `FnbProductSetupDraft` thống nhất cho món một cỡ/nhiều cỡ.
- Adapter đọc BOM cha thành cột ảo Mặc định và BOM variant thành cột size.
- Adapter đọc modifier, exact quantities, UOM, menu scope và cost.
- Test dữ liệu cũ mở lên không đổi nghĩa.

### Pha 2 - Workspace UI trên Preview

- Xây `FnbProductSetupWorkspace` thay cho ba bề mặt rời rạc.
- Chưa xóa tab cũ; bật bằng feature flag trên Preview.
- Kiểm desktop/tablet/mobile và draft persistence.

### Pha 3 - RPC lưu nguyên tử

- Preflight schema read-only.
- Migration bổ sung assignment công thức nhiều chi nhánh nếu CEO duyệt.
- RPC validate toàn payload rồi lưu setup F&B trong một transaction.
- RLS/permission/tenant guard và idempotency.
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
- Mỗi chi nhánh/size phân giải đúng một BOM.
- POS, KDS, in, thanh toán, kho và hoàn trả khớp cùng snapshot.
- Món cũ không size tiếp tục bán như trước.

## 14. Bốn quyết định cần CEO duyệt

1. **Tên và cấu trúc:** dùng một tab `Thiết lập F&B` gồm Phạm vi bán -> Quy cách
   -> Công thức -> Tùy chọn -> Kiểm tra. Đề xuất: **duyệt**.
2. **Chi nhánh:** một công thức mặc định, chỉ tạo override khi khác; một override
   gán được nhiều chi nhánh. Đề xuất: **duyệt**.
3. **Giá:** giá size nằm trong Thiết lập F&B; giá theo chi nhánh vẫn dùng Bảng
   giá, không tạo cơ chế giá thứ ba. Đề xuất: **duyệt**.
4. **Gợi ý định lượng:** cho phép nút gợi ý 80/120% từ mức chuẩn nhưng không tự
   lưu; user phải xác nhận/chỉnh số thực tế. Đề xuất: **duyệt có cảnh báo**.

Sau khi CEO duyệt bốn điểm, mới bắt đầu Pha 1. Không code schema/UI trước quyết
định để tránh tiếp tục tạo thêm một luồng setup song song.
