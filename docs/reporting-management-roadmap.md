# Ke hoach bao cao quan tri

Cap nhat: 2026-10-18. Khong sua so lieu kinh doanh de khop mau tham khao.

| Dot | Pham vi | Trang thai |
| --- | --- | --- |
| 1 | Dashboard, tong quan, chi tieu chung, bang chung, pham vi chi nhanh | Da phat hanh PR675/676 |
| 2 | Ket qua kinh doanh: UX, ky doi chieu, realtime, gia von thieu, Excel | Da phat hanh PR677/678, da nghiem thu production |
| 3 | Hieu qua ban hang: SKU, khach hang, chi nhanh, ban/tra/giam gia/gia von | Dang lam SKU so sanh hai ky, viec can xem, loc/sort/Excel va an toan bao cao khach |
| 4 | Su dung von: ton kho, cong no, tien; tach so du va phat sinh | Chua trien khai thiet ke moi |
| 5 | Nghiem thu lien bao cao: filter, sort, file, mobile, phan quyen | Nghiem thu tung dot; chua chot toan bo |

## Nguyen tac

- Mot nguon chi tieu cho dashboard, bao cao va Excel.
- Tong cong ty loai noi bo; tung chi nhanh van hien phat sinh noi bo.
- Doanh thu, loi nhuan, thu chi, tien ung va so du khong tron nghia.
- Thieu gia von lich su phai canh bao, khong thay bang gia hien tai hoac 0.
- Nhan dinh phai co can cu va link dung pham vi; khong tu ket luan nguyen nhan.
- Khong sua kho/BOM, POS, Hub hay giao dich that trong dot bao cao.
- Chi danh dau da phat hanh sau CI va kiem tra production. Khong goi ca ke hoach la xong khi con dot chua nghiem thu.

## Nghiem thu dot 2

- [x] Ket qua va viec can xem o dau trang, cau chu ngan.
- [x] So lieu khop dashboard o cung ky/pham vi, gom toan cong ty va F&B.
- [x] Ky truoc bang 0 hien Phat sinh moi, khong tu ghi tang 100%.
- [x] Doi chi nhanh/ky khong hien hoac xuat so lieu pham vi cu.
- [x] Realtime coalescing, khong loai bo lien tuc ket qua dang tai.
- [x] Excel giu phan le, pham vi, ky so sanh, tinh trang gia von.
- [x] Desktop/mobile, CI, build, PostgreSQL va production PR677 dat.
- [x] Guard bien lai khong co ky co so: CI va production PR678 dat.

## Pham vi dot 3 hien tai

- SKU: lay ca hai ky; giu mat hang chi ban ky truoc; nhan dien giam doanh thu, lai gop am, hang tra va thieu gia von.
- Loc/sort va Excel cung tap dong. Ma hang giu co dinh; so luong khong cong nhieu DVT.
- Khach hang: chan du lieu pham vi cu, realtime, xuat dung khach dang tim, tong nhom tach DVT; noi sang lai gop SKU theo khach.
- Bao cao khach hien co la doanh so dong hang, chua phai lai gop khach hang. Khong tu doi ten chi tieu thanh doanh thu thuan.
- Chua chot: bang lai gop tat ca khach hang cung luc, phan tich dong gop chi nhanh nang cao va su dung von. Khong tao N truy van theo tung khach de gia lap tong hop.
