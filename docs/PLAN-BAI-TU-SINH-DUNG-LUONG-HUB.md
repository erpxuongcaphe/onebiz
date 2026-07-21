# Phương án tổng thể: Bài viết tự sinh — nối trọn luồng Nội dung của Hub

**Ngày:** 21/07/2026 · **Người duyệt:** CEO · **Bối cảnh:** Dương được giao 3 việc "Bài 1/2/3"
nhưng không có chỗ nhập link bài; CEO nhận thông báo duyệt cũng không xem được bài.

## 1. Chẩn đoán gốc (đã soi DB + lịch sử migration)

Hub có sẵn **đường ray Nội dung** hoàn chỉnh:

```
Bài (mkt_content_items) → Nộp bản + link (mkt_content_versions) → màn Duyệt nội dung
     → duyệt xong VIỆC TỰ XONG / trả lại VIỆC TỰ QUAY VỀ (00174) → gate Đăng bài chờ bài approved
```

Trước đây luật "công đoạn Duyệt/Đăng phải gắn bài TRƯỚC" bị chê cứng (bài chưa tồn tại lúc lập
kế hoạch) nên đã **chủ đích gỡ ở 3 tầng** (00193/00194). Gỡ đúng — nhưng **quên đóng vòng ở đầu
kia**: lúc kế hoạch được duyệt (việc được sinh), không ai tạo Bài. Kết quả: việc loại `idea`
trần trụi — không ô nộp link, không có gì cho người duyệt xem, luồng Nội dung xịn đứng ngoài.

## 2. Nguyên lý phương án (đúng luồng Hub, không chế đường phụ)

> **"Kế hoạch duyệt xong → mỗi công đoạn SẢN XUẤT nội dung tự sinh một Bài, gắn vào việc."**

- Công đoạn `idea / shooting / editing` chưa gắn bài → hệ thống **tự tạo Bài** (tiêu đề = tên
  công đoạn, thuộc chiến dịch + Kế hoạch phụ, trạng thái nháp, trụ nội dung gắn sau).
- Công đoạn `publish / review` chưa gắn bài → **thừa hưởng Bài của công đoạn nó phụ thuộc**
  (Đăng bài đăng đúng bài mình chờ). Không phụ thuộc ai → giữ là việc thường (không chế bài rỗng).
- Công đoạn đã gắn bài tay (picker sẵn có) → tôn trọng, không đụng.

Từ đó **mọi mắt xích sẵn có tự chạy, không viết luồng mới**: người làm bấm *Nộp duyệt* (hộp
nhập link đã có) → sinh phiên bản; người duyệt vào màn *Duyệt nội dung* thấy link; duyệt xong
việc tự Done; trả lại việc tự quay về người làm; Đăng bài bị chặn tới khi bài approved.

## 3. Các đợt

| Đợt | Nội dung | Trạng thái |
|---|---|---|
| 1 | **Migration 00217**: sinh việc từ kế hoạch tự tạo/thừa hưởng Bài (chép nguyên văn 00195, chỉ thêm) + backfill việc CHƯA kết thúc đang thiếu bài | code xong — CEO chạy |
| 1 | **UI**: thẻ việc hiện mô tả + trạng thái Bài + link "Xem bài"; đang chờ duyệt vẫn thấy link; bị trả lại → "Nộp lại" cùng hộp cũ; hộp Chờ-tôi-duyệt (việc thường) hiện mô tả | code xong |
| 2 | Luồng "Chia Task Ngay" (split) tự sinh Bài tương tự + cập nhật 2 hướng dẫn + UAT 2 vai trọn vòng | sau khi Đợt 1 nghiệm thu |

## 4. Điểm an toàn

- 00217 **chép nguyên văn** RPC 00195 (diff chứng minh chỉ THÊM); không đổi chữ ký (create or replace).
- Backfill chỉ đụng việc **chưa done/canceled** thiếu bài — việc đã xong không bị dựng dậy.
- Bài tự sinh ở trạng thái nháp, chưa gắn trụ → hiện badge "Chưa gắn trụ" sẵn có, gắn sau không chặn luồng.
- Không đổi RLS, không đổi quyền; đường duyệt rủi ro cao (High/Critical → CEO) giữ nguyên.
