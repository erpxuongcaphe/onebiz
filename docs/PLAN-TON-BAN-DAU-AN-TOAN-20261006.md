# Tồn ban đầu: kế hoạch và tiêu chí nghiệm thu

Mục tiêu: quán mới, chuyển phần mềm, bắt đầu quản lý kho hoặc bổ sung giá vốn cho hàng đang có. Không dùng nhập đầu kỳ để ghi đè lịch sử bán hàng, để nhập lại mỗi tháng, hoặc thay phiếu mua/chuyển kho.

## Cách dùng

Giữ lối vào Kho → Tồn kho → Nhập tồn ban đầu. Ba bước: chọn mục đích/thời điểm và file; xem trước chi nhánh, đơn vị, lượng trước/sau và giá trị; xác nhận. Không bắt người dùng mở khóa toàn hệ thống để làm việc bình thường. Khóa tenant cũ vẫn được tôn trọng nếu quản lý đã chủ động chốt.

File cũ tiếp tục dùng được. Mỗi đợt một chi nhánh để tránh nhập nhầm. Không cộng tổng số lượng khác đơn vị. Dòng không có trong file không đổi; 0 là đưa về 0, không phải bỏ qua. Giá vốn 0 cần nhãn rõ, không suy giá thiếu thành 0.

Giữ Kiểm kê để xử lý chênh lệch sau vận hành. Giữ bổ sung giá vốn đầu kỳ tại Hàng cấp cho quán, với liên kết dễ thấy. Đã có sự kiện giá vốn thì không ghi đè bằng công cụ khởi tạo; hướng dẫn kiểm kê/đối soát theo đúng nghiệp vụ.

## Bảo vệ dữ liệu

- Preview do server đọc; truyền lại snapshot lượng, sự kiện kho và giá vốn khi xác nhận. Nếu đã thay đổi thì tải lại xem trước, không khóa POS toàn quán.
- Một transaction cho toàn file: lượng, giá trị, sự kiện, lịch sử và audit cùng thành công hoặc cùng rollback.
- Mã đợt chống gửi lặp; cùng mã nhưng payload khác bị từ chối.
- Quyền inventory.adjust và phạm vi chi nhánh kiểm tra tại server. Không tin tenant/actor truyền từ client.
- Không cập nhật giá Retail khi khởi tạo giá vốn quán F&B. Chi nhánh ngoài F&B nếu giá vốn dùng chung cần thay đổi và nơi khác có hàng thì yêu cầu đối soát trước, không tự ảnh hưởng nơi khác.
- Không tạo phiếu thu/chi, nợ NCC hay đơn mua hàng cho tồn đã sở hữu.
- Ngày giờ chốt là thông tin nguồn đối chiếu; ngày ghi nhận thực tế không được giả thành ngày quá khứ. Không tự hồi tố báo cáo lịch sử.
- Phiếu đã ghi bất biến, lưu file nguồn/tổng giá trị/mục đích/người ghi và từng dòng trước/sau. Không có nút xóa/reset dữ liệu thật.

## Kiểm chứng

PostgreSQL độc lập: nhập lần đầu, bổ sung giá vốn cho lượng có sẵn, rollback khi một dòng lỗi, lặp request, snapshot cũ, sai quyền/tenant/chi nhánh, menu F&B, giá vốn riêng không đổi Retail. UI: lỗi file, trước/sau, ngày giờ/lý do, gửi lặp, mobile và desktop. CI/typecheck/build trước phát hành. Không import tồn thật khi kiểm thử.

## Phối hợp

MKT Hub Onebiz phụ trách báo cáo XNT. Worktree này chỉ thay nhập tồn, preview, lịch sử đợt và kiểm thử liên quan. Migration mới không chạy sửa/bù dữ liệu hiện hữu; chỉ thêm cơ chế ghi có xác nhận.
