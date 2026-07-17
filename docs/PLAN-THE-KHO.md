# PLAN — Thiết kế lại Thẻ kho / Lịch sử nhập xuất

> Chốt 17/07/2026. Nguồn: 2 workflow khảo sát (14 agent) + verify DB thật read-only.
> CEO đã chốt: **tồn cuối theo CHI NHÁNH** · **muốn có giá**.

## 0. Sự thật đã verify trên DB thật (không phải đọc code)

- **2.231 dòng sổ · 13 loại phát sinh thật**: bom_consume 1.408 (63%) · initial_stock_import 276 · purchase_order 247 · initial_stock_reset 139 · production_order 51+15 · invoice_void 36 · inventory_check 19+17 · purchase_order_revert 8 · production_reconcile 6+1 · disposal_export 3 · return_bom_restore 3 · invoice 1 · adjustment 1.
- Cột `type` chỉ có **'in' / 'out'** (KHÔNG có adjust/transfer → code khai 2 loại đó là **code chết**).
- `reference_id` NULL: **415 dòng** = đúng bằng initial_stock_import(276) + initial_stock_reset(139) → nhóm **tồn đầu kỳ**, không có chứng từ (đúng, không phải lỗi).
- **Giá nhập** = theo từng đợt (`purchase_order_items.unit_price` — 241 dòng, 98% có giá > 0).
- **Giá xuất** = giá vốn bình quân (WAC) do `apply_weighted_avg_cost` (00069) tính; **mọi lần đổi đều ghi `audit_log` action='cost_price_update'** (256 bản ghi, 98 SP, phủ 29/05→14/07).
- Truy hồi giá vốn lịch sử: **1.227/2.231 = 55%** làm được; 1.004 (45%) phát sinh **trước** lần ghi giá vốn đầu tiên của chính SP đó.
- Rủi ro thứ tự: **36 cụm** trùng (SP+CN+thời điểm), 108 dòng, cụm lớn nhất **8 dòng** (1 hóa đơn nổ BOM 8 NVL cùng lúc).

## 1. Kết quả phản biện — 4 lỗi THẬT, 1 báo động giả

| Lỗi | Phán quyết | Mức |
|---|---|---|
| **A-branch** — tab "Lịch sử xuất nhập" ở /hang-hoa/ton-kho hiện giao dịch **mọi chi nhánh** dù bấm dòng 1 chi nhánh (`products.ts:654-669` chỉ `.eq(product_id)`) | **CÓ THẬT** (thử 5 hướng bác bỏ, cả 5 thất bại) | **CAO** |
| **C-export** — nút Xuất Excel `/hang-hoa/lich-su-kho` chỉ xuất **1 trang (20 dòng)**, thiếu dữ liệu âm thầm (`page.tsx:189-212` đọc state đã phân trang server-side) | **CÓ THẬT** | **CAO** |
| **B-macche** — cột "Mã phiếu" là **mã chế** = 2 ký tự reference_type + 6 ký tự UUID (`products.ts:512-513` và bản sao `:689`) | **CÓ THẬT** | TB |
| **E-nhan** — bảng nhãn thiếu 4 loại có thật (151 dòng: initial_stock_reset 139, purchase_order_revert 8, disposal_export 3, adjustment 1) + sai 2 key | **CÓ THẬT** (chỉ sai ở file xuất, **không sai tồn kho**) | TB |
| **D-internalsale** — "resolver join sai bảng internal_sales" | **BÁO ĐỘNG GIẢ** — bác bỏ bằng 2 lý do độc lập. **TUYỆT ĐỐI KHÔNG SỬA** | — |

**Phát hiện thêm:** màn "Chi tiết" của báo cáo XNT **rơi số** — service trả `inOther/outOther` nhưng UI không render cột "Khác". (Màn "Tổng hợp" **KHÔNG sai** — bucket `other` đã được cộng vào tổng; đây chính là invariant để nghiệm thu.)

## 2. Phát hiện quyết định hướng đi — repo ĐÃ CÓ tiền lệ cho bài toán giá

`00196_reporting_v3_security_scope.sql:109-113` đã thêm `invoice_items.unit_cost` **nullable** + trigger snapshot từ `products.cost_price`, kèm comment nguyên văn:
> *"Legacy history is intentionally not backfilled"*

Và `00198:356-358` đọc bằng `coalesce(unit_cost, cost_price, 0)` + **đếm riêng** `estimated_legacy_lines` vs `snapshot_lines` để báo cáo **tự khai** phần ước tính.

→ **Thẻ kho theo đúng khuôn này, không phát minh cơ chế mới.** Khớp thẳng với 55%/45% đo được ở trên.

## 3. Thiết kế chốt

**Cột bảng:** Chứng từ (mã thật, bấm mở) · Thời gian · Loại giao dịch · Số lượng ± · **Tồn cuối** · Đối tác · **Chi nhánh** · Giá vốn / Giá GD (đợt cuối) · Ghi chú (cột phụ, rút gọn).

**Tồn cuối — cộng dồn TIẾN từ đầu sổ (KHÔNG tính ngược từ `branch_stock`).**
Lý do: tính ngược **giấu drift** — nếu `branch_stock` lệch thì mọi dòng lệch cùng một hằng số và thẻ kho **luôn đẹp**, không bao giờ tự lộ sai. Cộng dồn tiến + trả kèm `drift` để UI **hiện băng cảnh báo** khi sổ ≠ máy.

**RPC** `get_stock_card(p_product_id, p_branch_id, p_date_from, p_date_to, p_limit, p_offset)` → jsonb, stable, security definer, `search_path=''`:
- Tie-break bắt buộc: `ORDER BY (created_at asc, id asc)` — vì có 36 cụm trùng thời điểm.
- Frame: `rows between unbounded preceding and current row`.
- Quyền: dùng lại `assert_report_access('inventory.view', p_branch_id)` (đã verify có thật ở 00196:56-107).
- Index mới: `(tenant_id, product_id, branch_id, created_at, id)`.
- Trả kèm `ledger_end` / `branch_stock_now` / `drift`.

**Giá — 26 điểm ghi đang sống** (18 RPC + 1 insert từ JS). ⚠️ Grep thô ra ~96 là **đánh lừa**: ~70 nằm trong migration cũ **đã bị CREATE OR REPLACE đè** → sửa vào đó vừa vô ích vừa nguy hiểm.
⚠️ **Bẫy đặt tên:** bản SỐNG của `complete_production_order` nằm ở `00158_reconcile_sx000011_complete_yaourt.sql:137`; `apply_manual_stock_movement_atomic` bản sống ở `00166_fnb_menu_lock_payment_guard.sql:540`.
⚠️ **Điểm nóng:** `consume_bom_for_sale` (00147:304) — **KHÔNG** được thêm `select cost_price` trong vòng lặp per-material (N+1 trên đường thanh toán POS). Câu select `bom_items` đã có sẵn `left join products p` → chỉ thêm `p.cost_price` vào chính câu đó.

## 4. Các đợt

| Đợt | Nội dung | Rủi ro | Nghiệm thu |
|---|---|---|---|
| **0** | Chốt quyết định + snapshot baseline (xuất Excel XNT trước khi đụng gì) | 0 | Có file baseline |
| **1** | **A-branch + C-export** (không đụng DB): lọc chi nhánh + thêm cột Chi nhánh + nhãn tab lấy `res.total`; xuất Excel fetch đủ (chunk 1000) | Thấp | Tab chỉ hiện giao dịch đúng chi nhánh; file Excel = số dòng thật |
| **2** | Mapping + nhãn + cột "Khác" XNT. **Tách 2 commit:** (1) gom mapping NGUYÊN SI → diff Excel với baseline **= 0**; (2) mới sửa phân loại | TB | Diff = 0 ở commit 1 |
| **3** | **B-macche** — cột Chứng từ mã thật, bấm mở; bỏ mã chế cả 2 chỗ | Thấp-TB | Bấm mã → mở đúng chứng từ |
| **4** | **RPC tồn cuối + index** (DB read-only) | TB | Tồn cuối dòng mới nhất = `branch_stock` |
| **5** | Đối soát drift (migration **GHI** — chỉ nếu CEO chọn bù dòng) | **CAO** | Chạy staging trước |
| **6** | **Giá** — 4 đợt con: 6a thêm 2 cột nullable (không backfill) · 6b nhóm rẻ (14 điểm) · 6c nhóm phải query (12 điểm, `consume_bom_for_sale` deploy RIÊNG) · 6d UI + backfill 55% từ audit_log | **CAO** | Sổ 3 nơi khớp; POS không chậm |

## 4b. Quyết định CEO đã chốt (17/07)

1. **Thẻ kho trình bày theo DÒNG như KiotViet**: 1 cột Số lượng (±) + 1 cột Tồn cuối; bản chất giao dịch ghi trên từng dòng ở cột "Loại giao dịch" — KHÔNG chẻ thành nhiều cột xuất.
2. **`bom_consume` = BÁN** (trừ NVL ngay lúc thanh toán, chứng từ = hóa đơn) → ở báo cáo XNT chi tiết đếm vào cột **Xuất bán**; chỉ `production_order` (chứng từ = lệnh SX) vào **Xuất SX**.
3. Tồn cuối theo **chi nhánh** (chốt từ trước).
4. **Muốn có giá** — theo khuôn 00196 (snapshot từ nay + backfill được 55% từ audit_log, phần còn lại để trống trung thực).

## 5. Phát hiện mới cần CEO quyết

**Drift do vá tay:** migration **00157 (và 00156)** đã `UPDATE` thẳng `branch_stock` **mà KHÔNG ghi dòng đối ứng** vào `stock_movements` (đã kiểm: file chỉ có `update public.branch_stock`). → Yaourt + mọi mã bị 2 migration này chạm **chắc chắn lệch** giữa sổ và máy. Khi thẻ kho có cột Tồn cuối, chỗ lệch này sẽ **hiện ra**.

Hai lựa chọn: **(a)** bù dòng đối ứng vào sổ (Đợt 5, migration ghi, rủi ro cao) — sổ khớp máy; **(b)** để nguyên, thẻ kho hiện băng cảnh báo drift ở các mã đó — trung thực, không đụng data.
