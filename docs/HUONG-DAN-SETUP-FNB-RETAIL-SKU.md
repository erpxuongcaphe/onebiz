# Hướng Dẫn Setup FnB Theo Logic Retail SKU Làm Đầu Vào

Ngày cập nhật: 25/08/2026

Tài liệu này là bản hướng dẫn chuẩn cho mô hình OneBiz hiện tại: Retail và FnB là 2 mảng riêng, nhưng hàng đầu vào của FnB có thể chính là SKU Retail được bán nội bộ, chuyển kho hoặc cấp từ Kho tổng sang Quán FnB.

Mục tiêu:

- Setup đúng SKU Retail, SKU FnB, NVL gốc và BOM.
- Tách báo cáo Retail và FnB rõ ràng.
- POS FnB bán món thì trừ đúng hàng thành phần tại quán.
- Tránh tạo trùng mã hàng khiến tồn kho và giá vốn bị lệch.

Tài liệu này chỉ là hướng dẫn. Không chạy SQL, không sửa dữ liệu thật, không deploy.

## 1. Tư Duy Nền

OneBiz có 3 lớp hàng hóa chính:

| Lớp | Ví dụ | Vai trò |
|---|---|---|
| NVL gốc | Hạt sống, nguyên liệu sản xuất, bao bì gốc | Dùng ở Kho tổng/Xưởng để sản xuất hoặc đóng gói |
| SKU Retail | Cà phê rang xay 1kg, sữa đặc lon, syrup chai, ly nhựa | Bán Retail và có thể cấp sang quán FnB làm đầu vào |
| SKU FnB | Bạc xỉu, cà phê sữa đá, latte, trà sữa | Món bán trên POS FnB |

Nguyên tắc cốt lõi:

- Retail và FnB tách kênh bán.
- SKU Retail có thể là hàng bán lẻ, đồng thời là hàng thành phần trong BOM FnB.
- SKU FnB là món trên menu, không phải hàng nhập kho trực tiếp.
- Nếu quán dùng "sữa đặc lon" và mã này đã là SKU Retail, không tạo thêm một mã "NVL FnB" riêng cho cùng món hàng.
- BOM FnB phải trỏ tới hàng thành phần đang có tồn tại quán, thường là SKU Retail đã cấp từ Kho tổng.

Mô hình đúng:

```text
Kho tổng / Retail / Xưởng
  NVL gốc
    -> sản xuất, đóng gói, mua bán
  SKU Retail
    -> bán lẻ/sỉ
    -> cấp sang Quán FnB

Quán FnB
  Nhận SKU Retail từ Kho tổng
    -> cà phê rang xay, sữa lon, syrup chai, ly và các vật tư được chọn quản lý tồn
  Tạo SKU FnB
    -> bạc xỉu, cà phê sữa đá, latte...
  BOM FnB
    -> dùng SKU Retail làm hàng thành phần
  POS FnB bán món
    -> trừ tồn SKU Retail tại quán theo BOM
```

Nói ngắn gọn: Retail tạo và cấp hàng; FnB bán món; BOM nối 2 lớp này lại.

## 2. Quy Tắc Mã Hàng

### 2.1. Product Type Và Channel

| Trường | Giá trị | Ý nghĩa |
|---|---|---|
| `product_type` | `nvl` | Nguyên vật liệu nội bộ, không bán trên POS |
| `product_type` | `sku` | Hàng bán hoặc món bán |
| `channel` | `retail` | SKU hiện trên POS Retail |
| `channel` | `fnb` | SKU hiện trên POS FnB |
| `channel` | để trống | Dùng cho NVL |

Quy tắc:

- SKU Retail: `product_type = sku`, `channel = retail`.
- SKU FnB: `product_type = sku`, `channel = fnb`.
- NVL gốc: `product_type = nvl`, `channel` để trống.

Không gán `channel = fnb` cho hàng Retail chỉ vì quán FnB có dùng hàng đó. Hàng đó vẫn là SKU Retail; nó chỉ trở thành đầu vào FnB khi nằm trong BOM của món FnB.

### 2.2. Không Tạo Trùng NVL FnB Khi Đã Có SKU Retail

Ví dụ đúng:

| Mã | Tên | Loại | Channel | Dùng ở đâu |
|---|---|---|---|---|
| `SKU-SUA-LON-001` | Sữa đặc lon | SKU | retail | Retail bán, FnB dùng làm đầu vào |
| `SKU-CPH-RX-001` | Cà phê rang xay 1kg | SKU | retail | Retail bán, FnB dùng pha chế |
| `SKU-FNB-BX-001` | Bạc xỉu | SKU | fnb | POS FnB bán món |

Ví dụ không nên làm:

| Mã | Vấn đề |
|---|---|
| `SKU-SUA-LON-001` và `NVL-SUA-FNB-001` cùng là sữa đặc lon | Tách tồn thành 2 mã, dễ trừ nhầm |
| `SKU-CPH-RX-001` và `NVL-CPH-FNB-001` cùng là cà phê rang xay | Báo cáo giá vốn và tồn kho dễ lệch |

Chỉ tạo NVL gốc nếu đó thật sự là nguyên liệu đầu nguồn của Kho/Xưởng, ví dụ hạt sống trước khi rang hoặc nguyên liệu trước khi đóng gói.

## 3. Setup Chi Nhánh

### 3.1. Kho Tổng, Xưởng, Retail

| Thiết lập | Giá trị nên chọn |
|---|---|
| Loại chi nhánh | Kho tổng hoặc Xưởng SX |
| Chế độ tồn kho | Kho/Xưởng sản xuất, tương ứng `production` |

Ý nghĩa:

- Đây là nơi quản lý NVL gốc hoặc sản xuất SKU Retail.
- Nếu SKU Retail có BOM, khi bán hoặc cấp đi từ Kho tổng, hệ thống có thể bung BOM để trừ NVL gốc.
- Ví dụ: Kho tổng cấp `SKU-SUA-LON-001` sang quán. Nếu SKU này có BOM 1 lon từ NVL gốc, Kho tổng trừ NVL gốc theo BOM.

### 3.2. Quán FnB

| Thiết lập | Giá trị nên chọn |
|---|---|
| Loại chi nhánh | Cửa hàng FnB |
| Chế độ tồn kho | Quán/Outlet, tương ứng `outlet` |

Ý nghĩa:

- Quán nhận SKU Retail từ Kho tổng.
- Quán giữ tồn SKU Retail tại chính quán.
- POS FnB bán món thì BOM của món sẽ trừ SKU Retail tại quán.

Điểm rất quan trọng:

- Với chi nhánh `outlet`, hệ thống không nên tự bung BOM global cho mọi SKU, vì BOM global của SKU Retail có thể đang trỏ về NVL gốc ở Kho tổng.
- Để món FnB trừ đúng hàng tại quán, nên tạo BOM riêng theo chi nhánh quán hoặc clone BOM chuẩn sang từng quán.

## 4. Setup SKU Retail Làm Đầu Vào FnB

Tạo SKU Retail cho các hàng mà Kho tổng bán hoặc cấp sang quán:

| Mã gợi ý | Tên hàng | Loại | Channel | ĐVT |
|---|---|---|---|---|
| `SKU-CPH-RX-001` | Cà phê rang xay 1kg | sku | retail | Kg |
| `SKU-SUA-LON-001` | Sữa đặc lon | sku | retail | Lon |
| `SKU-SYR-CARAMEL-001` | Syrup caramel chai | sku | retail | Chai |
| `SKU-LY-500-001` | Ly nhựa 500ml | sku | retail | Cái |
| `SKU-NAP-500-001` | Nắp ly 500ml | sku | retail | Cái |

Các mã này có thể:

- Bán trên POS Retail.
- Xuất bán nội bộ hoặc chuyển sang quán FnB.
- Được BOM FnB dùng làm hàng thành phần.

Nếu hàng được mua nguyên trạng rồi cấp thẳng cho quán, có thể chỉ cần SKU Retail. Nếu hàng được sản xuất từ NVL gốc, mới cần NVL gốc và BOM/sản xuất ở Kho tổng.

## 5. Cấp Hàng Sang Quán FnB

Quán FnB chỉ trừ đúng tồn nếu hàng thành phần đã có ở chi nhánh quán.

Quy trình an toàn:

1. Kho tổng có tồn SKU Retail hoặc có NVL để tạo SKU Retail.
2. Tạo phiếu bán nội bộ/chuyển kho từ Kho tổng sang Quán FnB.
3. Kiểm tra tồn kho tại Quán FnB sau phiếu.
4. Chỉ test POS FnB sau khi quán đã có tồn hàng thành phần.

Ví dụ:

```text
Kho tổng cấp sang Quán A:
- 5 kg SKU-CPH-RX-001 - Cà phê rang xay
- 10 lon SKU-SUA-LON-001 - Sữa đặc lon
- 200 cái SKU-LY-500-001 - Ly nhựa 500ml

Quán A phải có tồn:
- SKU-CPH-RX-001: +5 kg
- SKU-SUA-LON-001: +10 lon
- SKU-LY-500-001: +200 cái
```

Nếu chưa có tồn ở quán mà POS FnB bán món, hệ thống có thể báo thiếu hàng hoặc làm tồn âm tùy cấu hình.

### 5.1. Chọn Đúng Chứng Từ Cấp Hàng

| Tình huống | Dùng nghiệp vụ | Kết quả đúng |
|---|---|---|
| Retail bán đầu vào cho quán FnB cùng doanh nghiệp, cần có giá trị bán/mua nội bộ | **Bán nội bộ chuỗi** | Tạo hóa đơn bên bán, phiếu nhập bên mua và biến động tồn tự động |
| Chỉ điều chuyển vật lý giữa hai kho/chi nhánh, không cần giá hay chứng từ mua-bán nội bộ | **Chuyển kho** | Chỉ chuyển tồn giữa hai nơi |
| Nhà cung cấp bên ngoài giao trực tiếp cho quán | **Nhập hàng** | Ghi nhận nhà cung cấp, công nợ và tồn tại quán |

Với Xưởng Tư Búa nhận hàng từ mảng Retail của cùng tenant, dùng **Bán nội bộ chuỗi**. Không tạo phiếu nhập NCC bên ngoài cho cùng lô hàng, vì như vậy sẽ làm đúp chứng từ và dễ lệch tồn/giá vốn.

## 6. Setup SKU FnB

SKU FnB là món bán trên menu:

| Mã gợi ý | Tên món | Loại | Channel | ĐVT |
|---|---|---|---|---|
| `SKU-FNB-CFS-001` | Cà phê sữa đá | sku | fnb | Ly |
| `SKU-FNB-BX-001` | Bạc xỉu | sku | fnb | Ly |
| `SKU-FNB-LATTE-001` | Latte | sku | fnb | Ly |
| `SKU-FNB-TS-001` | Trà sữa truyền thống | sku | fnb | Ly |

Quy tắc:

- SKU FnB phải thuộc nhóm hàng FnB.
- SKU FnB phải có `channel = fnb`.
- Món có công thức phải bật BOM/`has_bom = true`.
- Giá bán nằm ở SKU hoặc variant.
- Giá vốn nên tính từ BOM, không nhập tay tùy tiện nếu đã có công thức.
- Không tự thêm nắp, ống hút hoặc đá vào BOM; chỉ thêm nguyên liệu/vật tư mà chi nhánh quyết định theo dõi tồn.

Nếu có size M/L:

| SKU cha | Variant | Giá bán | BOM |
|---|---|---:|---|
| `SKU-FNB-BX-001` | M | 28,000 | `BOM-FNB-QA-BX-M` |
| `SKU-FNB-BX-001` | L | 33,000 | `BOM-FNB-QA-BX-L` |

Size nào khác định lượng thì nên có BOM riêng.

## 7. Setup BOM FnB

### 7.1. BOM FnB Dùng Mã Nào

BOM FnB là công thức của món. Trong mô hình của anh, dòng hàng trong BOM thường là SKU Retail đang tồn ở quán.

Ví dụ BOM Bạc xỉu size M:

| Hàng thành phần | Mã hàng | Số lượng | ĐVT |
|---|---|---:|---|
| Cà phê rang xay | `SKU-CPH-RX-001` | 0.018 | Kg |
| Sữa đặc lon | `SKU-SUA-LON-001` | 0.030 | Lon |
| Ly nhựa 500ml | `SKU-LY-500-001` | 1 | Cái |

Trong template Excel BOM, cột có thể tên là "Mã NVL". Với mô hình của anh, hãy hiểu cột này là "mã hàng thành phần bị trừ tồn". Mã đó có thể là:

- NVL gốc nếu quán thật sự giữ NVL gốc.
- SKU Retail nếu quán nhận SKU Retail từ Kho tổng và dùng để pha chế.

Hiện tại BOM picker trong UI có chủ ý cho phép chọn cả NVL và SKU làm hàng thành phần.

### 7.2. BOM Global Và BOM Riêng Chi Nhánh

| Loại BOM | Khi nào dùng | Lưu ý |
|---|---|---|
| BOM global | Làm công thức mẫu hoặc dùng ở Kho/Xưởng | Không đủ an toàn cho Quán FnB nếu cần trừ SKU Retail tại quán |
| BOM riêng chi nhánh | Dùng cho từng Quán FnB | Nên dùng để POS FnB cascade đúng hàng tại quán |

Khuyến nghị:

- Tạo BOM chuẩn/global để làm mẫu.
- Clone hoặc tạo BOM riêng cho từng Quán FnB.
- BOM riêng của quán phải tham chiếu SKU Retail đang tồn tại quán.
- Sau khi tạo, test bán 1 món và kiểm tra Lịch sử kho.

### 7.3. Quy Tắc Đặt Mã BOM

| Loại | Format gợi ý | Ví dụ |
|---|---|---|
| BOM FnB theo quán | `BOM-FNB-{MAQUAN}-{MON}-{SIZE}` | `BOM-FNB-QA-BX-M` |
| BOM FnB global | `BOM-FNB-{MON}-{SIZE}` | `BOM-FNB-BX-M` |
| BOM Retail đóng gói | `BOM-RTL-{NHOM}-{SKU}` | `BOM-RTL-SUA-LON` |
| BOM sản xuất | `BOM-SX-{SP}` | `BOM-SX-CPH-1KG` |

Không nên dùng mã chung chung như `BOM001`, vì sau này khó kiểm tra.

## 8. Modifier FnB

Modifier là tùy chọn khi bán món:

| Nhóm | Ví dụ | Cách dùng |
|---|---|---|
| Mức đường | Không đường, 60%, 80%, 100% | Khai định lượng riêng của từng lựa chọn trên dòng Đường trong BOM |
| Mức đá | Ít đá, bình thường, nhiều đá | Tại Xưởng Tư Búa chỉ là tùy chọn phục vụ, không scale BOM và không trừ tồn |
| Size | M, L | Nên dùng variant nếu giá và định lượng khác |
| Topping | Trân châu, thạch, kem cheese | Nên có mã hàng riêng để trừ tồn |

Khuyến nghị:

- Size nên là variant.
- Đường/syrup dùng **định lượng riêng theo lựa chọn**; không suy từ một tỷ lệ % chung vì mỗi món có công thức khác nhau.
- Topping bán thêm nên là hàng có tồn riêng.
- Modifier không nên thay thế BOM, vì BOM mới là nơi kiểm soát giá vốn.

### 8.1. Mẫu Chuẩn: Hồng Trà Không Size

Món **Hồng Trà** là món một giá, không tạo variant M/L. Dùng hai nhóm tùy chọn đơn:

| Nhóm | Rule | Mặc định | Tác động tồn |
|---|---|---|---|
| Mức đường | `single_required` | 100% | Trừ đúng định lượng đã khai cho từng lựa chọn |
| Mức đá | `single_required` | Bình thường | Không scale, không liên kết SKU |

BOM của Hồng Trà tại Xưởng Tư Búa nhập theo công thức đã chốt: dòng **Hồng Trà - Toàn Phát** là 6.8 g và giữ nguyên định lượng. Dòng **Đường cát trắng** được gắn nhóm **Mức đường**, rồi mở lại BOM và bật **Dùng định lượng riêng** để nhập đúng số đã cân:

| Lựa chọn | Hồng Trà - Toàn Phát | Đường cát trắng |
|---|---:|---:|
| Không đường | 6.8 g | 0 g |
| 60% | 6.8 g | 21 g |
| 80% | 6.8 g | 28 g |
| 100% | 6.8 g | 35 g |

Không tự tạo mức 120% hay áp hệ số cho món khác khi chưa có công thức cân thực tế. Nếu sau này thêm lựa chọn mới, phải nhập định lượng cho từng dòng nguyên liệu có gắn nhóm đó trước khi bán.

Chỉ thêm ly vào BOM nếu anh quyết định quản lý tồn ly. Không thêm nắp, ống hút hoặc đá vào BOM theo quy ước vận hành hiện tại; đó là chi phí khác, không phải hàng tiêu hao cần trừ theo từng bill.

## 9. Quy Trình Setup Từ Đầu

### Bước 1. Chốt Chi Nhánh

| Chi nhánh | Loại | Chế độ tồn kho |
|---|---|---|
| Kho Tổng | Kho tổng | `production` |
| Xưởng Rang | Xưởng SX | `production` |
| Quán A | Cửa hàng FnB | `outlet` |
| Quán B | Cửa hàng FnB | `outlet` |

### Bước 2. Tạo Danh Mục Retail

Tạo nhóm và SKU Retail cho:

- Cà phê rang xay.
- Sữa, syrup, bột nền.
- Ly hoặc bao bì nếu doanh nghiệp quyết định quản lý tồn.
- Bánh, snack, nước chai nếu có bán Retail.

Tất cả là `product_type = sku`, `channel = retail`.

### Bước 3. Tạo Danh Mục FnB

Tạo nhóm FnB:

- Cà phê.
- Trà sữa.
- Trà trái cây.
- Đá xay.
- Sinh tố/nước ép.
- Topping món.

Các nhóm SKU FnB dùng `channel = fnb`.

### Bước 4. Tạo SKU FnB

Với mỗi món:

- Tên món ngắn, dễ đọc trên POS.
- Mã món có tiền tố `SKU-FNB`.
- Gắn nhóm FnB.
- Bật BOM nếu cần trừ nguyên liệu.
- Tạo variant size nếu cần.

### Bước 5. Tạo BOM FnB

Với mỗi món:

- Chọn SKU FnB đầu ra.
- Chọn chi nhánh nếu là BOM riêng cho quán.
- Thêm hàng thành phần là SKU Retail đang cấp sang quán.
- Khai số lượng và đơn vị chính xác.
- Với đường/syrup thay đổi theo lựa chọn: gắn nhóm vào dòng BOM, lưu, rồi mở lại BOM để bật **Dùng định lượng riêng** và nhập từng mức đã cân.

### Bước 6. Cấp Tồn Sang Quán

Dùng nghiệp vụ phù hợp:

- Bán nội bộ.
- Chuyển kho.
- Nhập hàng tại quán nếu NCC giao thẳng quán.

Sau đó kiểm tra tồn SKU Retail tại quán.

### Bước 7. Test POS FnB

Test tối thiểu 1 món:

1. Ghi lại tồn trước của SKU Retail tại Quán FnB.
2. Vào POS FnB đúng chi nhánh quán.
3. Bán 1 món SKU FnB có BOM.
4. Thanh toán.
5. Mở Lịch sử kho và Tồn kho.
6. Kiểm tra SKU Retail thành phần bị trừ đúng số lượng.
7. Kiểm tra doanh thu vào báo cáo FnB, không lẫn Retail.

Chỉ khi test này đúng mới nhân rộng setup.

## 10. Excel Import

### 10.1. File Sản Phẩm

| Cột | SKU Retail đầu vào FnB | SKU FnB món bán | NVL gốc |
|---|---|---|---|
| Loại | `sku` | `sku` | `nvl` |
| Kênh bán | `retail` | `fnb` | để trống |
| Mã nhóm hàng | Nhóm Retail | Nhóm FnB | Nhóm NVL |
| Mã BOM | Chỉ điền nếu SKU Retail có BOM | Điền nếu món FnB có BOM | để trống |
| Tồn kho ban đầu | Nên để 0 | 0 | Nên nhập qua tồn đầu kỳ/phiếu nhập |

Lưu ý: tồn thật nên nhập bằng mẫu tồn đầu kỳ hoặc phiếu nhập để có lịch sử kho.

Với hàng Retail cấp nội bộ sang quán FnB, ưu tiên **Bán nội bộ chuỗi** thay vì tạo phiếu nhập NCC. Phiếu nhập chỉ phù hợp khi nhà cung cấp bên ngoài giao hàng cho quán.

### 10.2. File BOM

| Cột | Cách điền |
|---|---|
| Mã BOM | Theo quy tắc đặt mã |
| Tên BOM | Tên công thức dễ hiểu |
| Mã chi nhánh | Điền nếu BOM riêng cho quán |
| Mã NVL | Với mô hình này có thể là mã SKU Retail thành phần |
| Số lượng | Dùng chuẩn số US, ví dụ `1,234.56` |
| ĐVT | Đồng nhất với quy đổi hệ thống |
| Theo lựa chọn FnB | Gắn nhóm vào dòng BOM; định lượng riêng của từng option nhập trong màn sửa BOM, không import theo tỷ lệ % |

Chuẩn số và ngày:

- Số: `1,234.56`.
- Ngày: `dd/mm/yyyy`.
- Không dùng format `1.234,56`.

Nếu import lỗi, sửa theo dòng/cột báo lỗi rồi import lại. Với kho, tồn đầu kỳ, công nợ, không nên ghi nhận nếu file còn dòng lỗi.

## 11. Kiểm Tra Báo Cáo Sau Setup

Sau khi setup đúng, anh nên thấy:

| Màn hình/báo cáo | Kết quả đúng |
|---|---|
| POS Retail | Chỉ thấy SKU Retail |
| POS FnB | Chỉ thấy SKU FnB |
| Tồn kho chi nhánh Quán FnB | Có SKU Retail đầu vào |
| Lịch sử kho | POS FnB bán món tạo dòng trừ hàng thành phần |
| Báo cáo FnB | Ghi doanh thu món FnB |
| Báo cáo Retail | Không bị lẫn món FnB |
| COGS theo BOM | Giá vốn món FnB tính từ hàng thành phần |

Nếu FnB có doanh thu nhưng không có tiêu hao BOM, cần kiểm tra lại BOM và chi nhánh.

## 12. Lỗi Setup Thường Gặp

### 12.1. POS FnB Không Thấy Món

Kiểm tra:

- SKU có `channel = fnb` chưa.
- SKU thuộc nhóm FnB chưa.
- SKU còn active không.
- Đang vào đúng POS FnB chưa.

### 12.2. POS Retail Thấy Nhầm Món FnB

Kiểm tra:

- Món có bị gán `channel = retail` không.
- Nhóm hàng có channel sai không.

### 12.3. Bán Món FnB Nhưng Tồn Thành Phần Không Giảm

Kiểm tra:

- SKU FnB có `has_bom = true` không.
- SKU/variant có mã BOM đúng không.
- BOM có item hàng thành phần không.
- BOM có phải BOM riêng của chi nhánh quán không.
- Quán đã có tồn SKU Retail thành phần chưa.
- Lịch sử kho có dòng trừ BOM hoặc trừ hàng thành phần không.

### 12.4. SKU FnB Bị Âm Tồn

Nguyên nhân thường gặp:

- Món FnB chỉ có BOM global, chưa có BOM riêng chi nhánh quán.
- SKU FnB chưa gắn BOM đúng.
- POS FnB coi món đó như SKU giữ tồn trực tiếp.

Cách xử lý:

1. Tạo hoặc clone BOM riêng cho Quán FnB.
2. Gắn BOM đó vào SKU FnB hoặc variant.
3. Test lại 1 món.
4. Nếu vẫn không cascade, cần kiểm tra backend path `should_cascade_bom_at_branch`.

### 12.5. BOM Trừ Nhầm NVL Gốc

Nguyên nhân:

- BOM đang dùng mã NVL gốc của Kho tổng.
- BOM global của Kho tổng được dùng lại ở Quán FnB.

Cách xử lý:

- Tạo BOM riêng cho Quán FnB.
- Trong BOM riêng, dùng mã SKU Retail đang tồn ở quán.

### 12.6. Retail Và FnB Bị Lẫn Báo Cáo

Kiểm tra:

- SKU Retail có `channel = retail`.
- SKU FnB có `channel = fnb`.
- Nhóm hàng đúng channel.
- Nhân viên không bán món FnB ở POS Retail.

## 13. Checklist Go-Live

### Chi nhánh

- [ ] Kho tổng/Xưởng là `production`.
- [ ] Quán FnB là `outlet`.
- [ ] POS FnB đang chọn đúng chi nhánh quán.

### Hàng hóa

- [ ] SKU Retail đầu vào đã có đầy đủ.
- [ ] SKU Retail dùng `channel = retail`.
- [ ] SKU FnB dùng `channel = fnb`.
- [ ] Không tạo trùng NVL FnB cho hàng đã là SKU Retail.
- [ ] Đơn vị tính và quy đổi đơn vị đã thống nhất.

### Tồn kho

- [ ] Kho tổng có tồn đầu nguồn.
- [ ] Quán FnB đã nhận hàng thành phần.
- [ ] Tồn Quán FnB không âm bất thường trước khi bán test.

### BOM

- [ ] Món FnB quan trọng có BOM.
- [ ] Size M/L có BOM riêng nếu định lượng khác.
- [ ] BOM của Quán FnB tham chiếu SKU Retail tại quán.
- [ ] BOM riêng chi nhánh đã tạo nếu cần cascade tại quán.
- [ ] Modifier scale đã gắn đúng dòng cần scale.
- [ ] Không thêm nắp, ống hút hoặc đá vào BOM của Xưởng Tư Búa.

### POS và báo cáo

- [ ] POS FnB thấy đúng menu.
- [ ] KDS nhận đúng món cần bếp/bar.
- [ ] Thanh toán tạo hóa đơn.
- [ ] Tồn SKU Retail thành phần giảm đúng.
- [ ] Báo cáo FnB ghi nhận doanh thu đúng.

## 14. Ví Dụ Hoàn Chỉnh

### 14.1. Hàng Retail Đầu Vào

| Mã | Tên | Loại | Channel | ĐVT |
|---|---|---|---|---|
| `SKU-CPH-RX-001` | Cà phê rang xay | sku | retail | Kg |
| `SKU-SUA-LON-001` | Sữa đặc lon | sku | retail | Lon |
| `SKU-LY-500-001` | Ly nhựa 500ml | sku | retail | Cái |
| `SKU-NAP-500-001` | Nắp ly 500ml | sku | retail | Cái |

### 14.2. Món FnB

| Mã | Tên | Loại | Channel | ĐVT | Has BOM |
|---|---|---|---|---|---|
| `SKU-FNB-BX-001` | Bạc xỉu | sku | fnb | Ly | true |

### 14.3. BOM Bạc Xỉu Size M Tại Quán A

| Mã BOM | Chi nhánh | Hàng thành phần | Mã hàng | Số lượng | ĐVT |
|---|---|---|---|---:|---|
| `BOM-FNB-QA-BX-M` | Quán A | Cà phê rang xay | `SKU-CPH-RX-001` | 0.018 | Kg |
| `BOM-FNB-QA-BX-M` | Quán A | Sữa đặc lon | `SKU-SUA-LON-001` | 0.030 | Lon |
| `BOM-FNB-QA-BX-M` | Quán A | Ly nhựa 500ml | `SKU-LY-500-001` | 1 | Cái |
| `BOM-FNB-QA-BX-M` | Quán A | Nắp ly 500ml | `SKU-NAP-500-001` | 1 | Cái |

### 14.4. Kết Quả Đúng Sau Khi Bán 1 Ly

Tồn trước:

| Hàng | Tồn trước |
|---|---:|
| `SKU-CPH-RX-001` | 5.000 Kg |
| `SKU-SUA-LON-001` | 10.000 Lon |
| `SKU-LY-500-001` | 200 Cái |
| `SKU-NAP-500-001` | 200 Cái |

Tồn sau:

| Hàng | Tồn sau |
|---|---:|
| `SKU-CPH-RX-001` | 4.982 Kg |
| `SKU-SUA-LON-001` | 9.970 Lon |
| `SKU-LY-500-001` | 199 Cái |
| `SKU-NAP-500-001` | 199 Cái |

Nếu kết quả này đúng, setup món Bạc xỉu đạt yêu cầu.

## 15. Quyết Định Chốt Cho OneBiz

Em đề xuất chốt logic như sau:

1. Retail và FnB tách channel, tách menu, tách báo cáo.
2. SKU Retail là hàng bán/cấp sang quán và có thể làm hàng thành phần trong BOM FnB.
3. Không tạo "NVL FnB" riêng nếu hàng đó đã là SKU Retail đầu vào.
4. Quán FnB phải có tồn SKU Retail trước khi bán món FnB.
5. SKU FnB là món bán, dùng `channel = fnb`, có BOM nếu cần trừ nguyên liệu.
6. BOM FnB tại quán nên là BOM riêng chi nhánh và tham chiếu SKU Retail tại quán.
7. Excel BOM cột "Mã NVL" được hiểu là mã hàng thành phần bị trừ tồn; trong mô hình này thường là mã SKU Retail.
8. Mọi setup mới phải test 1 món: POS FnB bán món, Lịch sử kho trừ đúng, Tồn kho đúng, Báo cáo FnB đúng.

Nếu làm đúng 8 điểm này, hệ thống vừa tách được Retail/FnB để báo cáo, vừa nối được dòng hàng từ Kho tổng sang Quán FnB và tiêu hao theo công thức.

## 16. File Cũ Đã Tham Chiếu

Tài liệu mới này được viết lại sau khi đối chiếu:

- `docs/_archive/HUONG-DAN-SETUP-FNB-V2.md`
- `docs/_archive/HUONG-DAN-TAO-SKU-FNB-CU-THE.md`
- `docs/_archive/HUONG-DAN-NVL-SKU-BOM.md`
- `docs/_archive/HUONG-DAN-SETUP-FNB-CHI-TIET.md`
- `docs/HUONG-DAN-CAI-DAT-ONEBIZ.md`

Các phần cũ hướng dẫn tạo "NVL FnB" riêng chỉ nên xem là logic cũ. Theo mô hình anh đã chốt, đầu vào của FnB ưu tiên dùng SKU Retail được cấp sang quán.
