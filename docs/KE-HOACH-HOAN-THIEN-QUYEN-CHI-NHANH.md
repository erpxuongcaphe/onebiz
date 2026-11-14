# Hoàn thiện quyền theo chi nhánh

Mục tiêu: cho người quản trị chọn đúng quyền theo quán, không thay đổi quyền đã có và không ảnh hưởng thanh toán hoặc in. Chỉ đưa một quyền vào danh mục chọn theo chi nhánh khi tất cả đường đọc, ghi, xuất và API của quyền đó đã kiểm tra cùng phạm vi.

1. **Hub vận hành và QC:** đối chiếu các thao tác tại quán, người được phân công và quyền chức vụ. Đặc biệt kiểm tra đường công việc cộng tác, bằng chứng, phân công, QC và dữ liệu dùng chung; một số hàm còn gọi quyền toàn tài khoản. Giữ nguyên phân công hiện tại.
2. **MKT, báo cáo, hàng hóa và nhân sự:** phân biệt dữ liệu thuộc một quán, tổng hợp nhiều quán được giao và danh mục dùng chung. Không hứa giới hạn theo quán đối với thay đổi thực sự có hiệu lực toàn công ty; ghi rõ trên màn hình.
3. **Giao diện:** quyền có thể giới hạn theo quán xuất hiện trong nhóm tương ứng; quyền chung, quyền cũ và quyền in được giải thích đúng phạm vi. Hỗ trợ chọn cả nhóm mà không tác động quyền đang ẩn hoặc thuộc phạm vi khác.
4. **Nghiệm thu:** đối chiếu trước/sau theo tài khoản, hai chi nhánh và ngoại lệ cấp/chặn; kiểm tra đường đọc, ghi, xuất, truy cập trực tiếp, phiên cũ, bán hàng F&B/Retail và hàng đợi in. Dùng dữ liệu giả, không phát sinh đơn thật hay in lại phiếu cũ.
5. **Phát hành:** chỉ kích hoạt từng nhóm sau khi máy chủ và giao diện đã sẵn sàng, CI đạt trên đúng commit và kiểm tra đúng ONEBIZ; xác nhận trạng thái đăng nhập, POS và kết nối điểm in sau triển khai.

Không mặc định coi mọi quyền đang báo “chưa thể chỉnh riêng” là lỗi: số này gồm quyền dùng chung và quyền theo cơ chế khác. Không tự chuyển quyền cũ hoặc phân công nhân sự khi phát hành.

## Tiến độ thử nghiệm Hub

- Đã chuẩn bị ba hàm lõi `ops_can`, `ops_manager`, `ops_q_can`, công việc cộng tác, danh sách Hub, bằng chứng, đường xử lý QC và lối vào giao diện để xét quyền riêng tại chi nhánh. Bản này chỉ ở nhánh thử và chưa đưa các quyền Hub vào danh mục có thể chỉnh.
- PostgreSQL thử nghiệm đã kiểm tra cấp tại một quán, chặn tại quán khác, so sánh quyền cũ, QC, bằng chứng, bình luận cộng tác và quyền chặn toàn tài khoản; dữ liệu thử đã được hoàn tác. Phân công văn phòng ở quán khác giữ hành vi cũ khi không có ngoại lệ.
- Chưa phát hành: tiếp tục kiểm tra các đường đọc/ghi khác, quyền MKT và các nhóm còn lại trước khi bật danh mục. Ba migration thử có phiên bản sớm hơn lịch sử production hiện tại; phải dùng thư mục triển khai tách riêng, dry-run đúng danh sách và kiểm tra lịch sử trước khi áp, không chạy `include-all` trên toàn kho.
