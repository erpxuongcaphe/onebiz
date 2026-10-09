# Nghiệm Thu Và Hoàn Thiện Trung Tâm Báo Cáo

Biên bản chính dùng tiếng Việt. Không đánh dấu đạt khi mới rà mã nguồn hoặc có
nút xuất file. Số liệu kiểm tra phải cùng chi nhánh, cùng kỳ và cùng thời điểm.

## Phạm Vi Và Giới Hạn

- Chỉ sửa cách đọc báo cáo, bộ lọc, sắp xếp, bảng biểu và xuất Excel.
- Không sửa hóa đơn, tiền, tồn kho, công nợ, giá bán hay công thức đã ghi nhận.
- Tồn đầu kỳ và sửa dữ liệu đầu kỳ do chat khác xử lý, không làm trùng.
- Ngày nghiệp vụ và ngày thực thu/chi là hai đối tượng khác nhau.
- Đơn giá báo cáo bằng thành tiền lịch sử / số lượng cùng ĐVT; không thay đổi
  phương pháp tính giá vốn và không cộng đơn giá vào tổng.
- Thiếu giá lịch sử phải để trống/cảnh báo, không tự lấy giá hiện tại để bù.

## Đã Đạt Và Đã Phát Hành

PR588 đã merge ở `3b3f9dfdf001d5ebe154aaaea039f1cff05a4964`. Vercel READY,
alias `onebiz.com.vn` đã nhận đúng commit. CI đạt 540 tệp kiểm thử, build và
PostgreSQL cô lập thành công. Đã kiểm trang chính thức sau phát hành.

Kho Tổng, kỳ 01–09/10/2026 theo ngày Việt Nam:

| Nội dung | Nguồn chứng từ | Kết quả |
| --- | ---: | --- |
| Nhập trong kỳ | 43.571.322,82đ | Khớp báo cáo |
| Xuất trong kỳ | 60.474.893,31936đ | Khớp số hiển thị 60.474.893,32đ |
| Thu tiền | 58.752.960đ | Khớp 19 phiếu hoàn thành |
| Chi tiền | 38.242.218đ | Khớp 18 phiếu hoàn thành |
| Dòng tiền ròng | 20.510.742đ | Khớp |
| Tiền hàng bán | 71.212.080đ | Khớp 24 hóa đơn |
| Phí giao hàng | 101.000đ | Hiển thị riêng với tiền hàng |
| Giá vốn bán | 56.294.319,11đ | Khớp 223 dòng, không thiếu giá |
| Tiền hàng trả | 1.150.000đ | Khớp phiếu trả trong kỳ |
| Giá vốn hàng trả | 1.000.000đ | Lấy dòng bán gốc |
| Giá vốn sau trả | 55.294.319,11đ | Khớp |

Đã sửa ngày chứng từ thu/chi, bộ tìm/sắp xếp/Excel nhân viên, nhãn doanh số,
không cộng trùng khách giữa nhóm, không cộng số lượng khác ĐVT ở cuối ngày.

## Danh Sách Còn Lại

| Mục | Trạng thái | Điều kiện đạt |
| --- | --- | --- |
| Giá trị theo từng loại nhập/xuất | Đang xử lý | Mỗi loại có SL/đơn giá/thành tiền; tổng các loại bằng tổng kỳ; không bị tồn đầu thiếu giá che số kỳ |
| Tiêu hao BOM ròng | Đang xử lý | Tách xuất BOM/hoàn nhập/ròng; hoàn nhập khác kỳ vẫn đúng; thiếu giá của một nhóm không che nhóm khác |
| Liên kết xuống chứng từ | Chưa nghiệm thu toàn bộ | Giữ kỳ/chi nhánh, chứng từ gốc đúng; không dùng BOM hiện tại thay lịch sử |
| Bán hàng, kênh, nhà cung cấp, VAT, tuổi nợ | Chưa nghiệm thu toàn bộ | Đối chiếu từng nguồn; không cộng khách trùng, đơn vị khác nhau hoặc số liệu khác ngày |
| Excel từng báo cáo | Chưa nghiệm thu toàn bộ | Tệp thực tải xuống khớp nguồn đã lọc/sắp xếp; mã là văn bản; số không mất phần lẻ; AutoFilter không gồm dòng tổng |
| UX bảng biểu | Rà song song | Mã/cột đầu và tiêu đề cố định; cuộn ngang luôn với tới; chữ/số/nút không chồng; rõ trạng thái tải/lỗi/trống |
| Tồn đầu/cuối thiếu giá | Ngoài phạm vi | Chat phụ trách đầu kỳ nghiệm thu riêng |

## Quy Trình Chốt Mỗi Mục

1. Đọc nguồn thực tế và định nghĩa RPC, xác định cách tính.
2. Kiểm thử dữ liệu giả: thiếu giá, 0đ, trả khác kỳ, nhiều ĐVT, quyền/chi nhánh.
3. CI/PostgreSQL đạt rồi mới áp migration đã duyệt và merge/deploy.
4. Kiểm đúng commit trên production, tải Excel và đối soát chứng từ nguồn.
5. Ghi kết quả bằng tiếng Việt: Đạt / Chưa đạt / Chưa có dữ liệu để kiểm.

Ngày 09/10 anh đã duyệt migration chỉ đọc bổ sung hai báo cáo trên sau khi
kiểm thử đạt. Không phải duyệt chỉnh dữ liệu lịch sử hoặc mở rộng quyền.
