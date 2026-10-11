# Hướng dẫn CEO thiết lập và sử dụng Hub Vận hành OneBiz

Ngày cập nhật: 11/10/2026. Tài liệu mô tả giao diện đã viết trong code. Chỉ sử dụng trên web thật sau khi hoàn tất nghiệm thu tích hợp và kích hoạt database. CEO tự cấu hình công việc; hệ thống không tự nạp danh sách công việc bắt buộc. Phần quyền mới trong bản Markdown này chưa được đồng bộ vào bản Word ngày 10/10.

## 1. Bắt đầu và các thuật ngữ

Đăng nhập bằng tài khoản OneBiz hiện có, vào `/hub`. Chọn chi nhánh và tháng ở thanh trên cùng. Không cần tài khoản riêng cho Hub, MKT hoặc bảo trì.

- **Standard Working:** mẫu quy định việc phải làm, kết quả cần đạt, người phụ trách và lịch thực hiện.
- **Công việc:** một lần thực hiện mẫu, có hạn riêng; ngày hôm sau vẫn sinh việc mới dù việc hôm trước chưa đạt.
- **KPI vận hành:** tỷ lệ công việc đạt đúng hạn; hệ thống tổng hợp từ kết quả công việc, không nhập lại bảng KPI.
- **KPI kinh doanh:** mức đạt chỉ tiêu doanh thu của kỳ; phải dùng cùng cơ sở tính với chỉ tiêu.
- **To-do:** việc phát sinh hoặc khắc phục việc chưa đạt, có trách nhiệm, người phối hợp và hạn xử lý riêng.
- **Xác minh:** người được phân quyền kiểm tra kết quả; người thực hiện không tự xác minh việc của mình.
- **Chốt kỳ:** giữ cố định kết quả, doanh thu, chỉ tiêu, chính sách và thưởng tại thời điểm chốt. Không tạo phiếu chi hay tự trả lương.

Tiền và số dùng dạng `1,234.56`; dấu phẩy chia hàng nghìn, dấu chấm chia thập phân. Ngày hiển thị `dd/mm/yyyy`, giờ nghiệp vụ là giờ Việt Nam. Ô chọn ngày của trình duyệt có thể hiển thị theo thiết bị, nhưng hệ thống lưu và tính hạn theo giờ Việt Nam.

## 2. Thiết lập người và quyền trước

1. Tại phần phân quyền chung OneBiz, chọn vai trò hoặc quyền riêng của tài khoản → nhóm **Hub vận hành**. Cấp **Xem Hub** và những thao tác cần thiết; không cấp tất cả chỉ vì người đó là quản lý.
2. Vào Hub, chọn chi nhánh → **Thiết lập** → **Phân công**. Chọn tài khoản OneBiz đã có, vai trò quản lý, xác minh hoặc phối hợp.
3. Chọn phạm vi thao tác tại chi nhánh, lưu và kiểm tra danh sách. Phân công tại Hub không tự cấp thêm quyền OneBiz.
4. Lặp lại ở chi nhánh khác nếu cần. Khi sửa người đã phân công, form nạp lại vai trò, tình trạng và các phạm vi trước đó.

| Quyền chung | Dùng khi nào |
|---|---|
| Xem Hub | Mở Hub và xem trong phạm vi được giao. Người phối hợp chỉ thấy To-do được giao, không xem cả chi nhánh. |
| Ghi kết quả và xử lý công việc | Quản lý thực hiện công việc, ghi kết quả, xử lý To-do hoặc nộp doanh thu. |
| Xác minh kết quả và doanh thu | Người kiểm tra xác minh người khác; không được tự xác minh kết quả của mình. |
| Cấu hình và duyệt | Tạo/duyệt tiêu chuẩn, chỉ tiêu, lịch và chính sách. Gom trong một nhóm để cấu hình không rắc rối. |
| Chốt kỳ và duyệt điều chỉnh | Người chịu trách nhiệm khóa kỳ và duyệt điều chỉnh có lịch sử. |
| Hủy công việc | Hủy To-do có lý do, không xóa lịch sử. |
| Phân công người và phạm vi Hub | Điều phối nhân sự trong chi nhánh đã được giao; không quản trị tài khoản OneBiz. |

CEO/owner giữ cơ chế toàn quyền hiện có trong doanh nghiệp mình. Các vai trò khác không tự nhận quyền Hub mới. Người được ủy quyền phân công không sửa phân công của chính mình, không cấp vượt quyền/phạm vi của mình và không cấp tiếp quyền phân công. CEO vẫn có thể phân công trưởng bộ phận tại nhiều chi nhánh.

Hiện CEO được nhận diện bằng tài khoản có vai trò hệ thống `owner` đang hoạt động. Đây là điều kiện kỹ thuật cần kiểm tra với tài khoản thực tế trước khi phát hành; không tự nâng quyền `admin`. Chưa cần tạo người dùng khi còn xây dựng. Khi bắt đầu dùng thật, mỗi công việc phải gắn người phụ trách đã được phân công quản lý ở chi nhánh.

Người văn phòng/bảo trì có thể được chọn làm người phối hợp To-do. Họ cần quyền **Xem Hub**, chỉ xem, trao đổi và gửi minh chứng ở các To-do được giao nếu chưa được cấp phạm vi rộng hơn. Không cần cấp quyền **Ghi kết quả và xử lý công việc** chỉ để phối hợp. Người phối hợp không tự đổi kết quả công việc hoặc duyệt thưởng. Thu hồi quyền Xem Hub sẽ chặn cả quyền truy cập các việc đã giao.

## 3. CEO tự tạo Standard Working

1. **Thiết lập** → **Standard Working**.
2. Nhập tên rõ hành động, mô tả kết quả cần đạt.
3. Chọn công việc riêng chi nhánh hoặc mẫu chung nhiều chi nhánh. Với mẫu chung, chọn từng chi nhánh và một quản lý phụ trách ở mỗi nơi.
4. Chọn tần suất ngày/tuần/tháng/sự kiện; ngày trong tuần hoặc tháng, giờ hạn và ngày bắt đầu.
5. Thêm tiêu chí và cấu hình theo bảng dưới.
6. **Lưu bản nháp** → kiểm tra → **Duyệt**. Chỉ mẫu được duyệt mới sinh công việc.

Popup cấu hình dùng gần hết màn hình. Bên trái chọn mục cần sửa; ở giữa nhập thông tin; bên phải kiểm tra lỗi và mô phỏng. Nút lưu cố định phía dưới. Trên điện thoại các khu vực xếp dọc; có thể cuộn nội dung mà không mất nút lưu.

| Trường | CEO điền thế nào |
|---|---|
| Tên tiêu chí | Một kết quả có thể kiểm chứng, không chỉ “đã làm”. |
| Phạm vi kiểm tra | Khu vực, chi nhánh, đối tượng hoặc thời đoạn cần đo. |
| Loại kết quả | Có/Không, số lượng, tỷ lệ %, thời gian tính bằng phút. |
| Điều kiện | Bằng, không vượt quá, nhỏ hơn, tối thiểu. |
| Mức cần đạt | Giá trị tương ứng với điều kiện. |
| Số lần kiểm tra | Từ 1 đến 50; thiếu lần kiểm tra không mặc định là đạt. |
| Các giờ kiểm tra | Bật **Giờ kiểm tra cố định**, chọn giờ cho từng lần, ví dụ 09:00 và 15:00; không chọn trùng. Tắt nếu không cố định. |
| Cơ sở tính tỷ lệ | Ghi rõ tử số/mẫu số, cùng đơn vị và kỳ: theo giá trị hoặc số lượng. |
| Lỗi nghiêm trọng | Bật khi việc không đạt cần ảnh hưởng điều kiện thưởng. |
| Bắt buộc minh chứng | Bật khi kết quả phải có ghi nhận/minh chứng để đủ điều kiện. |

Có 19 tiêu chí tham khảo; CEO có thể chọn rồi sửa hoặc tự tạo hoàn toàn. Chúng không thay thế danh sách công việc do CEO quyết định.

Ví dụ: chào khách trong 30 giây → loại thời gian, không vượt quá `0.5` phút. Hao hụt thấp hơn 0.7% → loại tỷ lệ, điều kiện **Nhỏ hơn**, ngưỡng `0.7`; cần quy định rõ tỷ lệ theo giá trị hay số lượng. Không dùng “≤ 0.7%” thay cho “< 0.7%”.

Thay mẫu đã duyệt bằng chức năng tạo phiên bản mới. Mẫu mới áp dụng từ ngày hiệu lực, không viết lại công việc và kỳ cũ. Công việc theo sự kiện được tạo riêng từ mẫu sự kiện đã duyệt.

## 4. Quản lý ghi kết quả mỗi ngày

1. Vào **Công việc**, chọn đúng chi nhánh/tháng; bộ lọc **Của tôi** giúp xem việc phụ trách.
2. Mở **Kết quả** của công việc.
3. Điền đủ các lần kiểm tra; với tỷ lệ nhập tử số và mẫu số. Database tự tính lại tỷ lệ, không tin số phần trăm do trình duyệt gửi.
   Ghi thời điểm đo thực tế cho từng lần. Nếu đã có quan sát phù hợp, bấm **Tìm quan sát dùng chung** và chọn bản ghi; hệ thống chỉ cho dùng lại khi cùng chi nhánh, ngày hạn, phạm vi, loại đo và lần/giờ kiểm tra. Muốn nhập một quan sát khác, chọn **Ghi quan sát mới** trước khi sửa số. Một lần đo dùng lại không được ghi thành nhiều lần đo thực tế.
4. Điền ghi nhận/minh chứng cho từng lần khi được yêu cầu. Có thể tải ảnh JPG/PNG/WebP hoặc PDF, tối đa 5 MB mỗi tệp, ở **Tệp minh chứng**. Tệp gắn công việc, không thay việc nhập kết quả từng tiêu chí.
5. Lưu; kiểm tra trạng thái Đạt/Chưa đạt/Chưa đủ kết quả và thời gian hoàn thành.

Tệp được lưu riêng tư, người ngoài doanh nghiệp không xem được. Đường dẫn tải có thời hạn một phút; không gửi đường dẫn đó làm tài liệu công khai. Minh chứng đã tải là bản ghi độc lập; đóng form mà chưa lưu kết quả không xóa tệp đã tải.

Không bấm nhiều lần khi nút đang lưu. Khi có thông báo người khác đã cập nhật, tải lại để xem bản mới, không ghi đè. Khi kết nối lỗi, hệ thống không tự thử vô hạn; người dùng tải lại chủ động.

## 5. Chuyển việc chưa đạt sang To-do và phối hợp văn phòng

1. Tại công việc chưa đạt, chọn chuyển **To-do**.
2. Tạo To-do mới hoặc liên kết To-do đang mở cùng chi nhánh để tránh trùng.
3. Điền nội dung, hạn, phân loại, mức độ, quản lý chịu trách nhiệm và người phối hợp.
4. Theo dõi tại tab **To-do**. Danh sách mặc định dùng chung chi nhánh; không chỉ hiện việc của một người.
5. Người phối hợp mở phần trao đổi, ghi phản hồi và tải minh chứng nếu cần.
6. Nếu đang chờ, chọn **Chờ phối hợp**, ghi lý do và ngày theo dõi lại.
7. Khi xử lý xong, bổ sung kết quả công việc gốc cho đủ đạt rồi hoàn thành To-do. Hệ thống chặn đóng To-do nếu công việc liên kết chưa đạt.

11 nhóm: Vận hành, Nhân sự, Bảo trì, Khiếu nại khách hàng, VSATTP, Sản phẩm, Hàng hóa, Vệ sinh, Không gian, Thiết bị, Khác. Bốn mức độ kết hợp quan trọng/khẩn cấp.

Đổi người chịu trách nhiệm, đổi hạn hoặc hủy phải có lý do và đúng quyền. Hạn gốc được giữ để đánh giá đúng hạn/trễ. Khắc phục sau chốt kỳ được lưu riêng; không biến kỳ cũ chưa đạt thành đạt.

Mở phần **Liên kết MKT** của To-do, tìm công việc MKT rồi liên kết. Người liên kết phải có quyền với cả hai công việc. Từ công việc MKT cũng xem và mở lại To-do Hub được phép xem. MKT hoàn thành chỉ cập nhật thông báo phối hợp, không tự hoàn thành To-do hay sửa KPI; quản lý vẫn phải xác nhận kết quả. Hiện liên kết với công việc MKT, chưa tạo hoặc đồng bộ campaign/sự kiện.

## 6. CEO hoặc người được ủy quyền xác minh

1. Vào **Xác minh**, chọn công việc cần kiểm tra.
2. Đối chiếu từng lần quan sát và minh chứng. Ghi nhận xét rõ kết quả kiểm tra.
3. Nếu cần sửa sai số nhập, bật điều chỉnh và nhập lại kết quả đúng, có lý do.
4. Lưu; kiểm tra người xác minh và thời gian trong nhật ký.

Người thực hiện không tự xác minh kết quả của mình. Hoàn thành trễ vẫn là trễ. Vi phạm hoặc lỗi nghiêm trọng đã ghi nhận không tự biến mất khi có kết quả bổ sung.

## 7. Chỉ tiêu và nguồn doanh thu

1. **KPI & thưởng** → chọn tháng → **Chỉ tiêu**.
2. Nhập số tiền và định nghĩa doanh thu. Chọn cơ sở OneBiz FnB nếu lấy từ OneBiz; với nguồn ngoài, mô tả rõ có/không thuế, giảm trừ, trả hàng và kỳ tính.
3. Nguồn OneBiz: dùng **Lấy doanh thu OneBiz FnB** khi chỉ tiêu chọn đúng cơ sở này. Hệ thống chỉ đọc hóa đơn FnB hoàn thành, sau giảm giá, gồm thuế, trừ trả hàng hoàn thành, tính theo ngày tạo chứng từ giờ Việt Nam; không sửa hóa đơn.
4. Nguồn ngoài: **Doanh thu ngoài**, điền số tiền, tên nguồn, minh chứng. Hoặc tải mẫu Excel trong màn hình KPI, điền đúng cột, nhập lên và xem trước.
5. Người có quyền duyệt kiểm tra nguồn → **Duyệt**. Mỗi chi nhánh/tháng chỉ có một nguồn chính thức; thay thế phải có lý do.

Doanh thu không đồng nghĩa tiền thu vào két. Không cộng nguồn OneBiz và nguồn ngoài cho cùng một kỳ nếu chúng trùng doanh số. KPI chỉ so sánh khi chỉ tiêu và nguồn dùng cùng định nghĩa.

Excel: dùng mẫu của web; số US, tháng `mm/yyyy`, mã chi nhánh chính xác; không nhập công thức. File sai sẽ báo dòng/cột. Có lỗi thì cả đợt không được ghi; không có tình trạng ghi một phần rồi phải nhập lại toàn bộ. Giới hạn hiện tại 100 dòng, 2 MB.

## 8. Cấu hình thưởng tùy chỉnh

1. **Thiết lập** → **Chính sách thưởng**.
2. Đặt tên, ngày áp dụng và tỷ trọng KPI vận hành/kinh doanh, tổng 100%.
3. Cấu hình mức tối thiểu từng KPI, giới hạn phần đóng góp kinh doanh, có chặn lỗi nghiêm trọng và có yêu cầu xác minh đầy đủ hay không.
4. Nhập quỹ thưởng, trần, bước làm tròn và các bậc thưởng.
5. Phân bổ quỹ giữa các quản lý, tổng 100%. Không phát cả quỹ cho từng quản lý.
6. Xem **Kiểm tra trước khi lưu**; tổng trọng số và tổng phân bổ phải cùng bằng 100%. Phần **Mô phỏng thưởng** cho nhập tỷ lệ KPI giả định, trạng thái xác minh và lỗi nghiêm trọng để kiểm tra số thưởng từng người. Đây chỉ là mô phỏng, không ghi chi trả.
7. Lưu bản nháp, xem lại và duyệt. Vào **KPI & thưởng** để xem kết quả dự kiến từng người. Muốn thay chính sách đã có, chọn **Phiên bản mới**; hệ thống sao chép cấu hình để chỉnh và duyệt lại, không sửa bản cũ.

Ví dụ minh họa, không phải chính sách mặc định: quỹ 2,000,000, hai quản lý mỗi người 50%; vận hành 60%, kinh doanh 40%. Hệ thống tính phần quỹ và KPI vận hành riêng của mỗi người, áp điều kiện/bậc/trần/làm tròn. CEO quyết định các thông số; hệ thống không cho nhập mã lập trình để chạy công thức tùy ý.

Thiếu nguồn, chỉ tiêu, chính sách hoặc xác minh thì thưởng hiện dấu “—” và lý do, không mặc định số tiền bằng 0. Đây là bảo vệ số liệu, không phải lỗi kẹt chức năng.

## 9. Chốt kỳ và xem lại

1. Sau khi tháng kết thúc, kiểm tra đủ lịch công việc và đủ xác minh.
2. Kiểm tra chỉ tiêu, nguồn doanh thu đã duyệt và chính sách có hiệu lực.
3. **KPI & thưởng** → **Chốt kỳ**, nhập xác nhận/lý do và lưu.
4. Màn hình chuyển thành **Thưởng đã chốt**; số liệu đọc từ bản chốt cố định, không tính lại theo dữ liệu hiện tại.
5. Mở **Lịch sử kỳ**, chọn nhật ký hoặc To-do, bấm **Xem thêm** để xem các trang tiếp theo.

Không sửa trực tiếp kỳ đã chốt. Nếu doanh thu hoặc chỉ tiêu đã ghi sai:

1. Tại **KPI & thưởng**, mở **Điều chỉnh số liệu kỳ đã chốt** → **Đề nghị điều chỉnh doanh thu hoặc chỉ tiêu**.
2. Điền cả hai số tiền đúng, lý do và minh chứng đối chiếu; gửi đề nghị. Gửi đề nghị chưa thay số chính thức.
3. Người có quyền chốt kỳ kiểm tra, nhập nhận xét và **Duyệt phiên bản điều chỉnh**. Quản lý không tự duyệt. Hiện CEO có thể tự đề nghị và duyệt vì CEO là người chịu trách nhiệm cuối; khi phân quyền cho cấp dưới, nguyên tắc không tự duyệt vẫn giữ.
4. Thưởng được tính từ công việc và chính sách đã chốt, chỉ thay số doanh thu/chỉ tiêu được duyệt. Màn hình hiện số phiên bản. Bản chốt gốc và lịch sử không bị sửa.
5. Nếu đã có người duyệt phiên bản mới, đề nghị dựa trên bản cũ bị chặn; tải lại và lập đề nghị đúng phiên bản mới.

Nếu kết quả hoặc ngưỡng tiêu chí đã nhập sai sau chốt, mở phần **Đề nghị điều chỉnh kết quả vận hành** trong cùng khu vực:

1. Chọn công việc trong bản chốt, nhập lại đầy đủ kết quả đúng và minh chứng.
2. Chỉ người có quyền chốt kỳ mới được đề nghị thay ngưỡng tiêu chí cấu hình sai; quản lý chỉ đề nghị sửa kết quả của mình.
3. Ghi lý do và minh chứng đối chiếu, gửi đề nghị rồi chờ người có quyền duyệt.
4. Bản được duyệt là một phiên bản điều chỉnh riêng. Bản gốc, thời điểm đạt và lỗi/vi phạm đã ghi nhận vẫn được giữ; không biến hoàn thành trễ thành đúng hạn. Thay ngưỡng không tự xóa lỗi nghiêm trọng đã ghi nhận.

Cả hai luồng dùng chung thứ tự phiên bản. Điều chỉnh doanh thu sau điều chỉnh kết quả không làm mất kết quả đã sửa, và ngược lại. Luồng này không sửa hóa đơn, kho, công nợ, bảng lương hoặc mở khóa kỳ.

## 10. Thông báo và điều kiện mở dùng thật

Biểu tượng chuông mở thông báo nội bộ; có thể đánh dấu đã đọc. Việc đến hạn/quá hạn và To-do chờ tới ngày theo dõi được nhắc theo tác vụ riêng, chống tạo trùng cùng ngày. Tác vụ chỉ hoạt động tự động sau khi kỹ thuật kích hoạt lịch gọi `/api/cron/operations` và cấu hình khóa xác thực. Hiện chưa tự gửi email/Zalo/Telegram.

Lịch chuẩn bị hiện tại chạy mỗi ngày lúc 05:00 giờ Việt Nam; chưa kích hoạt. Đây không phải thông báo tức thời tại từng deadline. Nếu cần nhắc ngay trong ngày, kỹ thuật phải cấu hình lịch phù hợp và kiểm tra giới hạn nền tảng trước; CEO không cần sửa code.

To-do tải theo từng trang 50 công việc. Bấm **Xem thêm** để tiếp tục; tìm kiếm và **Của tôi** lọc trên database theo quyền, không chỉ lọc trang đang thấy. Không giới hạn âm thầm ở 500 công việc. Xanh lá là đạt/đã duyệt; vàng là chờ/nháp; đỏ là chưa đạt/hủy; xanh dương là đang xử lý. Luôn đọc kèm chữ trạng thái.

Tám migration Hub đã được chạy trên PostgreSQL local cô lập. Đã nghiệm thu đăng nhập chung, ghi kết quả, phân quyền, upload ảnh và To-do qua trình duyệt → API web → Supabase local; không dùng database đang bán hàng để test. Docker đã hoạt động sau khi khởi động lại Windows, không cần thuê staging riêng.

Trước khi mở dùng thật, kỹ thuật còn phải đối chiếu cấu trúc/quyền database production bằng kiểm tra chỉ đọc, duyệt và áp dụng migration, cấu hình tên miền cùng lịch nhắc việc, rồi kiểm tra bản phát hành. Những bước này chưa được thực hiện và chưa deploy. Không cần CEO nhập danh sách công việc trước để hoàn thiện code. Khi hệ thống được mở dùng, CEO thực hiện lần lượt mục 2, 3, 7 và 8.
