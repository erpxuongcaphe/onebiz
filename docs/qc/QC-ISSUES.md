# Danh sách phát hiện QC OneBiz

## Quy ước

- P0: có thể mở quyền sai hoặc làm sai dữ liệu diện rộng; chặn triển khai.
- P1: ảnh hưởng quyền, tenant, chi nhánh hoặc luồng nghiệp vụ chính.
- P2: ảnh hưởng độ ổn định, tốc độ, khả năng hiểu và thao tác.
- P3: nhất quán giao diện hoặc chất lượng nhỏ.

Trạng thái `Đã sửa` chỉ có nghĩa code và test cục bộ đã đạt. Chưa tính là production
cho tới khi build, commit, deploy và kiểm tra lại trên Chrome.

## Đã xác nhận

| Mức | Khu vực | Phát hiện | Trạng thái |
| --- | --- | --- | --- |
| P0 | RLS | `00241_rls_layer2_batch2.sql` đang tạo policy quá rộng, bỏ sót bảng và không đủ an toàn để chạy | Chặn chạy SQL |
| P0 | Thu/trả công nợ | RPC cũ tin `userId`/`branchId` từ client và giao diện rơi về 4 lệnh ghi rời khi RPC lỗi | Đã fail-closed; `00242` chờ chạy |
| P0 | Bán nội bộ | RPC cũ cho giả mạo tenant/người tạo và client fallback về hơn 10 bước ghi rời | Đã fail-closed; `00243` chờ chạy |
| P0 | Trả hàng | Phiếu, dòng hàng, tồn kho/BOM, hoàn tiền và công nợ ghi nhiều bước; có thể trả vượt và hồi sai công thức theo size | Đã chuyển sang RPC nguyên tử; `00244` chờ chạy |
| P0 | Nhập/hoàn nhập hàng | Ba RPC `SECURITY DEFINER` tin user ID từ client; hàm cho phép tồn âm chưa kiểm tra tenant/quyền, phiếu chi lại ghi sau nhập kho theo kiểu best-effort | Đã bọc quyền + gộp phiếu chi; `00245` chờ chạy |
| P0 | Chứng từ xuất kho | Các RPC xuất/huỷ tin tenant và người thao tác từ client; luồng tạo phiếu ghi header, chi tiết và tồn kho bằng nhiều lệnh rời | Đã bọc quyền + chuyển hoàn thành về RPC nguyên tử; `00246` chờ chạy |
| P0 | Trả hàng nhà cung cấp | Phiếu trả, dòng hàng, trừ kho, giảm nợ và phiếu thu ghi nhiều lệnh; có thể trả vượt khi hai người thao tác đồng thời và tin giá/nhà cung cấp từ client | Đã chuyển sang RPC nguyên tử, khóa phiếu/dòng và chặn tồn âm; `00247` chờ chạy |
| P0 | Nhà cung cấp/đóng phiếu nhập thiếu | RPC xóa nhà cung cấp và đóng thiếu còn tin người thao tác từ client, thiếu kiểm tra quyền/chi nhánh và trạng thái cạnh tranh | Đã bọc quyền, tenant, chi nhánh và audit; `00248` chờ chạy |
| P0 | Kiểm kho/chuyển kho | RPC hoàn tất còn nhận tenant/người thao tác từ client; chuyển kho chưa khóa tồn nguồn nên hai phiên có thể làm âm tồn | Đã bọc quyền, khóa tồn nguồn, kiểm tra hai chi nhánh và audit; `00249` chờ chạy |
| P0 | POS FnB/hủy hóa đơn đã thanh toán | Thanh toán FnB và đảo hóa đơn còn cho client truyền actor; hoàn tiền và audit không cùng một giao dịch | Đã derive actor, kiểm tra ca/quyền/chi nhánh và gộp hoàn tiền + audit; `00250` chờ chạy |
| P1 | Tuổi nợ/số dư đầu kỳ | Công thức hiện dồn toàn bộ nợ của một KH/NCC vào tuổi của chứng từ cũ nhất; nhập đầu kỳ ghi thẳng vào cột tổng hợp nên trigger có thể ghi đè | UI đã tách phải thu/phải trả; chưa đổi dữ liệu. Cần mô hình số dư đầu kỳ và tuổi nợ theo từng chứng từ trước khi coi là báo cáo kế toán chuẩn |
| P2 | Cache trình duyệt | Service worker chạy cả localhost và cache-first bundle dev, làm trình duyệt có thể giữ mã cũ và QC sai trạng thái | Đã tự hủy service worker/dọn cache ở local, nâng cache manager lên v4 |
| P1 | Quản trị người dùng | Nút đổi vai trò và kích hoạt tài khoản ghi trực tiếp vào `profiles`, xung đột với RLS chỉ cho tự sửa hồ sơ | Đã chuyển về API máy chủ |
| P1 | Phân quyền API | API quản trị chỉ đọc quyền theo vai trò, bỏ qua quyền cấp riêng/thu hồi riêng | Đã dùng quyền hiệu lực |
| P1 | Cách ly tenant | API nhận `roleId` và `branchIds` nhưng chưa xác nhận các ID thuộc doanh nghiệp hiện tại trước khi dùng service role | Đã bổ sung kiểm tra |
| P1 | Trang tổng quan | Ngày và lời chào dùng thời gian trực tiếp khi render, gây React hydration error #418 trên production | Đã sửa render ổn định |
| P2 | Thanh chọn chi nhánh | Lúc AuthContext chưa tải xong, thanh trên cùng tạm hiện “Tất cả chi nhánh” dù sau đó về một chi nhánh cụ thể | Đã đổi thành trạng thái đang tải |
| P2 | Biểu đồ tổng quan | Chrome production ghi cảnh báo Recharts nhận kích thước `-1` ở lần render đầu | Đã sửa code, chờ deploy |
| P2 | MKT Hub | Trạng thái và nút trộn tiếng Anh, số lượng 0 hiển thị `00`, sao chép link thất bại không báo | Đã sửa code |
| P2 | Bộ test | Toàn bộ Vitest dùng `jsdom`; chạy full suite vượt 5 phút dù các nhóm trọng yếu đều đạt | Cần tách môi trường test |
| P1 | Phiếu nhập/chuyển kho nháp | Phần đầu phiếu và chi tiết từng ghi bằng nhiều lệnh, lỗi giữa chừng có thể để lại phiếu thiếu dòng | Đã chuyển kiểm kho/chuyển kho sang `00256`; phiếu nhập và nhập kho ngay sang `00261`, cùng giao dịch và fail-closed |
| P2 | Báo cáo Khách × Sản phẩm | Lần tải thực tế khoảng 15-21 giây dù bố cục không tràn trang | Cần `EXPLAIN (ANALYZE, BUFFERS)` chỉ đọc |
| P0 | Đơn bán hàng cũ | Hoàn tất/hủy đơn từng ghi hóa đơn, tồn kho và sổ quỹ qua nhiều bước ở trình duyệt | Đã khóa vào RPC nguyên tử; `00270` chờ chạy |
| P3 | Trang `/ban-online` ẩn | Còn giao diện mock và nút không có nghiệp vụ thật | Không đưa vào menu; chờ quyết định xóa/xây |

| P1 | POS bán lẻ | Giá/chiết khấu/khuyến mãi và diễn viên còn có thể bị client giả mạo | Đã tính lại và kiểm tra trên máy chủ; `00253` chờ chạy |
| P1 | Phí giao hàng | Cập nhật phí và tổng hóa đơn từng là các lệnh rời, dễ lệch tổng/debt | Đã chuyển sang RPC nguyên tử; `00254` chờ chạy |
| P1 | FnB ưu đãi | Coupon/điểm/chiết khấu có thể lệch với hóa đơn khi lỗi giữa chừng | Đã gộp vào checkout nguyên tử; `00255` chờ chạy |
| P1 | Báo cáo tài chính | Tổng công ty, chi nhánh, biểu đồ và xuất file từng dùng nhiều công thức khác nhau; có chỗ lấy giá vốn hiện tại và bỏ sót trả hàng | Đã thống nhất nguồn P&L, giá vốn, biên lãi, vòng quay và DSO; `00258`, `00260` chờ chạy |
| P1 | Xuất-Nhập-Tồn lịch sử | Báo cáo kỳ cũ dùng tồn hiện tại làm tồn cuối, nên bao gồm biến động sau kỳ | Đã tái dựng tồn tại ngày cuối kỳ từ sổ kho; `00259` chờ chạy |
| P1 | Tổng công nợ | Lỗi tải tổng nợ từng bị che thành 0 và tổng lấy từ bảng tổng hợp khác nguồn tuổi nợ | Đã dùng cùng nguồn chứng từ Phải thu/Phải trả và báo lỗi rõ |

| P0 | Đơn bán hàng | Tạo/sửa đơn, nhân bản hóa đơn và sửa/hủy hóa đơn nháp từng ghi nhiều bước từ trình duyệt | Đã chuyển sang giao dịch nguyên tử; `00265`, `00266`, `00271` chờ chạy |
| P0 | Sổ quỹ | Tạo/hủy phiếu và nhập Excel có thể lệch chứng từ nguồn, công nợ và ngày giao dịch | Đã khóa theo chứng từ, quyền và audit; `00267` chờ chạy |
| P0 | Xuất kho nội bộ/hủy xuất | Header, dòng hàng và tồn kho từng ghi rời; hủy có thể lệch trạng thái | Đã chuyển sang giao dịch nguyên tử; `00268`, `00269` chờ chạy |
| P0 | POS cũ | Hoàn tất/hủy đơn cũ từng còn đường ghi tồn, quỹ và hóa đơn từ trình duyệt | Đã khóa vào RPC; `00270` chờ chạy |
| P1 | Phiếu nhập đã nhận | Thanh toán bổ sung và ghi chú từng chạy hai bước nên có thể báo lỗi sau khi tiền đã ghi | Đã gộp một giao dịch; `00272` chờ chạy |
| P0 | FnB chia bill | Tạo bill con và chuyển món từng chạy nhiều bước; giảm giá không phân bổ, thanh toán một phần có thể làm bàn báo trống | Đã gộp giao dịch, phân bổ giảm giá và giữ bàn nếu còn bill; `00273`, `00274` chờ chạy |
| P1 | Tuổi nợ theo chi nhánh | Trang Công nợ chính từng lấy tuổi nợ toàn công ty dù thanh trên đang chọn chi nhánh | Đã nối cùng phạm vi cho phải thu, phải trả và danh sách đối tượng nợ |
| P1 | Bàn FnB sau vệ sinh | Trình duyệt từng có thể tự chuyển bàn sang sẵn sàng, không kiểm tra quyền hoặc đơn còn mở | Đã khóa bằng quyền hiệu lực, chi nhánh, trạng thái và audit; `00275` chờ chạy |
| P1 | Trạng thái giao hàng | Cập nhật trạng thái và audit từng là hai lệnh rời, có thể đổi trạng thái nhưng mất dấu vết | Đã gộp một giao dịch, kiểm tra quyền/chi nhánh/chuyển trạng thái; `00276` chờ chạy |
| P1 | Quản lý chi nhánh | Sửa thông tin và đặt mặc định từng là hai lệnh; chi nhánh ngưng hoạt động biến mất khỏi trang quản trị | Đã gộp giao dịch, giữ danh sách vận hành chỉ hiện chi nhánh hoạt động và cho trang quản trị khôi phục chi nhánh ngưng; `00277` chờ chạy |
| P1 | Cài đặt vận hành | Thông tin doanh nghiệp, sàn/khuyến mãi FnB và thông tin in chi nhánh từng đọc rồi ghi đè từ trình duyệt | Đã cập nhật từng phần có khóa, quyền hiệu lực và audit; `00278` chờ chạy |
| P0 | Quyền chi nhánh nhân viên | Hồ sơ và danh sách chi nhánh từng xóa/thêm bằng nhiều lệnh, có thể mất quyền giữa chừng | Đã gộp hồ sơ, vai trò, chi nhánh chính và danh sách chi nhánh trong một giao dịch; mật khẩu báo riêng; `00279` chờ chạy |
| P0 | Tạo tài khoản nhân viên | Auth, hồ sơ và quyền chi nhánh từng được ghép bằng nhiều lệnh database rời | Đã gộp hồ sơ, vai trò và chi nhánh sau khi Auth tạo thành công; tự xóa Auth nếu khởi tạo lỗi; `00280` chờ chạy |
| P1 | Hồ sơ cá nhân | Người dùng từng cập nhật trực tiếp bảng hồ sơ từ trình duyệt | Đã giới hạn đúng tài khoản đăng nhập và chỉ cho sửa tên/SĐT trong một giao dịch có audit; `00281` chờ chạy |
| P0 | Phân quyền | Tạo/xóa vai trò, thay bộ quyền và gỡ vai trò khỏi nhân viên từng chạy nhiều lệnh | Đã khóa theo quyền hiệu lực và gộp toàn bộ thay đổi + audit; `00282` chờ chạy |

| P0 | Sản xuất | Tạo lệnh và nguyên liệu từng ghi nhiều bước; kéo thẻ sang hoàn thành có thể bỏ qua xuất kho; hủy có đường lui đổi trạng thái nhưng không hoàn tồn | Đã chuyển tạo, đổi trạng thái, hoàn thành và hủy sang giao dịch nguyên tử; `00283` chờ chạy |

## Rủi ro cần đối chiếu tiếp

1. Có 15 điểm ghi dữ liệu nhạy cảm còn cần phân loại lần cuối. Phần lớn là audit append, MKT Audit Runner cách ly hoặc mã cũ không còn được gọi; không xóa trước khi xác nhận đường gọi thực tế.
2. `stock_movements` vẫn có một số luồng cập nhật trạng thái. Chưa chuyển bảng này thành chỉ thêm cho đến khi đối chiếu hết luồng hoàn tác.
3. Policy trong migration và database thật có dấu hiệu lệch nhau. Phải chạy truy vấn chỉ đọc `docs/qc/sql/RLS-PREFLIGHT-READONLY.sql` trước khi sửa hoặc bật RLS.
4. Các migration `00242` đến `00283` chưa được xác nhận trên Supabase thật. Không kiểm thử mutation hoặc triển khai production trước khi chạy đúng thứ tự và kiểm tra kết quả.

## Bằng chứng test hiện tại

- Lượt Vitest toàn hệ thống gần nhất: 3.312/3.314 đạt. Một bài quét tĩnh quá giới hạn 5 giây đã được nới riêng lên 15 giây và chạy lại đạt 3/3; lỗi còn lại là snapshot DB chưa có `create_supplier_return_atomic` từ `00247`.
- Nhóm Kho/POS/Báo cáo vừa đồng bộ: 73/73.
- Kịch bản liên kết đơn bán, hóa đơn, tồn kho và sổ quỹ: 88/88.
- Kịch bản F&B quy mô lớn, gồm tách bill: 1.914/1.914.
- Luồng sản xuất và toàn vẹn tồn kho trọng yếu: 35/35.
- Cấu trúc SQL, dữ liệu ngoài thân hàm và độ phủ preflight migration: 3/3; nhóm xác nhận lại Kho: 38/38.
- TypeScript toàn dự án: đạt `npx tsc --noEmit`.
- Kiểm tra diff: đạt `git diff --check`.
- Build production: đạt `npm run build`, Next.js biên dịch thành công và sinh đủ 151 trang tĩnh. Kiểm thử Chrome chờ database đồng bộ migration.
- Không bài test hay thao tác QC nào ghi vào database production.
