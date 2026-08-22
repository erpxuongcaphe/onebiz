# Ngày hóa đơn (00335/00336) — đọc ngày ở đâu, cột nào

Cập nhật 21/08/2026. Tài liệu này trả lời đúng một câu hỏi: **chỗ nào đọc ngày
hóa đơn, chỗ nào cố ý giữ thời gian thao tác thật.**

## Ba cột, ba vai trò

| Cột | Ý nghĩa | Ai được ghi |
|---|---|---|
| `invoices.created_at` | **Dấu vết tạo bản ghi.** Không bao giờ sửa, không tái sử dụng. | Chỉ hệ thống, lúc INSERT |
| `invoices.issued_at` | **Ngày phát hành hóa đơn.** Nháp chưa bán thì null. | Trigger 00336 (giờ máy chủ) hoặc RPC v4/v6 khi có quyền + lý do + audit |
| `invoices.ngay_chung_tu` | Cột sinh `coalesce(issued_at, created_at)` **STORED** | Không ai — Postgres tự tính |

Vì sao cần cột sinh: PostgREST không lọc/sắp xếp được theo biểu thức, và chuỗi
ISO có dấu `+` dễ vỡ khi mã hóa URL trong `.or()`. Có cột thật thì `.gte`,
`.lt`, `.order` chạy thẳng.

## Quy tắc chọn cột

> **Báo cáo doanh thu và danh sách hóa đơn → `ngay_chung_tu`.**
> **Ca, sổ quỹ, phiếu thu, chuyển động kho, đồng bộ → thời gian giao dịch thật.**

Lý do: một hóa đơn được ghi lùi ngày vẫn **thu tiền hôm nay** và **trừ kho hôm
nay**. Nếu kéo ngày hóa đơn vào sổ quỹ thì ca không khớp tiền mặt trong két.

## Đã đổi sang ngày chứng từ

| Nơi | Tệp |
|---|---|
| Danh sách hóa đơn, in, xuất Excel | `src/lib/services/supabase/invoices.ts` |
| Dashboard | `src/lib/services/supabase/dashboard.ts` |
| Phân tích doanh thu | `src/lib/services/supabase/analytics.ts` |
| Phân tích ABC | `src/lib/services/supabase/abc-analysis.ts` |
| Báo cáo F&B | `src/lib/services/supabase/fnb-analytics.ts` |
| KPI | `src/lib/services/supabase/kpi-engine.ts` |
| Phân tích khuyến mãi | `src/lib/services/supabase/promotion-analytics.ts` |
| Chốt ngày | `src/app/api/cron/end-of-day/route.ts` |
| Danh sách đơn bán con | `orders.ts` → `listChildSales` |
| **Lịch sử bán của sản phẩm** | `products.ts` → `getSalesHistory` *(vá 21/08 — trước đó lệch với danh sách hóa đơn)* |
| 3 RPC Khách × Sản phẩm | migration `00338_report_rpcs_issued_at.sql` |

## Cố ý GIỮ thời gian thao tác thật

| Nơi | Tệp | Vì sao |
|---|---|---|
| Hóa đơn trong ca | `pos/components/shift-invoice-drawer.tsx` (`dateColumn: "created_at"`) | Ca phải khớp tiền thật trong két |
| Sổ quỹ, phiếu thu | `finance-*.ts`, `payments.ts` (bảng `cash_transactions`) | Tiền vào/ra theo giờ thật |
| `get_finance_dashboard_report` (00258) | migration | Chỉ đọc `cash_transactions.created_at` |
| Danh sách **đơn đặt hàng** | `orders.ts` (`applyCreatedAtRangeFilter`) | Ngày đặt hàng ≠ ngày hóa đơn |
| Nháp / đơn chưa bán | `orders.ts:816`, `:876` | Chưa phát hành nên chưa có ngày hóa đơn |
| Trả hàng `sales_returns` | `invoices.ts:207` | Bảng khác, `created_at` là ngày trả thật |
| Chuyển động kho, `kitchen_orders` | các bảng riêng | Giờ thao tác thật |

## Luật máy chủ

- Client **không được tin**: ngày, tenant, chi nhánh, quyền đều lấy lại phía
  máy chủ trong RPC `pos_complete_checkout_atomic_v4` / `complete_draft_atomic_v6`.
- Chỉnh tay phải có quyền `invoices.adjust_issued_at`, có lý do, trong tháng
  hiện tại, tương lai tối đa +5 phút, và ghi `audit_log` **cùng transaction** —
  lỗi audit thì cuộn lại toàn bộ.
- Ghi thẳng `issued_at` qua REST bị trigger 00336 chặn (`app.issued_at_bypass`).
- Retry không đổi `issued_at` đã chốt và không ghi audit lặp (`v_la_retry`).
- Offline: `checkout_client_at` ghi ngay lúc bấm thanh toán và **giữ nguyên qua
  mọi lần thử lại** (`src/lib/offline/offline-checkout.ts`) — chỉ để tham chiếu,
  không phải nguồn quyết định ngày.

## Ngày hóa đơn thuộc RIÊNG từng tab POS

`ngayHoaDon` từng là state toàn trang nên chỉnh ở tab A thì tab B lĩnh luôn.
Từ 21/08 ngày đi theo tab đúng như giỏ hàng và phiên tự lưu — phép biến đổi nằm
ở `src/app/pos/lib/pos-tab-transitions.ts`, có test hành vi riêng.

Tab mới, nạp nháp, và đơn bán con tạo từ đơn đặt hàng đều bắt đầu ở chế độ tự
động: **ngày bán là hôm nay, không kế thừa ngày của bản ghi gốc.**
