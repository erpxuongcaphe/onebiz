# Báo cáo chênh lệch sổ lô FIFO - 01/08/2026

## Kết quả sau xử lý

- Đã áp dụng các migration `00284` đến `00288` thành công.
- Hậu kiểm chỉ đọc lúc `19:04` ngày 01/08/2026: `0` mã lệch tồn chi nhánh với sổ lô FIFO.
- Không thay đổi `products.stock`, `branch_stock`, `stock_movements` hoặc chứng từ lịch sử.
- Phần dưới giữ lại nguyên nhân và bằng chứng trước xử lý để phục vụ kiểm toán.

## Kết luận

- `products.stock`, `branch_stock` và `stock_movements` đang khớp nhau.
- Có 20 mã lệch giữa tồn chi nhánh và tổng lô FIFO, tất cả tại Xưởng Cà Phê - Kho Tổng.
- Đây không phải lỗi cache hay tải dữ liệu. Chênh lệch được tạo bởi các giao dịch sau lần cân lô 00231 lúc 10:37:43 ngày 29/07/2026.
- Chưa có dữ liệu production nào bị sửa trong quá trình QC.

## Nguyên nhân đã xác minh

| Nguyên nhân | Số mã | Chứng từ xác minh |
|---|---:|---|
| Kiểm kê cập nhật tồn nhưng không cập nhật lô | 15 | IN000027, IN000028, IN000029, IN000030, IN000031, IN000032, IN000034, IN000035 |
| Xuất nguyên liệu sản xuất không trừ lô | 3 | SX000020 |
| Hoàn nhập phiếu mua đã dùng một phần làm tổng lô lệch | 1 | PO000161 / PO000162, NVL-BOT-005 |
| Mã chịu đồng thời nhiều luồng nhưng phần lệch cuối cùng vẫn do kiểm kê | 1 | NVL-CPH-002 |

Các luồng bán hàng theo BOM, nhập hàng và hủy hóa đơn trong mẫu phát sinh sau 29/07 đã cập nhật lô đúng.

## Danh sách 20 mã

| Mã hàng | Tồn chi nhánh | Tổng lô | Chênh lệch | Nguồn chính |
|---|---:|---:|---:|---|
| NVL-CPH-002 | 45.480 | 45.185 | +295 | IN000035 |
| NVL-BBI-006 | 93 | 45 | +48 | IN000030 |
| NVL-LTT-010 | 4.893 | 4.849 | +44 | IN000027 |
| NVL-LTT-012 | 3.531 | 3.562 | -31 | IN000027 |
| NVL-LTT-011 | 4.810 | 4.799 | +11 | IN000027 |
| NVL-CPH-004 | 1.008 | 1.015,5 | -7,5 | IN000028 |
| NVL-LTT-031 | 4.200 | 4.206 | -6 | IN000028 |
| NVL-VPP-015 | 6 | 10 | -4 | IN000032 |
| NVL-VPP-019 | 4 | 1 | +3 | IN000034 |
| NVL-SST-015 | 1,02 | 4,02 | -3 | SX000020 |
| NVL-LTT-009 | 8 | 6 | +2 | IN000034 |
| NVL-LTT-030 | 11 | 12 | -1 | IN000029 |
| NVL-LTT-017 | 11 | 10 | +1 | IN000031 |
| NVL-DCV-043 | 3 | 2 | +1 | IN000034 |
| NVL-LTT-028 | 14 | 13 | +1 | IN000029 |
| NVL-TRA-006 | 2 | 3 | -1 | IN000034 |
| NVL-SUA-002 | 660 | 661 | -1 | SX000020 |
| NVL-SST-016 | 15 | 14 | +1 | IN000034 |
| NVL-BOT-005 | 32 | 33 | -1 | Hoàn nhập PO000161 sau khi lô đã dùng một phần |
| NVL-SUA-001 | 745 | 746 | -1 | SX000020 |

## Hướng xử lý an toàn

1. Migration định nghĩa hàm: đồng bộ lô trong cùng giao dịch khi kiểm kê, sản xuất, hủy sản xuất, chuyển kho và hoàn nhập phiếu mua. Bước này không sửa dữ liệu lịch sử.
2. Chạy preflight chỉ đọc và sao lưu riêng bảng `product_lots` trước khi cân 20 dòng cũ.
3. Migration sửa lịch sử chỉ điều chỉnh `product_lots` và ghi `audit_log`; không sửa tồn, sổ kho hay chứng từ.
4. Chạy lại ba phép kiểm toàn vẹn. Chỉ chấp nhận khi cả ba cùng bằng 0.
5. UAT bằng chứng từ thử trên staging trước khi đưa định nghĩa hàm lên production.

## Phạm vi tuyệt đối không sửa khi cân lô

- `products.stock`
- `branch_stock`
- `stock_movements`
- hóa đơn, phiếu nhập, phiếu kiểm kê và lệnh sản xuất đã có
- giá vốn, công nợ và giao dịch tiền
