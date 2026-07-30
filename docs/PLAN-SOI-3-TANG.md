# PLAN — Soi triệt để 3 tầng để web "ổn định một kiểu"

> CEO 30/07/2026: *"soi code, ux ui, thiết kế, luồng data có đúng logic chưa? và các nút có đang thực hiện đúng chức năng của nó hay không để web luôn ổn định 1 kiểu"*

Tầng 0 (code ↔ database) đã xong ngày 30/07: 6 nút chết vì gọi cột không tồn tại, đã sửa + có test CI chặn tái phát (`src/__tests__/schema/code-vs-db.test.ts`).

---

## Nguyên tắc xuyên suốt

**1. Mỗi tầng phải kết thúc bằng một test tự động, không phải một lần rà tay.**
Rà tay xong là hết tác dụng ngay hôm sau. Test trong CI thì lỗi không lên được prod. Đây là cách duy nhất để "ổn định một kiểu" bền.

**2. Không tin bản quét đầu tiên.**
Hôm nay bộ quét tầng 0 ra 23 nhóm lỗi ở bản 1, còn 6 ở bản 4 — 17 nhóm là **báo oan**. Bộ đếm trang mồ côi ra 15, sửa ngưỡng còn **2**. Quy trình bắt buộc: quét → **kiểm tay từng phát hiện** → mới báo.

**3. Không đụng dữ liệu.** Migration (nếu cần) CEO tự chạy. Thí nghiệm dùng nhãn riêng, dọn sạch, đối chiếu về nguyên trạng.

**4. Mỗi đợt kết thúc:** `tsc` sạch · test xanh · deploy · **mở web xem thật** · báo cáo kèm số.

---

## Đã đo — phạm vi thật của từng tầng

| Tầng | Chỉ số đo được (30/07) |
|---|---|
| **1 · Nút ↔ hành động** | **606 nút** trong 167 file · **0** nút onClick rỗng ✅ · **58** handler async không bắt lỗi · **24** chỗ còn `window.confirm` · 1 file thiếu khoá chống bấm 2 lần |
| **2 · Đường dẫn ↔ trang ↔ quyền** | 88 mục menu · 160 trang · **0 menu chết** ✅ · **2** trang thật sự mồ côi (đều là trang thử) · 14 mã quyền trong menu · **middleware và layout KHÔNG chặn theo quyền**, chỉ 11/160 trang tự kiểm |
| **3 · UX/UI đồng nhất** | 160 trang · ListPageLayout **24** · PageHeader **78** · DataTable **46** · **table thô 42** · "Tìm theo" **9** · empty state **14** · 50 popup: 48 dùng Dialog chuẩn, 46 có khoá khi lưu |

Nhận xét ngay từ số liệu: **tầng 2 lành hơn tưởng** (không có menu chết), **tầng 1 có 58 điểm im lặng**, **tầng 3 lệch nhiều nhất** (42 trang tự viết bảng thô).

---

# TẦNG 1 — Nút có làm đúng việc của nó không

Đây là tầng nhân viên chạm mỗi ngày, và là tầng gây mất tiền. Làm trước.

### Đợt 1.1 — Test "mọi nút có đường về" *(1 đợt)*
Thêm `src/__tests__/ui/button-contract.test.ts`, đỏ khi:
- `<Button>` không có `onClick`, không `type="submit"`, không `asChild` bọc link → **nút trang trí**
- handler async gọi service mà **không có try/catch và không `.catch`** → lỗi im lặng
- handler ghi dữ liệu (`create/update/delete/apply/void/cancel`) mà **không có biến khoá** hoặc `disabled` → bấm 2 lần ra 2 bản ghi
- còn `window.confirm` / `window.alert` → hộp thoại thô

Chấp nhận danh sách miễn trừ có ghi lý do (vd nút chỉ mở popup), để test không thành thứ ai cũng bỏ qua.

### Đợt 1.2 — Vá 58 điểm lỗi im lặng *(2 đợt, theo lô)*
Quy về **một kiểu duy nhất**:
```
setDangLuu(true)
try { await service(...); toast thành công; đóng popup; tải lại }
catch (e) { toast LỖI bằng tiếng Việt kèm nguyên nhân }
finally { setDangLuu(false) }
```
Thứ tự ưu tiên theo mức thiệt hại:
1. **Lô A (12 chỗ)** — trang chứng từ tiền/kho: hoá đơn, đặt hàng, trả hàng, nhập hàng, kiểm kho, xuất huỷ
2. **Lô B (~25 chỗ)** — danh mục + cài đặt
3. **Lô C (~21 chỗ)** — báo cáo, xuất file, tiện ích

### Đợt 1.3 — Thay 24 `window.confirm` *(1 đợt)*
Dùng `ConfirmDialog` / `CancelImpactDialog` đã có sẵn. Lý do không chỉ là thẩm mỹ: `window.confirm` **không hiện được bảng tác động** (kho/tiền/nợ), và bị chặn trong một số webview trên máy tablet.

### Nghiệm thu tầng 1
Bấm thật trên prod **12 nút nguy hiểm nhất** (huỷ hoá đơn, huỷ phiếu nhập, hoàn kho, thu nợ, chia bill, đóng đơn thiếu…). Mỗi nút phải: hiện trạng thái đang chạy · thất bại thì hiện lỗi tiếng Việt rõ nguyên nhân · **bấm liên tiếp 2 lần chỉ ra 1 bản ghi**. Chụp màn hình từng ca.

---

# TẦNG 2 — Đường dẫn, trang và quyền

### Đợt 2.1 — Test "không menu chết, không trang mồ côi" *(1 đợt)*
- mọi `href` trong menu phải có file trang thật (kể cả route động)
- mọi trang phải được **ít nhất một nơi** trỏ tới (menu chính, menu MKT, hub cài đặt, hoặc link chi tiết)
- ⚠️ Ngưỡng đúng là **0 tham chiếu** mới là mồ côi — file `page.tsx` không chứa đường dẫn của chính nó. Ngưỡng sai làm báo oan 13 trang.

### Đợt 2.2 — Dọn 2 trang thử *(nhỏ, gộp vào 2.1)*
`/hang-hoa/cong-thuc/cai-tien-tuong-lai` và `/hang-hoa/ton-kho/mockup-quy-doi` — xoá hoặc chuyển vào `/mockup`.

### Đợt 2.3 — Quyền: chặn ở cửa, không chỉ ẩn biển *(2 đợt)*
Hiện trạng đo được: **middleware không kiểm quyền theo route, layout cũng không**, chỉ 11/160 trang tự kiểm. Nghĩa là ẩn menu nhưng **gõ tay URL vẫn vào được trang**.

Việc phải làm **theo đúng thứ tự, không đảo**:
1. **Đo trước, đừng kết luận sớm:** đăng nhập bằng tài khoản nhân viên thật (quyền hẹp), gõ tay 10 URL không được phép → ghi lại: trang có mở? dữ liệu có hiện? bấm nút có ăn? Rất có thể RLS ở database đã đỡ phần đọc/ghi — **phải kiểm mới biết**, không được suy đoán.
2. Nếu RLS đỡ đủ → chỉ cần trang hiện thông báo "Không có quyền" thay vì màn trắng/lỗi thô.
3. Nếu RLS **không** đỡ → thêm chốt kiểm quyền ở một chỗ dùng chung (layout hoặc middleware), lấy mã quyền từ chính `nav-config` để không phải khai hai lần.
4. Test: mọi mã quyền dùng trong menu phải tồn tại trong bảng `permissions`.

### Nghiệm thu tầng 2
Bảng đối chiếu 10 URL × (mở được / thấy dữ liệu / bấm được), trước và sau. Kèm ảnh chụp menu của tài khoản nhân viên.

---

# TẦNG 3 — UX/UI có đồng nhất không

Tầng này lệch nhiều nhất nhưng **không chảy máu tiền** → làm sau cùng.

### Đợt 3.1 — Chốt khuôn chuẩn *(1 đợt, chủ yếu là quyết định)*
Ba loại màn, mỗi loại một khuôn cố định:

| Loại màn | Khuôn bắt buộc |
|---|---|
| **Danh sách chứng từ** | ListPageLayout + PageHeader + DataTable + "Tìm theo" + empty state có gợi ý chi nhánh + dòng mới trên cùng |
| **Danh mục** | ListPageLayout + PageHeader + DataTable + "Tìm theo" |
| **Báo cáo** | PageHeader + bộ lọc kỳ/chi nhánh + thẻ số + bảng/biểu đồ + Xuất file |

Viết thành checklist **và** test đếm — trang mới không đủ khuôn thì đỏ.

### Đợt 3.2 — Kéo 42 trang dùng bảng thô về DataTable *(3–4 đợt, mỗi đợt 10–12 trang)*
Đi theo mức nhân viên dùng, không theo thứ tự chữ cái. Mỗi đợt: chụp trước/sau, kiểm phân trang + ẩn cột + cuộn ngang trên tablet.

### Đợt 3.3 — Phủ "Tìm theo" cho 9 trang chứng từ còn thiếu *(1 đợt)*
Hiện chỉ **3/12** trang chứng từ có ô "Tìm theo" (hoá đơn, đặt hàng, nhập hàng). Còn: trả hàng, bán nội bộ, chuyển kho, đặt hàng nhập, hoá đơn đầu vào, kiểm kho, trả hàng nhập, xuất huỷ.

### Đợt 3.4 — Empty state + gợi ý chi nhánh đồng nhất *(1 đợt)*
Chỉ 14/160 trang có empty state riêng. Trang trống mà không nói vì sao trống là nguồn gọi điện hỏi nhiều nhất.

### Nghiệm thu tầng 3
Chụp 12 trang cùng loại xếp cạnh nhau — tiêu đề, bộ lọc, bảng, phân trang phải **cùng vị trí, cùng cỡ**. Đo trên 3 khổ máy: điện thoại / tablet / desktop.

---

## Thứ tự và lý do

```
Tầng 1  ██████████  (4 đợt)  → nút ăn tiền, làm trước
Tầng 2  █████       (3 đợt)  → nhân viên tìm được việc + chặn đúng quyền
Tầng 3  ████████    (6 đợt)  → bề mặt, đẹp nhưng không chảy máu
```

Tổng **13 đợt**. Mỗi đợt là một lần deploy + nghiệm thu độc lập — dừng ở đâu cũng có giá trị, không có đợt nào phải chờ đợt sau mới dùng được.

## Cái plan này KHÔNG làm

- Không đổi thiết kế, màu sắc, cỡ chữ — đã chốt 90% + trang Giao diện hôm 29/07
- Không refactor POS Retail/F&B đang chạy tiền thật
- Không đụng một dòng dữ liệu nào
- Không mở kênh online (`/ban-online/*` giữ nguyên, chờ CEO quyết mở hay bỏ)

## Việc cần CEO quyết

| Việc | Vì sao cần anh |
|---|---|
| 4 trang `/ban-online/*` (website, facebook, zalo, đơn hàng) | Có mở kênh online không? Nếu không thì bỏ khỏi menu cho gọn |
| 2 trang thử: `cai-tien-tuong-lai`, `mockup-quy-doi` | Xoá hẳn hay giữ làm nháp? |
| Tài khoản nhân viên thật để thử quyền | Cần một tài khoản quyền hẹp để đo tầng 2 — hoặc anh cho phép em tạo tài khoản thử rồi xoá |
