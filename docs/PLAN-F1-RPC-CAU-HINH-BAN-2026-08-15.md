# PLAN F1 — KHOÁ GHI CẤU HÌNH BÀN & SƠ ĐỒ BÀN Ở MÁY CHỦ

Lập 15/08/2026, theo `docs/BAN-GIAO-CLAUDE-TIEP-TUC-ONEBIZ-2026-08-15.md` mục F1.
**Chưa viết migration.** Plan này + kết quả preflight `docs/PREFLIGHT-F1-CAU-HINH-BAN-2026-08-15.sql` phải được duyệt trước.

## 1. Kết quả khảo sát caller — 15 đường ghi trình duyệt

### Thuộc phạm vi F1 (cấu hình)

| # | Hàm (service) | Ghi vào | Caller thật | Vấn đề |
|---|---|---|---|---|
| 1 | `createTable` | INSERT `restaurant_tables` | `he-thong/quan-ly-ban/page.tsx:232,252` | ⚠️ `tenant_id` nhận **từ tham số client** |
| 2 | `bulkCreateTables` | INSERT nhiều dòng | `quan-ly-ban/page.tsx:313` | ⚠️ `tenant_id` từ client |
| 3 | `updateTable` | UPDATE tên/số/khu/sức chứa/sort/vị trí | `quan-ly-ban/page.tsx:271` + `quan-ly-ban/floor-plan-editor.tsx:186` | không kiểm quyền máy chủ |
| 4 | `deleteTable` | UPDATE `is_active=false` | `quan-ly-ban/page.tsx:299` | guard `status='available'` chỉ nằm trong WHERE → bàn đang bận thì **im lặng không xoá, không báo lỗi** |
| 5 | `renameZone` | UPDATE cột TEXT `zone` hàng loạt | `quan-ly-ban/page.tsx:332` | chỉ đổi TEXT, không đụng `floor_plan_zones.name` → hai màn lệch tên khu |
| 6 | `deleteZone` | UPDATE `is_active=false` theo khu | `quan-ly-ban/page.tsx:356` | WHERE `status='available'` → **xoá khu một phần im lặng**: bàn đang bận trong khu vẫn sống |
| 7 | `createFloorPlanZone` | INSERT `floor_plan_zones` | `shared/floor-plan/floor-plan-editor.tsx:120,253` | không kiểm quyền máy chủ |
| 8 | `updateFloorPlanZone` | UPDATE mọi cột (kể cả `is_active`) | `floor-plan-editor.tsx:342–401` (6 chỗ) | như trên |
| 9 | `deleteFloorPlanZone` | UPDATE `is_active=false` | `floor-plan-editor.tsx:272` | **không kiểm bàn còn gắn `zone_id`** → bàn mồ côi khu đã ẩn |
| 10 | `updateTableLayout` | UPDATE shape/size/rotation/vị trí/màu/locked/`zone_id` | `floor-plan-editor.tsx:76,202,230` | không kiểm `zone_id` đích cùng chi nhánh; server không biết `locked` |
| 11 | `bulkSaveTableLayouts` | vòng lặp N UPDATE | (không còn caller — chỉ export) | **không nguyên tử**; là export chết |
| 12 | `createDecoration` | INSERT `floor_plan_decorations` | `floor-plan-editor.tsx:290` | phát hiện thêm ngoài 2 tệp đề bài — cùng màn sơ đồ |
| 13 | `updateDecoration` | UPDATE | `floor-plan-editor.tsx:85,318` | như trên |
| 14 | `deleteDecoration` | **DELETE cứng** | `floor-plan-editor.tsx:331` | xoá vĩnh viễn, không audit |
| 15 | `uploadFloorPlanBackground`/remove | Storage bucket `floor-plans` | `floor-plan-editor.tsx:~342` | ngoài phạm vi RPC bảng — ghi nhận, xử lý bằng Storage policy ở đợt riêng |

### NGOÀI phạm vi F1 (vận hành — báo cáo, không đụng trong PR này)

| Hàm | Hiện trạng |
|---|---|
| `updateTableStatus`, `claimTable`, `releaseTable` | **0 caller** ngoài barrel `index.ts:448` — export chết, đề nghị gỡ export (đúng mẫu PR #217) trong PR F1 phần UI |
| `markTableAvailable` | đã qua RPC `mark_fnb_table_available_atomic` (00275) ✅ |
| `kitchen-orders.ts:533` | `cancelKitchenOrder` ghi thẳng `restaurant_tables` để nhả bàn — thuộc luồng huỷ đơn bếp, xử lý ở đợt RPC đơn bếp, KHÔNG gộp vào F1 |

## 2. Rủi ro chính (xếp theo mức)

1. **Bất kỳ ai đăng nhập đều có thể ghi cấu hình.** Mọi guard hiện nằm ở client (PermissionPage/nav). Nếu preflight F2 xác nhận `authenticated` có INSERT/UPDATE/DELETE trực tiếp trên 3 bảng và RLS tắt (khả năng cao — cùng di chứng `00010`), thì nhân viên không quyền vẫn sửa/xoá được toàn bộ sơ đồ bàn qua devtools, thậm chí **cross-tenant nếu policy không đỡ**.
2. `tenant_id` của `createTable`/`bulkCreateTables` là **input client** — giả mạo được.
3. Xoá bàn/khu **im lặng nửa vời** (mục 4, 6) — không phải lỗ bảo mật nhưng là bẫy vận hành: quản lý tưởng đã xoá.
4. Không audit bất kỳ thay đổi cấu hình nào; `deleteDecoration` xoá cứng không dấu vết.
5. Lưu sơ đồ N lệnh rời — mất mạng giữa chừng là nửa sơ đồ mới nửa cũ.
6. Hai hệ "khu vực" song song (TEXT `zone` vs `floor_plan_zones`) — F1 **không hợp nhất** (đổi nghiệp vụ), chỉ RPC hoá đúng hành vi hiện tại; đo độ lệch bằng preflight F6 để CEO quyết sau.

## 3. Thiết kế RPC — 4 hàm theo hành động (BẢN CHỐT theo duyệt CEO 15/08)

> CEO chốt: **KHÔNG** làm RPC "Lưu tất cả" thay editor — editor tự lưu từng
> thao tác nên RPC theo từng hành động + một RPC lô cho layout (đơn hoặc
> nhiều bàn, 1 giao dịch). Bảng cũ 3 hàm bên dưới đã được thay bằng 4 hàm
> trong `00323_fnb_table_config_rpcs.sql`:
>
> 1. `fnb_table_config_atomic(p_action, p_branch_id, p_payload)` — create /
>    update / delete / bulk_create / zone_rename / zone_delete; quyền
>    `system.manage_branches`; create nhận luôn `zone_id/shape/position_x/y`
>    (tạo bàn từ sơ đồ trong 1 transaction); zone_rename đồng bộ tên khu sơ
>    đồ trùng tên.
> 2. `fnb_floor_zone_config_atomic(p_action, p_branch_id, p_payload)` —
>    create / update / delete khu sơ đồ; quyền `floor_plan.edit_global`
>    (mọi chi nhánh trong tenant) HOẶC `floor_plan.edit_branch` (+
>    `user_has_branch_access`); đổi tên → sync `restaurant_tables.zone`;
>    delete chặn khi khu còn bàn.
> 3. `fnb_floor_layout_update_atomic(p_items)` — layout 1–200 bàn, 1 giao
>    dịch, FOR UPDATE từng bàn, quyền per-branch như trên.
> 4. `fnb_floor_decoration_config_atomic(p_action, p_payload)` — trang trí;
>    chi nhánh suy từ zone; delete giữ XOÁ CỨNG nhưng audit TRƯỚC khi xoá.

Khuôn chung theo mẫu 00196/00275/00277/00321/00322 đã chạy ổn:

- `SECURITY DEFINER` + `SET search_path = ''`, tên bảng đầy đủ `public.*`;
- `v_actor := auth.uid()` — null → `42501 CONFIG_AUTH_REQUIRED`;
- profile phải active + đúng tenant (`KPI_PROFILE_INACTIVE` tương đương);
- quyền hiệu lực qua `public.user_has_permission` (đã gồm vai trò + cấp riêng − thu hồi riêng);
- chi nhánh: bàn/khu phải thuộc tenant; người gọi phải `user_has_branch_access` với chi nhánh đó;
- audit mỗi hành động 1 dòng vào `public.audit_log` (`entity_type`: `restaurant_table` / `floor_plan_zone` / `floor_plan_decoration`, kèm `old_data`/`new_data`);
- `REVOKE ALL FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated`, ghi đủ chữ ký;
- **migration không đổi một dòng dữ liệu nào.**

| Hàm | Actions | Guard riêng |
|---|---|---|
| `fnb_table_config_atomic(p_action text, p_branch_id uuid, p_payload jsonb)` | `create` · `update` · `delete` · `bulk_create` · `zone_rename` · `zone_delete` | `delete`/`zone_delete`: bàn phải `status='available'` **và** `current_order_id IS NULL`, vi phạm → RAISE tiếng Việt rõ (hết im lặng nửa vời); `create`/`bulk_create`: chống trùng `table_number` trong chi nhánh |
| `fnb_floor_zone_config_atomic(p_action text, p_branch_id uuid, p_payload jsonb)` | `create` · `update` · `delete` | `delete`: nếu còn bàn active gắn `zone_id` → RAISE "Chuyển bàn sang khu khác trước khi xoá" (đổi từ hành vi mồ côi hiện tại — cần CEO gật) |
| `fnb_floor_layout_save_atomic(p_zone_id uuid, p_tables jsonb, p_decorations jsonb, p_deleted_decoration_ids uuid[])` | lưu TOÀN BỘ sơ đồ một giao dịch | thay N lệnh rời; mọi bàn/trang trí trong payload phải thuộc đúng tenant + chi nhánh của zone; decoration xoá qua đây (có audit) thay cho DELETE cứng từ client |

**Mã quyền — CẬP NHẬT sau preflight 15/08 (F4 đo thật):**

Số đo: `pos_fnb.manage_tables` thuộc Admin + Chủ cửa hàng + Quản lý **+ PHỤC VỤ**
(vì mã này dùng cho thao tác vận hành: chuyển/gộp/nhả bàn). Nếu dùng nó cho RPC
CẤU HÌNH như văn bản bàn giao đề nghị thì **phục vụ tạo/xoá được bàn** — rộng
hơn UI hiện tại (trang cấu hình đang khoá `system.manage_branches` = Admin +
Chủ cửa hàng).

Đề xuất chốt (giữ ĐÚNG phạm vi quyền như UI hôm nay, không nới):

- `fnb_table_config_atomic`: **`system.manage_branches`** (khớp gate trang
  Bàn & Khu vực).
- `fnb_floor_zone_config_atomic` + `fnb_floor_layout_save_atomic`:
  **`floor_plan.edit_branch` hoặc `floor_plan.edit_global`** (khớp gate trang
  Sơ đồ bàn: Admin + Chủ cửa hàng + Quản lý), kèm `user_has_branch_access`.
- `pos_fnb.manage_tables` GIỮ NGUYÊN cho nhóm RPC vận hành (00275/00321/00322),
  không dùng cho cấu hình.

## 4. Thứ tự triển khai — 3 bước, 2 PR + 1 migration chờ

Ràng buộc: nhân viên **đang cấu hình FnB trên production** — không được làm gãy giữa chừng.

1. **PR F1a** (một PR): migration RPC + rollback + preflight/hậu kiểm docs + service chuyển sang gọi RPC + gỡ export chết (`updateTableStatus`/`claimTable`/`releaseTable`/`bulkSaveTableLayouts`) + test giả lập đủ nhánh quyền/guard. UI giữ nguyên hành vi. CEO chạy migration **trước khi merge PR** (RPC phải tồn tại trước khi bundle mới gọi nó); bundle cũ vẫn ghi trực tiếp được → không ai gãy.
2. **Hậu kiểm** chỉ đọc: cấu hình bàn trước/sau y nguyên (so với ảnh chụp preflight F5/F6); CEO thử sửa 1 bàn trên UI thật.
3. **Migration F1b — khoá cửa cũ** (chạy SAU khi xác nhận không còn bundle cũ hoạt động, ~1 ngày sau deploy): `REVOKE INSERT/UPDATE/DELETE ON 3 bảng FROM authenticated` (+ `anon` nếu còn). Có rollback GRANT lại. Đây là bước biến "khuyến khích dùng RPC" thành "chỉ còn RPC".

Không gộp bất kỳ phần nào của F2 (đặt bàn) vào đây.

## 5. Rollback

- PR F1a: revert commit squash → service quay lại ghi trực tiếp (vẫn chạy vì F1b chưa revoke). RPC nằm im vô hại; muốn gỡ hẳn chạy rollback migration (`DROP FUNCTION` đủ chữ ký).
- F1b: rollback = GRANT lại đúng các quyền đã revoke (ghi rõ trong tệp rollback).

## 5b. Kết quả preflight 15/08 — đã có số thật

- **RLS BẬT trên cả 3 bảng** (khác `invoices`): `restaurant_tables` 3 policy
  INSERT/SELECT/UPDATE (KHÔNG có DELETE → xoá cứng bàn đã bị chặn sẵn);
  `floor_plan_zones`/`floor_plan_decorations` mỗi bảng 1 policy ALL
  tenant-isolation (→ xoá cứng decoration được). Policy chỉ cô lập tenant,
  KHÔNG kiểm quyền → **mọi nhân viên trong tenant ghi được cấu hình**, đây là
  lỗ RPC phải đóng. Cross-tenant đã bị chặn.
- **Grant**: `authenticated` đủ 7 quyền kể cả TRUNCATE trên cả 3 bảng.
  TRUNCATE không đi qua RLS nhưng PostgREST không expose nên không khai thác
  được qua API — vẫn thu hồi trong F1b cho sạch. `anon` = 0 grant (00239 đứng).
- **`audit_log`**: `authenticated` có cả DELETE/UPDATE/TRUNCATE → nhật ký
  sửa/xoá được. F1b thu hồi 3 quyền này (giữ INSERT + SELECT vì client còn ghi
  audit trực tiếp và tab Lịch sử cần đọc).
- **Dữ liệu**: tenant OneBiz hiện có **0 bàn**, 1 khu sơ đồ (Xưởng Đồng Xoài),
  0 trang trí, 0 ghi đè quyền cá nhân → thời điểm tốt nhất để khoá: migration
  không phải bảo toàn dữ liệu nào, hậu kiểm trước/sau tầm thường.
- Hàm nền đủ 6/6, đúng chữ ký.

## 6. Cần CEO trước khi em viết migration

1. Chạy `docs/PREFLIGHT-F1-CAU-HINH-BAN-2026-08-15.sql` (chỉ đọc) và gửi kết quả — quan trọng nhất là **F2 (grant)** và **F4 (vai trò giữ mã quyền nào)**.
2. Chốt tập mã quyền cho 2 hàm sơ đồ (mục 3).
3. Gật/chỉnh 2 chỗ **đổi hành vi có chủ đích**: xoá bàn/khu đang bận → báo lỗi rõ thay vì im lặng; xoá khu sơ đồ còn bàn → chặn.

---

## 7. Nhật ký thực hiện (cập nhật 15/08/2026)

### F1a — XONG, đã lên production
- PR #218 merged → `main` `a1cbe99`; migration **00323** (4 RPC) + **00324** (vá quyền) CEO đã chạy.
- **Lỗi bắt được trước khi merge (00324):** trang Sơ đồ bàn mở cho `floor_plan.edit_*`,
  nhưng nút thêm bàn trong đó gọi `createTable` vốn đòi `system.manage_branches`.
  Vai trò **Quản lý** của OneBiz có `edit_branch` mà không có `manage_branches`
  → sẽ mất chức năng đang dùng được. Vá: nhánh create **có `zone_id`** (chỉ
  editor sơ đồ gửi kèm) chấp nhận thêm quyền floor_plan; các action khác giữ
  nguyên. Bài học: **đối chiếu `role_permissions` thật trước khi khoá quyền.**
- Hậu kiểm sau deploy: dữ liệu nguyên vẹn, anon gọi RPC → 401, gọi không có
  người dùng → "Bạn cần đăng nhập".

### F1b — chưa chạy, chờ 24–48h theo dõi + CEO gật
Đã quét lại toàn bộ mã nguồn: chỉ còn **một** đường ghi thẳng 3 bảng, ở
`kitchen-orders.ts:533` trong `cancelKitchenOrder` — hàm **0 caller, không
export ở barrel** (đã gỡ từ PR #217) → thu hồi quyền sẽ không làm chết màn nào.
Muốn triệt để thì dọn hàm chết + 4 tệp test còn tham chiếu nó.

### F1c — ảnh nền sơ đồ (migration 00325)
Preflight 15/08 đo được:
- Bucket `floor-plans`: công khai, **không giới hạn dung lượng, không giới hạn
  loại tệp**, đang **rỗng 0 tệp**.
- 3 policy riêng của bucket chỉ kiểm "đã đăng nhập" → nhân viên công ty A ghi
  đè / xoá được ảnh nền của công ty B.
- **Thiếu hẳn policy UPDATE**, trong khi mã nguồn upload ở chế độ ghi đè →
  **đổi ảnh nền lần thứ hai cho cùng một khu sẽ bị chặn**. Chưa ai vấp vì
  bucket còn rỗng. 00325 sửa luôn.

00325 làm: 4 policy theo `{tenant}/{branch}/{zone}` + quyền `floor_plan.edit_*`
(edit_branch phải kèm quyền chi nhánh), giới hạn bucket 5MB + chỉ ảnh, hậu kiểm
ngay trong migration để bảo đảm **không đụng policy của `product-images`**.
Đọc ảnh qua đường dẫn công khai không đổi → sơ đồ vẫn hiển thị như cũ.
