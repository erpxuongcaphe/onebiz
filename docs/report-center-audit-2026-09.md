# Rà soát Trung tâm báo cáo (23/09/2026)

Phạm vi: 36 mục trong `REPORT_CATALOG` và các màn `/phan-tich`. Đây là rà soát mã nguồn và hợp đồng dữ liệu, **không** phải xác nhận số liệu sản xuất với chứng từ thật. Không chạy thao tác ghi dữ liệu.

Bổ sung theo yêu cầu: mẫu bảng dùng chung và các màn danh sách Retail/F&B toàn web (46 trang có `DataTable` hoặc `ReportDataTable`). Con số này là phạm vi mã dùng bảng, không phải chứng nhận rằng cả 46 màn đã được nghiệm thu trực tiếp.

## Tiêu chí quản trị

Một báo cáo đủ dùng để quyết định và đối soát cần: kỳ và chi nhánh rõ ràng; định nghĩa chỉ tiêu/nguồn số; bảng có mã, ngày, đối tượng, số lượng/giá trị khi thích hợp; lọc/tìm/sắp xếp; đi từ tổng hợp xuống chứng từ; Excel đúng phạm vi và không bị giới hạn bởi top N; quyền xem dữ liệu chi tiết riêng; trạng thái tải/lỗi/không có dữ liệu phân biệt được.

Tham chiếu KiotViet: danh sách hóa đơn có bộ lọc theo thời gian, khách, hàng, nhân viên, chi nhánh; cột hiển thị và xuất tổng quan/chi tiết. Cách này xác nhận rằng biểu đồ và KPI chỉ nên là lớp đầu, không thay bảng đối soát. Không sao chép giao diện hay giả định mô hình dữ liệu của KiotViet phù hợp hoàn toàn với Retail + F&B của OneBiz.

## Kết quả theo nhóm

| Nhóm | Hiện trạng trong mã | Khoảng thiếu ưu tiên |
| --- | --- | --- |
| Điều hành | 5 báo cáo: tổng quan, cuối ngày, kênh, cảnh báo, đối chiếu ca. Có KPI và bảng, cuối ngày/đối chiếu là lối vào vận hành. | Các tổng số cần chỉ rõ chứng từ nguồn và thời điểm chốt; bảng ngày/kênh cần đường sang hóa đơn tương ứng. |
| Bán hàng | 6 báo cáo. `ban-hang` đã có góc theo ngày và theo hóa đơn có phân trang; trả hàng có bảng chi tiết. | Đặt hàng chỉ liệt kê tối đa 10 đơn gần đây; kênh/khuyến mãi còn nghiêng về tổng hợp. Cần bộ lọc trạng thái, kênh, nhân viên và drill-down chứng từ thống nhất. |
| Khách hàng | 4 báo cáo. `khach-san-pham` có các góc theo mặt hàng/ngày/hóa đơn. | RFM/cohort là phân tích nhóm; cần danh sách khách cấu thành từng nhóm, định nghĩa điều kiện và đối chiếu đơn gốc. |
| Hàng hóa & kho | 9 báo cáo. XNT, kiểm kê, lô, chênh lệch có bảng phục vụ kiểm soát kho. | `hang-hoa` và ABC tập trung xếp hạng; cần đường từ mã hàng sang lịch sử biến động/chứng từ. Phải giữ tách biệt NVL Retail, SKU bán Retail và tồn SKU tại quán F&B. |
| Tài chính | 4 báo cáo. Kết quả vận hành, tuổi nợ và VAT có bảng; các bản xuất nhiều sheet. | Luồng tiền hiện chủ yếu theo tháng; cần sổ giao dịch thu/chi theo chứng từ để giải thích số dư. Không gộp đặt cọc/ứng trước thành doanh thu hoặc chi phí. |
| Vận hành & đối tác | 8 báo cáo. F&B, thời gian phục vụ, shipper, nhân viên, nhà cung cấp có bảng. | F&B trước đây thiếu danh sách hóa đơn; top món lấy đơn bếp trước giảm giá, không phải doanh thu hóa đơn; mua hàng nhà cung cấp vẫn chủ yếu theo NCC, cần xuống phiếu nhập/thanh toán. |

## Đã xử lý trong nhánh này

- F&B: thêm hóa đơn theo ngày chứng từ, khách, tổng tiền, đã thu, còn nợ, phương thức; tải 50 dòng/lần và Excel đầy đủ theo trang. Chỉ hiển thị cho người có `reports.view_detail`. Chỉ đọc, lọc tenant/chi nhánh/kỳ/source F&B như KPI hiện tại.
- Bàn F&B: chỉ cộng một lần cho mỗi hóa đơn, bỏ hóa đơn hủy. Top món ghi đúng phạm vi 15 món từ đơn bếp hoàn thành, trước giảm giá.
- Chuẩn hóa sáu tên báo cáo trong danh mục và tiêu đề màn để nói rõ đối tượng/chiều phân tích.
- Bảng báo cáo dùng `ReportDataTable`: sắp xếp theo cột trên toàn bộ dòng đã tải trước khi phân trang, hỗ trợ số và tiếng Việt.
- Bảng danh sách dùng `DataTable`: không cho sắp xếp giả chỉ trên trang hiện tại khi trang được phân từ máy chủ. Có hợp đồng `sorting`/`onSortingChange` cho trang triển khai sắp xếp máy chủ.
- Danh mục Hàng hóa: nối mã, tên, giá bán, giá vốn (theo quyền) và thời gian tạo với `getProducts` để sắp xếp toàn bộ kết quả trước phân trang. Cột tồn theo chi nhánh/BOM và các cột tính từ bảng liên kết không gắn sắp xếp sai nguồn.
- Danh sách hóa đơn Retail: sắp mã, ngày chứng từ, khách, tổng tiền và giảm giá ngay ở truy vấn nguồn trước phân trang; các cột công nợ/hoàn trả tính từ nguồn khác vẫn chỉ hiển thị, không giả vờ sắp xếp toàn cục.
- Báo cáo thu chi: thống nhất ngày chứng từ với Sổ quỹ thay vì ngày tạo bản ghi; KPI Thu/Chi/Ròng cộng đúng toàn kỳ đã chọn, không lấy nhầm tháng cuối. Bổ sung danh sách phiếu thu/chi 50 dòng/trang và Excel toàn kỳ qua RPC Sổ quỹ, chỉ cho người có `finance.view_cash_book`. Biểu đồ/bảng tháng đổi nội dung theo nút xem; lũy kế được ghi rõ là **trong kỳ**, không phải số dư quỹ đầu kỳ hoặc báo cáo B03-DN.
- Xuất danh mục Hàng hóa theo đúng bộ lọc/thứ tự đang xem qua nhiều trang 1.000 dòng; không còn dựa vào một truy vấn `pageSize: 100000` vốn có thể bị giới hạn số dòng ở API.

## Bộ lọc và sắp xếp toàn web

Kiểm tra mã dùng chung cho thấy lỗi hệ thống là sắp xếp tại trình duyệt trong khi phân trang ở máy chủ. Đây là sai ngữ nghĩa, đặc biệt khi Retail có nhiều trang dữ liệu. Mẫu chung đã xử lý, nhưng không thể coi là đã hoàn thiện bộ lọc toàn web: mỗi nghiệp vụ phải chỉ định cột/scope được máy chủ hỗ trợ và xác nhận Excel dùng đúng tập đã lọc.

| Khu vực | Bộ lọc/sắp xếp cần kiểm tra tiếp |
| --- | --- |
| Retail: hóa đơn, đơn đặt, trả hàng | Mã/ngày/khách/trạng thái/kênh/nhân viên/chi nhánh; sắp ngày và số tiền toàn bộ kết quả; phân biệt ngày tạo với ngày chứng từ. |
| Retail: phiếu nhập, xuất, chuyển, kiểm kho | Mã phiếu, đối tác, kho nguồn/đích, trạng thái, ngày; không trộn tồn Kho Tổng với tồn quán F&B. |
| Hàng hóa Retail/F&B | Bộ lọc nhóm, thương hiệu, tồn, trạng thái và kênh phải khớp đúng scope đang xem; tồn khả dụng từ BOM không được sắp theo cột tồn vật lý. |
| Tài chính/công nợ | Chi nhánh, đối tác, loại chứng từ, trạng thái, kỳ; khoản ứng trước/cấn trừ phải nhìn riêng và không bị bộ lọc kỳ che mất số dư. |
| Báo cáo | Mọi lựa chọn kiểu biểu đồ/bảng, kỳ, chi nhánh, top N, nhóm phải thật sự thay dữ liệu; Excel đúng bộ lọc, không xuất âm thầm chỉ trang đầu. |

Tiếp theo phải kiểm kê từng màn danh sách, bắt đầu hóa đơn/phiếu nhập/trả hàng Retail và sổ thu chi; chỉ bật sắp xếp khi truy vấn nguồn có cột tương ứng. Cần nghiệm thu bằng dữ liệu nhiều trang ở hai chi nhánh, tránh kết luận từ một trang trống hoặc một bộ lọc đơn lẻ.

## Còn cần làm, theo thứ tự

1. **Đối soát số liệu nguồn (P0):** so F&B KPI, bảng theo giờ, bảng theo bàn, hóa đơn và phiếu trả theo cùng kỳ/chi nhánh; quy định xử lý hoàn tiền, hóa đơn sửa/hủy và nhiều lượt gửi bếp. Không kết luận đủ quản trị trước bước này.
2. **Chứng từ mua hàng và luồng tiền (P1):** bảng phiếu nhập/thanh toán theo NCC, sổ thu/chi theo chứng từ; lọc và xuất toàn bộ đúng quyền, không chỉ top N.
3. **Drill-down xuyên báo cáo (P1):** từ khách/món/kênh/khuyến mãi/ABC tới hóa đơn, từ tồn kho tới phiếu biến động, với cùng kỳ và chi nhánh.
4. **Cấu hình bảng (P2):** cột, thứ tự/sắp xếp, bộ lọc lưu theo người dùng; mặc định bảng chi tiết cho các báo cáo đối soát, biểu đồ chỉ là góc nhìn bổ sung.
5. **Định nghĩa chỉ tiêu (P2):** chú giải nguồn, công thức, VAT/chiết khấu/hoàn trả, thời điểm ghi nhận và độ trễ cập nhật ngay trên từng màn. Xác minh Excel khớp bộ lọc đang xem.

Nguyên tắc triển khai các bước còn lại: chỉ đọc trước, kiểm thử trên dữ liệu có thể đối soát, tách quyền xem chi tiết, không sửa dữ liệu/chứng từ Retail hoặc Kho Tổng để làm báo cáo “đẹp” hơn.
