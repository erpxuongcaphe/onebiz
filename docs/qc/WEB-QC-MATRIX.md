# Ma trận kiểm kê web OneBiz

> Báo cáo tĩnh sinh từ mã nguồn. Chưa phải kết quả UAT trên trình duyệt hoặc xác nhận dữ liệu production.

## Tổng quan

- Tổng trang: 158
- Trang production: 145
- Trang mockup: 13
- API routes: 66
- Đường dẫn trong menu: 61
- Thành phần thao tác phát hiện được: 398
- Lệnh ghi Supabase trực tiếp phát hiện được: 17
- Thành phần cần kiểm tra handler thủ công: 43

## Lệnh ghi trực tiếp cần rà soát

| Route | Bảng | Lệnh | File:dòng |
|---|---|---|---|
| /api/ai-agent/kpi | `kpi_breakdowns` | insert | `src/app/api/ai-agent/kpi/route.ts:122` |
| /api/ai-agent/kpi | `agent_executions` | insert | `src/app/api/ai-agent/kpi/route.ts:135` |
| /api/ai-agent/kpi | `agents` | update | `src/app/api/ai-agent/kpi/route.ts:145` |
| /api/ai-agent/task | `agent_tasks` | insert | `src/app/api/ai-agent/task/route.ts:120` |
| /api/ai-agent/task | `agent_executions` | insert | `src/app/api/ai-agent/task/route.ts:133` |
| /api/ai-agent/task | `agents` | update | `src/app/api/ai-agent/task/route.ts:143` |
| /api/cron/end-of-day | `notifications` | insert | `src/app/api/cron/end-of-day/route.ts:116` |
| /api/cron/stock-reconciliation | `notifications` | insert | `src/app/api/cron/stock-reconciliation/route.ts:162` |
| /api/cron/stock-reconciliation | `audit_log` | insert | `src/app/api/cron/stock-reconciliation/route.ts:166` |
| /api/mkt/v1/audit-runner/ai | `mkt_security_events` | insert | `src/app/api/mkt/v1/audit-runner/ai/route.ts:169` |
| /api/mkt/v1/audit-runner/ai | `mkt_security_events` | insert | `src/app/api/mkt/v1/audit-runner/ai/route.ts:201` |
| /api/mkt/v1/audit-runner/setup | `tenants` | insert | `src/app/api/mkt/v1/audit-runner/setup/route.ts:118` |
| /api/mkt/v1/audit-runner/setup | `branches` | insert | `src/app/api/mkt/v1/audit-runner/setup/route.ts:137` |
| /api/mkt/v1/audit-runner/setup | `profiles` | upsert | `src/app/api/mkt/v1/audit-runner/setup/route.ts:169` |
| /api/mkt/v1/audit-runner/setup | `mkt_audit_actors` | insert | `src/app/api/mkt/v1/audit-runner/setup/route.ts:196` |
| /api/mkt/v1/audit-runner/setup | `tenants` | delete | `src/app/api/mkt/v1/audit-runner/setup/route.ts:213` |
| /api/mkt/v1/notifications/read | `notifications` | update | `src/app/api/mkt/v1/notifications/read/route.ts:26` |

## Route menu chưa khớp trực tiếp với page

- Không có.

## Phạm vi trang production

| Route | Nhóm | Nút/thao tác | Data calls | Ghi trực tiếp | Bắt lỗi |
|---|---:|---:|---:|---:|---:|
| / | erp | 0 | 0 | 0 | Có |
| /ai-agents | erp | 3 | 0 | 0 | Có |
| /ai-agents/[id] | erp | 13 | 0 | 0 | Có |
| /ai-agents/kpi | erp | 7 | 0 | 0 | Có |
| /ai-agents/tasks | erp | 6 | 0 | 0 | Có |
| /ban-online | erp | 1 | 0 | 0 | Chưa thấy |
| /ban-online/don-hang | erp | 1 | 0 | 0 | Chưa thấy |
| /ban-online/facebook | erp | 4 | 0 | 0 | Chưa thấy |
| /ban-online/website | erp | 4 | 0 | 0 | Chưa thấy |
| /ban-online/zalo | erp | 4 | 0 | 0 | Chưa thấy |
| /cai-dat | erp | 0 | 0 | 0 | Chưa thấy |
| /cai-dat/ban-hang | erp | 3 | 0 | 0 | Chưa thấy |
| /cai-dat/bang-gia | erp | 0 | 0 | 0 | Có |
| /cai-dat/bang-gia/platforms | erp | 5 | 0 | 0 | Có |
| /cai-dat/chi-nhanh | erp | 11 | 0 | 0 | Có |
| /cai-dat/fnb-presets | erp | 5 | 0 | 0 | Có |
| /cai-dat/giao-dien | erp | 5 | 0 | 0 | Chưa thấy |
| /cai-dat/giao-hang | erp | 0 | 0 | 0 | Có |
| /cai-dat/hoa-don | erp | 0 | 0 | 0 | Chưa thấy |
| /cai-dat/in-an | erp | 15 | 0 | 0 | Có |
| /cai-dat/ket-noi | erp | 1 | 0 | 0 | Chưa thấy |
| /cai-dat/kho-hang | erp | 1 | 0 | 0 | Có |
| /cai-dat/khuyen-mai | erp | 7 | 0 | 0 | Có |
| /cai-dat/ma-giam-gia | erp | 8 | 0 | 0 | Có |
| /cai-dat/ngon-ngu | erp | 2 | 0 | 0 | Chưa thấy |
| /cai-dat/phan-quyen | erp | 9 | 0 | 0 | Có |
| /cai-dat/phi-giao-hang | erp | 3 | 0 | 0 | Có |
| /cai-dat/so-do-ban | erp | 0 | 0 | 0 | Chưa thấy |
| /cai-dat/thanh-toan | erp | 2 | 0 | 0 | Có |
| /cai-dat/thiet-bi-pos | erp | 3 | 0 | 0 | Chưa thấy |
| /cai-dat/thong-bao | erp | 2 | 0 | 0 | Chưa thấy |
| /cai-dat/tich-diem | erp | 8 | 0 | 0 | Có |
| /cap-otp | erp | 0 | 0 | 0 | Chưa thấy |
| /dang-nhap | auth | 2 | 1 | 0 | Có |
| /dat-lai-mat-khau | auth | 2 | 0 | 0 | Chưa thấy |
| /doi-tac/giao-hang | erp | 0 | 0 | 0 | Chưa thấy |
| /doi-tac/ncc | erp | 0 | 0 | 0 | Chưa thấy |
| /don-hang/dat-hang | erp | 1 | 0 | 0 | Có |
| /don-hang/doi-tac-giao-hang | erp | 0 | 0 | 0 | Chưa thấy |
| /don-hang/hoa-don | erp | 1 | 0 | 0 | Có |
| /don-hang/tra-hang | erp | 0 | 0 | 0 | Có |
| /don-hang/van-don | erp | 1 | 0 | 0 | Có |
| /hang-hoa | erp | 14 | 0 | 0 | Có |
| /hang-hoa/ban-noi-bo | erp | 0 | 0 | 0 | Có |
| /hang-hoa/chuyen-kho | erp | 7 | 0 | 0 | Có |
| /hang-hoa/cong-thuc | erp | 3 | 0 | 0 | Có |
| /hang-hoa/dat-hang-nhap | erp | 0 | 0 | 0 | Có |
| /hang-hoa/don-vi-tinh | erp | 6 | 0 | 0 | Có |
| /hang-hoa/hoa-don-dau-vao | erp | 2 | 0 | 0 | Có |
| /hang-hoa/hsd | erp | 0 | 0 | 0 | Có |
| /hang-hoa/kiem-kho | erp | 0 | 0 | 0 | Có |
| /hang-hoa/lich-su-kho | erp | 2 | 0 | 0 | Có |
| /hang-hoa/lo-san-xuat | erp | 0 | 0 | 0 | Có |
| /hang-hoa/nha-cung-cap | erp | 0 | 0 | 0 | Có |
| /hang-hoa/nhap-hang | erp | 3 | 0 | 0 | Có |
| /hang-hoa/nhom | erp | 10 | 0 | 0 | Có |
| /hang-hoa/san-xuat | erp | 1 | 0 | 0 | Có |
| /hang-hoa/thiet-lap-gia | erp | 9 | 0 | 0 | Có |
| /hang-hoa/ton-kho | erp | 8 | 0 | 0 | Có |
| /hang-hoa/tra-hang-nhap | erp | 0 | 0 | 0 | Có |
| /hang-hoa/tuy-chon-fnb | erp | 10 | 1 | 0 | Có |
| /hang-hoa/xuat-dung-noi-bo | erp | 0 | 0 | 0 | Có |
| /hang-hoa/xuat-huy | erp | 0 | 0 | 0 | Có |
| /he-thong/audit | erp | 1 | 0 | 0 | Có |
| /he-thong/ca-cho-doi-soat | erp | 1 | 0 | 0 | Có |
| /he-thong/chi-nhanh | erp | 0 | 0 | 0 | Chưa thấy |
| /he-thong/quan-ly-ban | erp | 23 | 0 | 0 | Có |
| /he-thong/so-do-ban | erp | 0 | 0 | 0 | Có |
| /he-thong/thiet-lap | erp | 2 | 0 | 0 | Có |
| /he-thong/tich-hop | erp | 0 | 0 | 0 | Chưa thấy |
| /he-thong/toan-ven-kho | erp | 1 | 0 | 0 | Có |
| /he-thong/users | erp | 12 | 2 | 0 | Có |
| /ho-so | erp | 3 | 2 | 0 | Có |
| /khach-hang | erp | 0 | 0 | 0 | Có |
| /khach-hang/nhom | erp | 2 | 0 | 0 | Có |
| /manager | manager | 9 | 0 | 0 | Có |
| /manager/otp | manager | 1 | 0 | 0 | Chưa thấy |
| /mkt | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt-ai-audit/[token] | mkt-audit-public | 0 | 0 | 0 | Chưa thấy |
| /mkt/approvals | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/audit-runner | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/calendar | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/campaigns | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/campaigns/[campaignId] | mkt | 1 | 0 | 0 | Chưa thấy |
| /mkt/documents | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/kanban | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/leader-queue | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/media | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/pillars | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/planning | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/reports | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/settings | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/tasks | mkt | 0 | 0 | 0 | Chưa thấy |
| /mkt/team | mkt | 0 | 0 | 0 | Chưa thấy |
| /mua-hang/du-kien-mua-hang | erp | 1 | 0 | 0 | Có |
| /phan-tich | erp | 0 | 0 | 0 | Có |
| /phan-tich/abc-analysis | erp | 1 | 0 | 0 | Có |
| /phan-tich/aging | erp | 1 | 0 | 0 | Có |
| /phan-tich/ban-hang | erp | 0 | 0 | 0 | Có |
| /phan-tich/bao-cao-tai-chinh | erp | 0 | 0 | 0 | Có |
| /phan-tich/canh-bao | erp | 2 | 0 | 0 | Có |
| /phan-tich/chenh-lech-kiem-ke | erp | 1 | 0 | 0 | Có |
| /phan-tich/cogs-theo-bom | erp | 0 | 0 | 0 | Có |
| /phan-tich/cong-no-aging | erp | 1 | 0 | 0 | Có |
| /phan-tich/cuoi-ngay | erp | 0 | 0 | 0 | Có |
| /phan-tich/customer-cohort | erp | 0 | 0 | 0 | Có |
| /phan-tich/dat-hang | erp | 0 | 0 | 0 | Có |
| /phan-tich/doi-chieu-ca | erp | 0 | 0 | 0 | Có |
| /phan-tich/fnb | erp | 0 | 0 | 0 | Có |
| /phan-tich/fnb-modifier | erp | 0 | 0 | 0 | Có |
| /phan-tich/fnb-shipper | erp | 1 | 0 | 0 | Có |
| /phan-tich/hang-hoa | erp | 0 | 0 | 0 | Có |
| /phan-tich/kenh-ban | erp | 0 | 0 | 0 | Có |
| /phan-tich/khach-hang | erp | 0 | 0 | 0 | Có |
| /phan-tich/khach-san-pham | erp | 5 | 0 | 0 | Có |
| /phan-tich/khuyen-mai | erp | 0 | 0 | 0 | Có |
| /phan-tich/kiem-ke | erp | 0 | 0 | 0 | Có |
| /phan-tich/lot-traceability | erp | 0 | 0 | 0 | Có |
| /phan-tich/luong-tien | erp | 0 | 0 | 0 | Có |
| /phan-tich/nha-cung-cap | erp | 0 | 0 | 0 | Có |
| /phan-tich/nhan-vien | erp | 1 | 0 | 0 | Có |
| /phan-tich/platform-commission | erp | 0 | 0 | 0 | Có |
| /phan-tich/rfm | erp | 2 | 0 | 0 | Có |
| /phan-tich/serve-time | erp | 0 | 0 | 0 | Có |
| /phan-tich/tai-chinh | erp | 0 | 0 | 0 | Có |
| /phan-tich/tieu-hao-nvl | erp | 0 | 0 | 0 | Có |
| /phan-tich/ton-that | erp | 2 | 0 | 0 | Có |
| /phan-tich/tong-hop-kenh | erp | 0 | 0 | 0 | Có |
| /phan-tich/tra-hang | erp | 2 | 0 | 0 | Có |
| /phan-tich/trung-tam | erp | 2 | 0 | 0 | Chưa thấy |
| /phan-tich/vat | erp | 2 | 0 | 0 | Có |
| /phan-tich/xuat-nhap-ton | erp | 2 | 0 | 0 | Có |
| /pos | pos | 60 | 1 | 0 | Có |
| /pos/fnb | pos | 8 | 3 | 0 | Có |
| /pos/fnb/kds | pos | 14 | 0 | 0 | Có |
| /quen-mat-khau | auth | 2 | 1 | 0 | Chưa thấy |
| /san-xuat | erp | 7 | 0 | 0 | Có |
| /so-quy | erp | 0 | 0 | 0 | Có |
| /sop | sop | 0 | 0 | 0 | Chưa thấy |
| /sop/bep | sop | 0 | 0 | 0 | Chưa thấy |
| /sop/pha-che | sop | 0 | 0 | 0 | Chưa thấy |
| /sop/quan-ly | sop | 0 | 0 | 0 | Chưa thấy |
| /sop/thu-ngan | sop | 0 | 0 | 0 | Chưa thấy |
| /tai-chinh/cong-no | erp | 7 | 0 | 0 | Có |
| /thong-bao | erp | 3 | 0 | 0 | Có |

## Giới hạn

- Công cụ chỉ kiểm kê mã nguồn; handler truyền qua component và thao tác server-side cần rà thủ công.
- Một lệnh ghi trực tiếp không mặc nhiên là lỗi; phải đối chiếu quyền, trạng thái và tính nguyên tử.
- Kết quả cuối cùng phải được xác nhận bằng test API/RPC và UAT trên Chrome.
