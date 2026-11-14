# Hoàn thiện quyền theo chi nhánh

Mục tiêu: cho người quản trị chọn đúng quyền theo quán, không thay đổi quyền đã có và không ảnh hưởng thanh toán hoặc in. Chỉ đưa một quyền vào danh mục chọn theo chi nhánh khi tất cả đường đọc, ghi, xuất và API của quyền đó đã kiểm tra cùng phạm vi.

1. **Hub vận hành và QC:** đối chiếu các thao tác tại quán, người được phân công và quyền chức vụ. Đặc biệt kiểm tra đường công việc cộng tác, bằng chứng, phân công, QC và dữ liệu dùng chung; một số hàm còn gọi quyền toàn tài khoản. Giữ nguyên phân công hiện tại.
2. **MKT, báo cáo, hàng hóa và nhân sự:** phân biệt dữ liệu thuộc một quán, tổng hợp nhiều quán được giao và danh mục dùng chung. Không hứa giới hạn theo quán đối với thay đổi thực sự có hiệu lực toàn công ty; ghi rõ trên màn hình.
3. **Giao diện:** quyền có thể giới hạn theo quán xuất hiện trong nhóm tương ứng; quyền chung, quyền cũ và quyền in được giải thích đúng phạm vi. Hỗ trợ chọn cả nhóm mà không tác động quyền đang ẩn hoặc thuộc phạm vi khác.
4. **Nghiệm thu:** đối chiếu trước/sau theo tài khoản, hai chi nhánh và ngoại lệ cấp/chặn; kiểm tra đường đọc, ghi, xuất, truy cập trực tiếp, phiên cũ, bán hàng F&B/Retail và hàng đợi in. Dùng dữ liệu giả, không phát sinh đơn thật hay in lại phiếu cũ.
5. **Phát hành:** chỉ kích hoạt từng nhóm sau khi máy chủ và giao diện đã sẵn sàng, CI đạt trên đúng commit và kiểm tra đúng ONEBIZ; xác nhận trạng thái đăng nhập, POS và kết nối điểm in sau triển khai.

Không mặc định coi mọi quyền đang báo “chưa thể chỉnh riêng” là lỗi: số này gồm quyền dùng chung và quyền theo cơ chế khác. Không tự chuyển quyền cũ hoặc phân công nhân sự khi phát hành.

## Tiến độ triển khai

- Đã chuẩn bị ba hàm lõi `ops_can`, `ops_manager`, `ops_q_can`, công việc cộng tác, danh sách Hub, bằng chứng, đường xử lý QC và lối vào giao diện để xét quyền riêng tại chi nhánh. Các quyền này đã đưa vào danh mục có thể chỉnh theo chi nhánh.
- PostgreSQL thử nghiệm đã kiểm tra cấp tại một quán, chặn tại quán khác, so sánh quyền cũ, QC, bằng chứng, bình luận cộng tác và quyền chặn toàn tài khoản; dữ liệu thử đã được hoàn tác. Phân công văn phòng ở quán khác giữ hành vi cũ khi không có ngoại lệ.
- Khi phát hành đã dùng thư mục migration tách riêng và dry-run đúng danh sách; tiếp tục áp dụng nguyên tắc này cho các nhóm còn lại, không chạy `include-all` trên toàn kho.

- PR #990 đã triển khai lên ONEBIZ: 7 quyền Hub theo chi nhánh, có lựa chọn cả nhóm. Không tự gán ngoại lệ cho nhân viên. Trước phát hành đã đối chiếu 994 phép kiểm tra quyền cũ; sau phát hành đã mở hồ sơ và POS, ba điểm in có tín hiệu. Chưa thử in giấy thực tế.
- PR #991 đã tách rõ các quyền toàn công ty khỏi các quyền chưa hỗ trợ giới hạn theo quán.
- PR #992 đã triển khai ba quyền Marketing `mkt.view`, `mkt.manage_campaigns`, `mkt.split_work_packages` theo chi nhánh. Các quyền Marketing còn lại chưa được chứng nhận hỗ trợ chỉnh riêng theo chi nhánh; không suy diễn rằng đã hoàn tất toàn bộ Marketing. Không tự gán ngoại lệ cho nhân viên.
- Sau triển khai #992: trang nhân sự và danh sách chiến dịch mở được; POS Premium tải danh sách món; ba điểm in gửi tín hiệu. Các lệnh đã bàn giao cho bộ nhận không chứng minh giấy đã in; chưa nghiệm thu giấy thực tế trong đợt này.
- PR #993 bổ sung quyền `mkt.review_content` theo chi nhánh, đồng bộ đường xem, duyệt và nút thao tác; nội dung dùng chung vẫn theo quyền toàn tài khoản. Máy chủ đã áp dụng; chỉ coi bản phát hành hoàn tất khi giao diện của PR lên production và được kiểm tra lại.
- Ưu tiên quyền theo nghiệp vụ có dữ liệu chi nhánh; quyền in hiện tại, quyền dùng chung và các quyền cũ không tự đổi. Không làm thêm cơ chế tách giả cho dữ liệu toàn công ty.
