# Hiện trạng QC OneBiz

## Mục tiêu

Kiểm tra toàn bộ code, UX/UI, nút thao tác và luồng dữ liệu để các phân hệ OneBiz
vận hành nhất quán, đúng quyền, đúng doanh nghiệp/chi nhánh và không làm sai dữ liệu.

## Nguyên tắc an toàn

- Chưa chạy hoặc sửa trực tiếp database production.
- Không chạy migration `00241_rls_layer2_batch2.sql` hiện tại.
- Không dùng service role làm kết quả nghiệm thu RLS.
- Không sửa dữ liệu kinh doanh để thử nút hoặc luồng.
- Mọi bản ghi UAT sau này phải thuộc tenant kiểm thử hoặc có tiền tố `QC_` và danh
  sách ID dọn dẹp riêng.
- Mỗi nhóm sửa có commit, test và phương án quay lại riêng.

## Phạm vi đã kiểm kê

- 158 trang, gồm 145 trang production và 13 trang mockup.
- 66 API routes.
- 61 đường dẫn trong menu, hiện đều có page tương ứng.
- 1.136 nút/hành động JSX được phát hiện trên toàn bộ mã nguồn production.
- 684 file nguồn có khả năng tham gia luồng web.
- 992 điểm truy cập bảng, RPC hoặc API.
- 375 điểm có khả năng ghi dữ liệu.
- 108 điểm ghi vào dữ liệu nhạy cảm cần đối chiếu thủ công.

Các con số là kết quả kiểm kê tĩnh, không phải số lỗi đã xác nhận.

## Phát hiện đã xác nhận

### P0 - Không được chạy migration hiện tại

`00241_rls_layer2_batch2.sql` không đủ điều kiện chạy:

- Bỏ sót `sales_returns`.
- Tự bổ sung đủ bốn quyền cho bảng dù quyền thiếu có thể là chủ ý.
- Có thể mở sửa/xóa cho hồ sơ, thông báo, audit và sổ cái.
- Copy một biểu thức policy bất kỳ bằng `LIMIT 1` cho nhiều thao tác khác nhau.
- Tạo policy chuyển kho không idempotent.
- Trạng thái policy chuyển kho trong repo và lời mô tả database đang mâu thuẫn.

### P0 - Luồng ghi trực tiếp phải được xử lý trước RLS

Web hiện còn nhiều luồng ghi trực tiếp từ component/service, gồm:

- Hóa đơn và dòng hóa đơn.
- Phiếu nhập và dòng phiếu nhập.
- Kiểm kho, trả hàng, chuyển kho.
- Giao dịch tiền mặt và sổ kho.
- Hồ sơ người dùng, chi nhánh và thiết lập doanh nghiệp.

Không được bật RLS theo giả định rằng tất cả thao tác ghi đều đi qua RPC.

### P1 - Kiểm thử hiện tại chưa đủ làm điều kiện nghiệm thu

- Test tenant hiện có chủ yếu là kiểm tra tĩnh, chưa gọi database với hai JWT thật.
- Bộ `npm run test:run` vượt giới hạn 5 phút do toàn bộ test dùng `jsdom`; các nhóm smoke, báo cáo, MKT, E2E và dịch vụ trọng yếu khi chạy riêng đều đạt.
- Ba thao tác bán hàng, nhập hàng và hủy đơn nháp chỉ là smoke test, không đủ xác
  nhận phân quyền, cách ly tenant/chi nhánh hoặc tính toàn vẹn dữ liệu.

## Rào chắn RLS bắt buộc

- Sáu bảng con không có `tenant_id` phải lọc qua bảng cha bằng `EXISTS`.
- `profiles` không cấp insert/delete cho người dùng đăng nhập; tự sửa chỉ dòng mình.
- `notifications` và `favorites` lọc theo `user_id = auth.uid()`.
- `tenants` lọc theo `id = get_user_tenant_id()`.
- Không cấp delete rộng cho audit, sổ kho, sổ điểm hoặc sử dụng coupon.
- `stock_movements` chỉ được chốt quyền update sau khi rà hết luồng trạng thái và RPC.
- Policy permissive của PostgreSQL có thể gộp bằng OR; thêm policy lỏng có thể mở quyền.
- Phải đọc `pg_policy`, quyền bảng, owner và hàm `SECURITY DEFINER` trên database thật.
- Chỉ thay file `00241` nếu xác nhận chưa chạy; nếu đã chạy phải tạo migration sửa mới.

## Tài liệu sinh tự động

- `WEB-QC-MATRIX.md`: phạm vi route và trang.
- `WEB-QC-INVENTORY.json`: dữ liệu chi tiết route, action và data call cấp trang.
- `DATA-FLOW-MAP.md`: bản đồ điểm truy cập dữ liệu toàn mã nguồn.
- `DATA-FLOW-INVENTORY.json`: dữ liệu chi tiết bảng, RPC và API.
- `BUTTON-ACTION-MATRIX.md`: điểm cần kiểm tra nút/handler.
- `BUTTON-ACTION-INVENTORY.json`: dữ liệu chi tiết từng hành động JSX.

## Bước tiếp theo

1. Rà 108 điểm ghi nhạy cảm theo quyền, tenant, chi nhánh và trạng thái chứng từ.
2. Rà các nút không có handler rõ ràng, nút biểu tượng thiếu nhãn và chống bấm lặp.
3. Chốt danh sách lỗi P0-P3 có bằng chứng file/dòng và kịch bản tái hiện.
4. Sửa P0/P1 theo từng nhóm nhỏ trước khi đụng tới RLS.
