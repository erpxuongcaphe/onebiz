# Checklist chuẩn bị dữ liệu trước khi vận hành FnB

> Cập nhật 26/08/2026. Đây là trình tự nhập và nghiệm thu dữ liệu, không phải
> hướng dẫn chạy migration. Các lớp máy chủ 00330 (guard Size) và 00343
> (thanh toán V3) đã live; bộ preflight sẽ kiểm lại bản đang cài.

## Nguyên tắc

- Không nhập hàng loạt 124 món ngay từ đầu.
- Không bật đồng thời nhóm tùy chọn Size cũ và quy cách M/L/XL mới trên cùng món.
- Mỗi quy cách đang bật phải có giá lớn hơn 0, đúng một cỡ mặc định và BOM riêng.
- Không dùng công thức món cha cho cỡ L/XL. Định lượng các cỡ thường không tăng đều.
- Không tạo đơn thử hoặc chỉnh dữ liệu khách thật để nghiệm thu.
- Chỉ UAT bằng dữ liệu mẫu được CEO cho phép; mọi đối chiếu sau thao tác là chỉ đọc.

## Bước 0 - Đo hiện trạng

Chạy toàn bộ file:

`docs/qc/sql/FNB-GO-LIVE-PREFLIGHT-READONLY.sql`

File đã khóa tenant `OneBiz Coffee Demo` (`148e8ac5-b891-4de3-9055-cfa41f39ddb0`),
không cần dán UUID. Các dòng `DIEU_KIEN` phải có `dat=true`. Dòng `THONG_TIN`
dùng để lập danh sách công việc, không phải lỗi tự động.

## Bước 1 - Chọn bộ mẫu dọc

Chỉ cấu hình bốn mẫu đầu tiên:

1. **Hồng Trà** một giá, không size, có Mức đường/Mức đá và định lượng đường riêng cho từng lựa chọn.
2. Một đồ uống có M/L, mỗi cỡ một giá và một BOM riêng.
3. Một món bán nguyên trạng, BOM 1:1 trỏ tới SKU đang giữ tồn.
4. Một topping có giá theo phần và BOM riêng.

Chưa nhân sang món thứ hai nếu một mẫu chưa qua UAT.

## Bước 2 - Chuẩn hóa nguyên liệu và đơn vị

- Mã nguyên liệu và đơn vị kho phải đúng trước khi nhập BOM.
- Kiểm tra quy đổi, ví dụ `1 thùng = 12 hộp`; không đảo chiều hệ số.
- Mỗi dòng BOM có nguyên liệu, đơn vị và định lượng lớn hơn 0.
- Định lượng được cân/đo thực tế; không ước lượng bằng mắt.
- Món bán nguyên trạng dùng công thức 1:1 đúng đơn vị và đúng chi nhánh.

## Bước 3 - Nhập giá và quy cách

Trong **Hàng hóa → Danh sách sản phẩm → Sửa → Quy cách**:

- Món một giá: giá bán gốc lớn hơn 0.
- Món nhiều cỡ: tên cỡ không trống/không trùng; giá từng cỡ lớn hơn 0.
- Chọn đúng một cỡ mặc định, thông thường là M.
- Bật **Trừ kho theo công thức từng cỡ**.
- Mỗi cỡ phải có ít nhất một nguyên liệu với định lượng lớn hơn 0.

Form hiện chặn lưu nếu thiếu một điều kiện trên. Máy chủ tiếp tục chặn lần hai
khi gửi bếp, nên không thể lách bằng devtools.

## Bước 4 - Rà tùy chọn món

- Nhóm bắt buộc chọn một phải có đúng một lựa chọn mặc định.
- Nhóm chọn một không bắt buộc có tối đa một mặc định.
- Một lựa chọn không được vừa nhân định lượng (`scale_factor`) vừa liên kết SKU
  trừ kho, vì sẽ có nguy cơ trừ hai lần.
- Với đường/syrup, sau khi gắn nhóm vào dòng BOM phải bật **Dùng định lượng riêng** và nhập đủ mọi lựa chọn, kể cả `0` cho "Không đường". Không dùng phần trăm chung để suy công thức của món khác.
- Đá và ghi chú pha chế chỉ là phục vụ tại quầy, không gắn SKU/NVL theo quy ước hiện tại.
- Premium Coffee và Trà cần rà từng món trước khi gắn Đường/Đá/Size/Topping.

## Bước 5 - Topping SKU

- Mỗi `SKU-TPP` đang bật có giá bán lớn hơn 0 và BOM đang bật.
- Giá lấy từ `products.sell_price` và được máy chủ kiểm soát.
- Giữ nhóm Topping cũ làm vỏ cấu hình; POS tự ẩn nhóm khi không còn lựa chọn đang bật. Không xóa nhóm chỉ vì đang chưa dùng.
- Cờ `NEXT_PUBLIC_FNB_TOPPING_SKU` chỉ bật sau khi preflight không còn topping lỗi.

## Bước 6 - Hạ tầng quán

- Tạo trạm bếp/bar cho chi nhánh quán sẽ vận hành.
- Tạo khu và bàn nếu phục vụ tại bàn; mô hình chỉ mang đi không bắt buộc có bàn.
- Kiểm quyền quản lý bàn/sơ đồ và quyền nhân viên vận hành trước ngày mở bán.
- Không đóng F1b thu hồi ghi thẳng cho tới khi UAT cấu hình bàn đủ 5 mục đã chốt.

## Bước 7 - Chạy lại preflight

Chỉ chuyển sang UAT khi dòng `Z_KET_LUAN` trả:

`ĐẠT CỔNG DỮ LIỆU - được phép UAT có kiểm soát`

Nếu chưa đạt, xử lý đúng dòng `DIEU_KIEN` lỗi; không sửa SQL và không bỏ guard.

## Bước 8 - UAT một lát cắt dọc

Với bốn mẫu ở Bước 1, kiểm theo thứ tự:

1. POS chọn món/cỡ/tùy chọn đúng và phiếu bếp hiển thị đủ.
2. Gửi bếp không sinh đơn lặp.
3. Thanh toán đúng tổng, phương thức, tiền thực thu hoặc công nợ.
4. Tồn chi nhánh và FIFO trừ đúng nguyên liệu của đúng cỡ.
5. Giá vốn khớp BOM.
6. Hủy/trả hoàn đúng nguyên liệu và đúng cỡ, không hoàn vào món menu.
7. Sổ kho, sổ quỹ và báo cáo tham chiếu đúng chứng từ.

Đạt cả bốn mẫu mới nhân dữ liệu theo thứ tự: **Rang xay → Trà Sữa → Cà phê
tươi → các nhóm còn lại**. Mỗi nhóm chạy lại preflight trước khi bật.

## Điều kiện go-live

- Preflight đạt toàn bộ điều kiện.
- Bộ mẫu UAT đạt và có số đối chiếu.
- Nhân viên đã được phân quyền, mở ca và thao tác bếp/thanh toán đúng.
- Có phương án quay về Size cũ bằng cách tắt quy cách mới; không xóa dữ liệu.
- Không còn món giá 0 xuất hiện trên POS của chi nhánh live.
