# PLAN F2 — ĐẶT BÀN (RESERVATION) · BACKLOG, CHƯA LÀM

> **Trạng thái 16/08/2026: TẠM DỪNG theo chỉ đạo CEO.** Đặt bàn là chức năng
> mới, không phải lỗi cần vá gấp. **Chưa tạo** bảng, mã quyền, RPC, giao diện
> hay migration nào cho đặt bàn. Ưu tiên hiện tại là hoàn tất mảng F&B đang dở.
>
> Plan chỉ được đưa ra duyệt sau khi trả lời xong **mục 10 — 8 điểm còn thiếu**.

Lập 16/08/2026. **Chưa viết một dòng mã nào.** Mọi số liệu dưới đây đo trên
schema và dữ liệu prod thật, không suy đoán.

---

## 1. Khảo sát — cái gì đã có, cái gì chưa

| Hạng mục | Hiện trạng đo được |
|---|---|
| Bảng đặt bàn | **Chưa có** — không có bảng nào tên `reservation` / `booking` / `dat_ban` |
| Bàn | `restaurant_tables`: có `status`, `current_order_id`, `zone`/`zone_id`, `capacity` |
| Đơn bếp | `kitchen_orders`: có `table_id`, `status`, `order_type`, `merged_into_id`, `parent_order_id` |
| Khách hàng | `customers`: có `name`, `phone`, `branch_id`, `customer_type` — đủ để liên kết |
| Ca làm việc | `shifts`: `branch_id`, `cashier_id`, `opened_at/closed_at`, `status` |
| RPC bàn đã có | `fnb_table_config_atomic`, `fnb_transfer_table_atomic`, `mark_fnb_table_available_atomic`, `fnb_send_to_kitchen_atomic`, … (18 hàm) |
| Quyền FnB đã có | 14 mã `pos_fnb.*` + 3 mã `floor_plan.*` — **không có mã nào cho đặt bàn** |

**Vai trò đang giữ quyền bàn (đo thật):**
`pos_fnb.manage_tables` → Chủ cửa hàng, Admin, Quản lý, **Phục vụ**.
`pos_fnb.transfer_table` → thêm Thu ngân F&B.
`floor_plan.edit_branch` → Chủ cửa hàng, Admin, Quản lý (không có Phục vụ).

→ **Đề xuất 2 mã quyền mới** (cần CEO duyệt, không tự thêm):
`pos_fnb.reservation.view` và `pos_fnb.reservation.manage`.
Gán ban đầu: `view` cho cả 5 vai trò đang thấy màn bàn; `manage` cho Chủ cửa
hàng, Admin, Quản lý, Thu ngân F&B, Phục vụ (Phục vụ là người nghe điện thoại
nhận đặt bàn — nếu CEO muốn chặt hơn thì bỏ Phục vụ khỏi `manage`).

---

## 2. Điểm mấu chốt CEO đã chỉ ra: trạng thái bàn tính theo KHUNG GIỜ

Sai lầm dễ mắc: nhận đặt bàn lúc 19h thì set `restaurant_tables.status='reserved'`
ngay từ sáng → bàn đó chết cả ngày, khách vãng lai không ngồi được.

**Cách làm đúng:**
- `restaurant_tables.status` **giữ nguyên tập giá trị hiện tại**, KHÔNG thêm
  "Đã đặt". Bàn vẫn `available` cho tới lúc khách thật sự đến.
- Lịch đặt nằm ở bảng riêng, có `start_at` + `duration_minutes`. Màn hình tính
  "bàn này bận trong khung 19:00–21:00" bằng **truy vấn theo khoảng thời gian**,
  không phải bằng cột trạng thái.
- Khi khách đến: một RPC **nguyên tử** chuyển `Đã xác nhận → Đã xếp bàn`, đồng
  thời khoá hàng bàn (`FOR UPDATE`) và gắn đơn. Nếu bàn vừa bị người khác chiếm
  trong tích tắc đó → báo lỗi tiếng Việt rõ, không ghi đè.

---

## 3. Dữ liệu tối thiểu (bảng `fnb_reservations`)

| Nhóm | Trường |
|---|---|
| Định danh | `id`, `tenant_id`, `branch_id`, `code` (mã đặt bàn, dãy riêng) |
| Khách | `customer_id` (nullable) **+ ảnh chụp tại thời điểm đặt**: `guest_name`, `guest_phone` |
| Lịch | `start_at` (có múi giờ), `duration_minutes` (mặc định theo cài đặt chi nhánh), `party_size` |
| Bàn | `table_id` (nullable — có thể đặt theo khu), `zone_id` (nullable) |
| Vận hành | `status`, `note`, `source` (điện thoại / tại quán / Zalo / khác), `created_by`, `arrived_at`, `seated_at`, `closed_at`, `kitchen_order_id` |

**Vì sao lưu cả `customer_id` lẫn tên/số điện thoại:** khách lẻ gọi đặt bàn
thường chưa có hồ sơ; và nếu sau này hồ sơ khách bị sửa tên/số thì phiếu đặt cũ
vẫn phải giữ đúng thông tin lúc nhận đặt.

**Trạng thái (7):** Chờ xác nhận · Đã xác nhận · Đã đến · Đã xếp bàn · Hoàn tất ·
Đã huỷ · Không đến.

---

## 4. Chặn trùng lịch — làm ở máy chủ

Hai lớp:
1. **Ràng buộc trong CSDL** — `EXCLUDE USING gist` trên (`table_id`, khoảng thời
   gian) với điều kiện chỉ áp cho trạng thái còn hiệu lực (Chờ xác nhận / Đã xác
   nhận / Đã đến / Đã xếp bàn). Hai người bấm cùng lúc thì CSDL chặn, không phụ
   thuộc thứ tự chạy.
2. **RPC kiểm trước + báo lỗi tiếng Việt** để người dùng hiểu: "Bàn 5 đã có
   khách đặt lúc 19:00–21:00."

Đệm giữa hai lượt (dọn bàn) lấy từ cài đặt chi nhánh, mặc định 15 phút.

---

## 5. RPC (mọi thao tác ghi đều qua đây)

| Hàm | Việc |
|---|---|
| `fnb_reservation_create_atomic` | tạo phiếu, sinh mã, chặn trùng lịch |
| `fnb_reservation_update_atomic` | sửa giờ / số khách / ghi chú / **đổi bàn** (kiểm trùng lại) |
| `fnb_reservation_status_atomic` | xác nhận · khách đến · **xếp bàn** (nguyên tử, khoá bàn, gắn đơn) · hoàn tất · huỷ · không đến |

Khuôn chung giống 00323: `SECURITY DEFINER` + `search_path=''`, actor/tenant lấy
từ `auth.uid()` (client **không** gửi), kiểm chi nhánh thuộc tenant + quyền chi
nhánh, whitelist khoá JSON, `FOR UPDATE` trước khi kiểm/sửa, ghi `audit_log`
đầy đủ old/new. **Đổi bàn, huỷ, đến trễ, không đến — đều có audit.**

---

## 6. Giao diện

- **Lịch theo ngày** (mặc định) — cột giờ × hàng bàn, nhìn phát biết còn chỗ nào.
- **Danh sách** — lọc theo trạng thái, tìm khách bằng tên hoặc số điện thoại.
- **Sơ đồ bàn** — dùng lại màn có sẵn, chồng thêm lớp "bàn có hẹn trong 2 giờ tới".
- **Máy tính bảng / điện thoại**: nút thao tác nhanh (Khách đến · Xếp bàn · Không
  đến) cỡ chạm ≥44px; nhận đặt bàn chỉ cần tên + số điện thoại + giờ + số khách.

---

## 7. Chưa làm trong F2

- **Tiền cọc** — chờ thiết kế thu/hoàn tiền và hạch toán rõ ràng, không làm nửa vời.
- Nhắc khách tự động (SMS/Zalo) — đợt sau.
- Đặt bàn từ phía khách (trang công khai) — đợt sau.

---

## 8. Kiểm trước khi trình merge

Test: trùng lịch (cùng bàn, giao nhau từng phút) · đổi bàn sang bàn đã có hẹn ·
khách đến rồi xếp bàn khi bàn vừa bị chiếm · huỷ · không đến · sai tenant · sai
chi nhánh · hai người thao tác cùng lúc · **múi giờ** (nhận đặt 23:30 hôm nay,
hiển thị đúng ngày ở cả 3 quán).

Chạy: `tsc` · bộ kiểm trọng tâm · toàn bộ bộ kiểm · build · CI/Vercel xanh ·
xem Preview trên máy tính / máy tính bảng / điện thoại. **Không tạo dữ liệu thử
trên production.**

---

## 9. Thứ tự đề nghị

1. CEO duyệt plan này (đặc biệt: 2 mã quyền mới, ai được nhận đặt bàn, thời
   lượng mặc định một lượt ngồi, đệm dọn bàn).
2. Migration bảng + ràng buộc chống trùng + 3 RPC → CEO chạy.
3. Màn danh sách + nhận đặt bàn (dùng được ngay).
4. Lịch theo ngày + lớp phủ trên sơ đồ bàn.
5. Nghiệm thu tại quán, rồi mới bật cho nhân viên dùng.


---

## 10. TÁM ĐIỂM PHẢI BỔ SUNG TRƯỚC KHI TRÌNH DUYỆT (CEO nêu 16/08)

Đây là các khoảng trống thật trong bản plan trên. Chưa trả lời xong thì chưa
được viết mã.

**10.1 · Đặt bàn khi chưa chọn bàn cụ thể thì kiểm soát sức chứa thế nào?**
Cần một cách đếm chỗ theo khung giờ: tổng `capacity` các bàn của chi nhánh (hoặc
của khu) trừ đi số chỗ đã nhận trong khung đó. Phải chốt: đếm theo chi nhánh hay
theo khu; có chừa bao nhiêu phần trăm cho khách vãng lai; khi vượt ngưỡng thì
chặn hẳn hay chỉ cảnh báo và cho quản lý duyệt tay.

**10.2 · Phiếu "Đã xác nhận" có bắt buộc gán bàn không?**
Hai lối: (a) xác nhận là phải có bàn — chắc chắn nhưng cứng, mất linh hoạt khi
sắp bàn sát giờ; (b) cho xác nhận theo số chỗ, gán bàn lúc khách đến — linh hoạt
nhưng phải có 10.1 chặt. Cần CEO chọn, không tự quyết.

**10.3 · Khách đến thì mở đơn thế nào — KHÔNG viết đường tạo đơn bếp thứ hai.**
Bắt buộc dùng lại luồng mở đơn POS hiện có (`fnb_send_to_kitchen_atomic` và các
RPC vận hành sẵn có). Việc của F2 chỉ là **gắn phiếu đặt vào đơn đã mở**
(`kitchen_order_id`), tuyệt đối không sinh đơn bếp bằng logic riêng — nếu không
sẽ có hai đường tạo đơn lệch nhau về trừ kho, ca, in bếp.

**10.4 · Khách đến mà bàn vẫn còn khách cũ thì sao?**
Phải có đủ ba lối thoát, mỗi lối một thao tác rõ: cho **chờ** (giữ phiếu, ghi
nhận đến trễ), **đổi bàn** (kiểm trùng lịch lại), hoặc **huỷ** (ghi lý do). Cần
chốt: quá bao nhiêu phút không có bàn thì hệ thống tự nhắc; ai được quyết đổi bàn.

**10.5 · Thời lượng một lượt ngồi và thời gian dọn bàn lưu ở đâu?**
`branches.settings` (JSON) đã có sẵn và đang được dùng cho cấu hình chi nhánh —
đề xuất thêm hai khoá trong đó, **không** tạo bảng mới. Cần CEO cho hai con số
thực tế của quán.

**10.6 · Tách quyền xem và quyền sửa.**
`pos_fnb.reservation.view` (xem lịch) và `pos_fnb.reservation.manage` (nhận, sửa,
huỷ). **Chưa tự gán cho Phục vụ** — chờ CEO duyệt danh sách vai trò. Ghi nhận:
đề xuất trước đây của em gán sẵn cho Phục vụ là vượt quyền, đã rút.

**10.7 · Báo cáo.**
Cần: số phiếu theo ngày/tuần, tỉ lệ **huỷ**, tỉ lệ **không đến**, số khách thật
so với số đặt, và **lịch sử thay đổi từng phiếu** (đọc từ `audit_log`). Không có
báo cáo thì không đánh giá được đặt bàn có hiệu quả hay không.

**10.8 · Tiền cọc — KHÔNG làm.**
Giữ nguyên: chỉ làm khi có thiết kế rõ ràng cho thu tiền, hoàn tiền, ghi sổ quỹ
và hạch toán. Làm nửa vời sẽ lệch sổ quỹ như các ca thu thừa từng gặp.
