# ĐÁNH GIÁ TỔNG THỂ ONEBIZ + PLAN — 30/07/2026

> CEO: *"đánh giá thật kĩ, có cái nhìn tổng thể cho website, lên plan chi tiết đúng đắn, phù hợp"*

Tài liệu này thay thế cách phân việc theo "3 tầng kỹ thuật" ở
`PLAN-SOI-3-TANG.md`. Cách phân đó đúng về code nhưng **sai về ưu tiên** —
nó bỏ qua khoảng cách lớn nhất của hệ thống. Số liệu dưới đây đo trực tiếp
trên dữ liệu thật ngày 30/07.

---

## PHẦN 1 — HỆ THỐNG ĐANG Ở ĐÂU (số thật, không ước lượng)

### Cái gì đang chạy thật

| | Số đo |
|---|---|
| Doanh thu | T5 3,1tr → T6 229,5tr → **T7 273,8tr** (224 hoá đơn) |
| Nguồn đơn | POS 203 · Đơn đặt hàng 21 |
| Thu tiền | 417,8tr bán hàng + 75,4tr thu nợ |
| Chi tiền | 382,7tr trả nhà cung cấp |
| Công nợ | Khách nợ 32,9tr · Mình nợ NCC 3,9tr |
| Kho | 684 mã · giá trị 128,8tr · **tồn khớp tuyệt đối**, 0 mã âm |
| Người dùng | 7 tài khoản (6 nhân viên + 1 chủ) |

### Cái gì đã xây xong mà chưa chạy

| Tính năng | Đã dùng | Ghi chú |
|---|---|---|
| **Toàn bộ F&B** | **0** | xem Phần 2 |
| Khuyến mãi | 0 | |
| Mã giảm giá | 0 | |
| Chuyển kho | 0 | |
| Xuất dùng nội bộ | 0 | |
| Bán nội bộ | 0 | |
| Đơn online | 0 | 4 trang `/ban-online/*` — CEO chốt để sau |
| Đa chi nhánh | **1/5** | chỉ Kho Tổng phát sinh hoá đơn |

> **Nhận định:** hệ thống có ~160 trang, 231 hàm, 240 lệnh nâng cấp — nhưng
> **một chi nhánh đang dùng khoảng 20% trong đó**. Tốc độ xây đã vượt xa tốc
> độ đưa vào dùng.

---

## PHẦN 2 — BA KHOẢNG CÁCH LỚN NHẤT

### Khoảng cách 1 — Không có lãi thật để ra quyết định 🔴

Sổ quỹ chỉ có **6 loại giao dịch**, tất cả đều là mua–bán–công nợ:

```
THU  Bán hàng               116 phiếu · 417.810.230đ
THU  Thu nợ khách            46 phiếu ·  75.472.892đ
CHI  Trả nhà cung cấp       110 phiếu · 303.349.531đ
CHI  supplier_payment        18 phiếu ·  79.374.938đ
CHI  Hoàn tiền huỷ đơn        5 phiếu ·  12.468.050đ
CHI  Trả hàng                 2 phiếu ·      66.100đ
```

**Không có một đồng nào** cho điện, nước, lương, mặt bằng, marketing, khấu hao.

Hệ quả: con số "lợi nhuận" trên web thực chất là **lãi gộp 22,2%
(~112 triệu)**. Trừ chi phí vận hành thật ra bao nhiêu — **hệ thống không
biết, và anh cũng không biết qua hệ thống**.

Đây là khoảng cách giữa *"số liệu đúng"* (đã đạt hôm nay) và *"dùng được để
quyết định"* (chưa đạt). Toàn bộ công sức sửa giá vốn hôm nay **chưa sinh
giá trị quyết định** chừng nào còn thiếu vế này.

### Khoảng cách 2 — F&B: xây 100%, chạy 0% 🔴

Bốn quán đã khai trong hệ thống (CNH-XDX, BOF-001, CNH-XPR, CNH-XTB).
Bốn điều kiện để bán được món:

| Điều kiện | Trạng thái |
|---|---|
| Món có giá bán | **0 / 124** |
| Món có công thức | **0 / 124** |
| Có bàn | **0** |
| Có tồn nguyên liệu tại quán | **0 mã ở cả 4 quán** |

Trong khi đó đã xây xong và đang nằm im: POS F&B, màn hình bếp (KDS), sơ đồ
bàn kéo–thả, tuỳ chọn món (size/đường/đá/topping), công thức theo size, chia
bill, gộp bàn, in bill nhiệt, giao hàng theo km, báo cáo shipper, báo cáo
tuỳ chọn món…

> ⚠️ **Điểm cần anh trả lời:** ngày 25/07 em đo đúng bốn con số này — **y hệt
> hôm nay**. Năm ngày không nhúc nhích. Nếu F&B là ưu tiên thì đang có gì
> chặn: chưa có thời gian nhập, hay cách nhập quá cực, hay chưa chốt menu/giá?
> Trả lời được câu này quyết định giai đoạn 2 làm kiểu gì.

### Khoảng cách 3 — Cách ly dữ liệu chưa xong (vách đá, không phải dốc) 🟡

Lỗ công khai đã bịt (`00239`), 29 bảng cốt lõi đã bật cách ly (`00240`). Còn
**30 bảng** chưa bật, trong đó **5 bảng chưa có quy tắc nào**.

Hôm nay rủi ro thấp — 10 doanh nghiệp trong danh sách hầu hết là tenant thử
của chính hệ thống. Nhưng nó **không xấu dần, nó xấu đột ngột**: đúng ngày
có khách hàng thật thứ hai, "chưa xong" biến thành sự cố. Và đó cũng là lúc
bận nhất, ít thời gian nhất để làm cẩn thận.

---

## PHẦN 3 — NGUYÊN TẮC CHỌN VIỆC (áp cho mọi giai đoạn)

**1. Không xây thêm tính năng mới cho tới khi cái đã xây được dùng.**
Hệ thống đang thừa tính năng, thiếu dữ liệu và thiếu thói quen dùng. Xây
thêm chỉ làm khoảng cách rộng ra.

**2. Việc nào mở ra doanh thu mới xếp trên việc làm êm cái đang chạy.**
F&B = 4 điểm bán chưa hoạt động. Không có việc kỹ thuật nào sánh được.

**3. Việc rẻ mà chặn rủi ro lớn thì làm ngay, không xếp hàng.**
Bảo mật đợt 2 chỉ tốn 1–2 đợt — không đáng để chờ.

**4. Mỗi đợt kết thúc bằng 5 lớp kiểm** (kiểu · test · deploy · web thật ·
đối chứng số cũ) và một test tự động nếu có thể.

---

## PHẦN 4 — PLAN 4 GIAI ĐOẠN

### GIAI ĐOẠN 1 — "Sổ sách nói được sự thật" *(ưu tiên cao nhất, rẻ)*

Mục tiêu: mở trang Lợi nhuận ra là thấy **lãi thật**, không phải lãi gộp.

| # | Việc | Ai làm | Ước lượng |
|---|---|---|---|
| 1.1 | Chốt danh mục chi phí vận hành (điện · nước · lương · mặt bằng · internet · marketing · khác) | **CEO quyết danh mục** · em dựng sẵn | 1 đợt |
| 1.2 | Màn nhập chi phí nhanh — chọn loại, nhập tiền, chọn kỳ, xong. Không bắt qua sổ quỹ nhiều bước | Em | 1 đợt |
| 1.3 | Nhập chi phí 3 tháng đã qua (T5–T7) để có số so sánh | **CEO/kế toán** | — |
| 1.4 | Báo cáo P&L tách rõ: doanh thu → giá vốn → **lãi gộp** → chi phí vận hành → **lãi thật** | Em | 1 đợt |
| 1.5 | Bảo mật đợt 2 — 30 bảng còn lại | Em (cần CEO chạy 1 câu truy vấn) | 1–2 đợt |
| 1.6 | ~10 mã ngoài F&B còn giá vốn 0đ | **CEO nhập giá mua** | — |

**Nghiệm thu GĐ1:** mở `/phan-tich` chọn tháng 7 → thấy đủ 5 dòng
doanh thu / giá vốn / lãi gộp / chi phí vận hành / **lãi thật**, và con số
lãi thật khớp với cảm nhận của anh về tháng đó.

---

### GIAI ĐOẠN 2 — "Bật F&B" *(giá trị lớn nhất)*

Đây **không phải việc code** — code đã xong. Đây là việc **đưa dữ liệu vào**
và em phải làm cho việc đó dễ nhất có thể.

**Bước 2.0 — Gỡ nút thắt (làm trước, quan trọng nhất).**
Em cần anh trả lời câu ở Khoảng cách 2. Tuỳ câu trả lời:

- *"Chưa chốt menu/giá"* → việc của anh, em dựng file Excel mẫu đã điền sẵn
  124 tên món, anh chỉ điền cột giá
- *"Nhập cực quá"* → em làm màn nhập hàng loạt: bảng 124 dòng, gõ giá liên
  tục bằng phím Tab, không mở popup từng món
- *"Không có thời gian"* → em cắt nhỏ: chọn **1 quán + 20 món bán chạy**
  chạy thử trước, không làm cả 124 món × 4 quán

**Bước 2.1 — Giá bán cho món.** 124 món.
**Bước 2.2 — Công thức cho món.** Nặng nhất. Đề xuất: bắt đầu từ 20 món bán
chạy, phần còn lại làm dần — POS đã có chốt chặn món chưa có công thức.
**Bước 2.3 — Sơ đồ bàn** cho quán chạy thử.
**Bước 2.4 — Chuyển nguyên liệu từ Kho Tổng về quán.** Đây cũng là lần đầu
tính năng Chuyển kho được dùng thật → em kèm kiểm tra kỹ.
**Bước 2.5 — Bán thử 1 ngày**, đối chiếu: tiền thu · nguyên liệu trừ · bếp
nhận đơn · in bill · cuối ngày chốt ca.

**Nghiệm thu GĐ2:** một quán bán được trọn một ngày, cuối ngày số tiền và số
nguyên liệu trừ khớp thực tế.

---

### GIAI ĐOẠN 3 — "Vận hành nhiều chi nhánh"

Chỉ bắt đầu khi GĐ2 xong ít nhất 1 quán. Nội dung: nhân rộng cho 3 quán còn
lại · phân quyền theo chi nhánh cho nhân viên quán · báo cáo so sánh chi
nhánh · quy trình chuyển hàng định kỳ Kho Tổng → quán.

---

### GIAI ĐOẠN 4 — "Đồng nhất giao diện" *(để sau cùng, có lý do)*

Đây là phần "tầng 3" của plan cũ: 42 trang tự viết bảng thô, 9 trang chứng
từ thiếu ô "Tìm theo", empty state không đồng nhất.

**Vì sao để sau:** nó là việc *thoải mái*, không phải việc *an toàn* hay
*doanh thu*. Nó tốn gấp 4–5 lần GĐ1 và GĐ3 cộng lại. Và quan trọng hơn: khi
F&B chạy rồi, mình sẽ biết **trang nào nhân viên thật sự dùng nhiều** để làm
đúng chỗ đó trước, thay vì làm đều 42 trang theo thứ tự chữ cái.

---

## PHẦN 5 — CHIA VIỆC RÕ RÀNG

### Việc chỉ anh làm được (em không thay thế được)
1. **Chốt danh mục chi phí vận hành** + nhập số 3 tháng đã qua
2. **Trả lời: cái gì đang chặn F&B** — quyết định cách làm GĐ2
3. **Chốt menu + giá 124 món** (hoặc 20 món nếu chạy thử)
4. Nhập giá mua cho ~10 mã còn 0đ
5. Chạy các lệnh SQL em soạn

### Việc em làm
1. Màn nhập chi phí nhanh + báo cáo lãi thật
2. Bảo mật đợt 2
3. Công cụ nhập liệu hàng loạt cho F&B (tuỳ câu trả lời của anh)
4. Kiểm tra kỹ luồng chuyển kho trước khi dùng thật
5. Đồng nhất giao diện — giai đoạn cuối

### Việc em đề nghị KHÔNG làm lúc này
- Không mở kênh online (`/ban-online/*`) — CEO đã chốt
- Không xây thêm tính năng F&B mới — đã đủ và đang thừa
- Không đụng khuyến mãi / mã giảm giá — chưa có nhu cầu thật
- Không refactor POS — đang chạy tiền thật, không sờ vào khi chưa có lý do

---

## PHỤ LỤC — Sức khoẻ kỹ thuật (đã đạt, chỉ để đối chiếu)

| Chỉ số | Trạng thái |
|---|---|
| Code gọi đúng cột/hàm database | ✅ 0 lỗi · có test CI chặn tái phát |
| Trang treo vòng xoay | ✅ 15 → 2 (2 trang mật khẩu, khác mẫu) |
| Tồn kho khớp | ✅ tuyệt đối · 0 mã âm · 1/133 mã lệch sổ lô |
| Dòng bán thiếu giá vốn | ✅ 11 (từ 2.031) |
| Dữ liệu lộ khi chưa đăng nhập | ✅ chặn sạch |
| Test | ✅ 3.163 xanh / 112 file |

**Kết luận kỹ thuật: hệ thống lành.** Nút thắt hiện nay **không nằm ở code**
— nằm ở dữ liệu và ở việc đưa vào dùng.
