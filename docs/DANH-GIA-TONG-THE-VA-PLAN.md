# ĐÁNH GIÁ + PLAN BUILD WEB — 30/07/2026

> CEO chỉnh 30/07: *"đừng đụng data em, mình đang build web còn data thì a
> đang chuyển đổi từ từ nên chắc chắn không đủ"*

## Bản trước SAI ở đâu — ghi lại để không lặp

Bản đầu của tài liệu này lấy **mức độ đầy đủ của dữ liệu** làm căn cứ xếp
việc: thấy F&B chưa có giá/công thức/bàn thì kết luận "đang bị chặn", rồi đề
xuất một giai đoạn xoay quanh việc CEO nhập liệu.

Sai ở chỗ: **dữ liệu đang được chuyển đổi dần, thiếu là đúng tiến độ.** Nó
không phải vấn đề cần giải, và không phải căn cứ để xếp ưu tiên build.

## Hai nguyên tắc bắt buộc từ đây

**1. KHÔNG đụng dữ liệu kinh doanh.**
Không viết migration sửa/thêm/xoá dữ liệu nữa. Chỉ được đụng: cấu trúc bảng,
hàm, quyền, bảo mật, và code giao diện. Đo đạc chỉ ĐỌC, và chỉ để tìm lỗi
phần mềm — không biến "data thiếu" thành đầu việc cho CEO.

**2. Đo chất lượng phần mềm bằng "đúng và đủ", không bằng "có đang được dùng".**
Một trang chưa ai dùng vẫn phải đúng. Một tính năng chưa có dữ liệu vẫn phải
chạy được ngay khi dữ liệu về.

---

## Điều quan trọng nhất rút ra từ ràng buộc của CEO

Dữ liệu sẽ **thiếu và về dần trong một thời gian dài**. Đó không phải trở
ngại — đó là **điều kiện thiết kế**. Web phải làm tốt ba việc dưới đây, và cả
ba đều là việc build thuần tuý:

### 1. Trang trống phải tự giải thích
Hiện chỉ **14/160 trang** có empty state riêng. Khi dữ liệu về dần, phần lớn
trang sẽ trống một thời gian. Trang trống mà im lặng thì nhân viên tưởng lỗi,
tưởng mất dữ liệu, hoặc gọi điện hỏi. Trang trống **nói được** "chưa có dữ
liệu · thêm ở đây · hoặc đang lọc chi nhánh nên không thấy" thì tự phục vụ.

### 2. Công cụ nhập liệu phải nhanh và an toàn
Chuyển đổi dữ liệu là việc lặp đi lặp lại hàng trăm dòng. Việc của web là
làm cho nó nhanh: nhập hàng loạt trên lưới, nhập Excel có kiểm lỗi **trước
khi** lưu, báo rõ dòng nào sai sai chỗ nào.

### 3. Số phải đúng ngay khi dữ liệu về
Phần này hôm nay đã làm gần xong: giá vốn nối vào thẻ SP, dòng bán ghi giá
vốn thật, code gọi đúng cột database, tồn kho khớp tuyệt đối.

---

## PLAN — 4 giai đoạn, thuần build web

### GĐ1 — Đóng nốt phần an toàn *(đang dở, rẻ)*

| # | Việc | Ghi chú |
|---|---|---|
| 1.1 | Bảo mật đợt 2 — 30 bảng chưa cách ly | cần CEO chạy 1 câu SELECT chỉ-đọc để em biết bảng nào thiếu quy tắc gì |
| 1.2 | 2 trang mật khẩu còn treo vòng xoay | khác mẫu các trang danh sách, làm riêng |

**Nghiệm thu:** không bảng nào đọc được khi chưa đăng nhập · nhân viên dùng
bình thường · 15/15 trang không treo vòng xoay.

---

### GĐ2 — Trang trống tự giải thích *(hợp nhất với tình trạng data đang chuyển)*

| # | Việc |
|---|---|
| 2.1 | Chốt 3 kiểu trang trống: *chưa có dữ liệu* · *đang lọc nên không thấy* · *không có quyền* |
| 2.2 | Phủ cho 12 trang chứng từ trước (nhân viên dùng hằng ngày) |
| 2.3 | Phủ nốt các trang danh mục + báo cáo |
| 2.4 | Test tự động: trang danh sách nào không có empty state thì đỏ |

**Nghiệm thu:** mở bất kỳ trang nào chưa có dữ liệu → đọc là hiểu ngay vì sao
trống và làm gì tiếp, không cần hỏi ai.

---

### GĐ3 — Công cụ nhập liệu nhanh *(phục vụ việc chuyển đổi của CEO)*

| # | Việc |
|---|---|
| 3.1 | Nhập hàng loạt trên lưới: gõ liên tục bằng Tab, không mở popup từng dòng |
| 3.2 | Nhập Excel — kiểm lỗi **trước khi** lưu, chỉ rõ dòng nào cột nào sai |
| 3.3 | Nhân bản nhanh (tạo mã mới từ mã có sẵn) |

Em **xây công cụ**, không nhập hộ dữ liệu.

---

### GĐ4 — Đồng nhất giao diện

42 trang tự viết bảng thô → bảng dùng chung · 9 trang chứng từ thiếu ô
"Tìm theo" · thống nhất khuôn 3 loại màn (chứng từ · danh mục · báo cáo).

Để cuối vì tốn nhất và không chặn gì.

---

## Sức khoẻ kỹ thuật hiện tại (đối chiếu)

| Chỉ số | Trạng thái |
|---|---|
| Code gọi đúng cột/hàm database | ✅ 0 lỗi · có test CI chặn tái phát |
| Trang treo vòng xoay | ✅ 15 → 2 |
| Tồn kho khớp | ✅ tuyệt đối · 0 mã âm |
| Dữ liệu lộ khi chưa đăng nhập | ✅ chặn sạch |
| Cách ly giữa doanh nghiệp | 🟡 29/59 bảng |
| Trang có empty state | 🔴 14/160 |
| Trang dùng bảng chung | 🟡 46/160 (42 trang tự viết bảng thô) |
| Test | ✅ 3.163 xanh / 112 file |
