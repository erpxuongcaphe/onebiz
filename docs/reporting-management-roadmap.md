# Ke hoach bao cao quan tri

Cap nhat: 2026-10-18. Khong sua so lieu kinh doanh de khop mau tham khao.

| Dot | Pham vi | Trang thai |
| --- | --- | --- |
| 1 | Dashboard, tong quan, chi tieu chung, bang chung, pham vi chi nhanh | Da phat hanh PR675/676 |
| 2 | Ket qua kinh doanh: UX, ky doi chieu, realtime, gia von thieu, Excel | Da phat hanh PR677/678, da nghiem thu production |
| 3 | Hieu qua ban hang: SKU, khach hang, chi nhanh, ban/tra/giam gia/gia von | PR679/680/683/684 da phat hanh; dang bo sung doi chieu chi nhanh hai ky va ngu canh hang khong thu phi |
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
- Nghiem thu production thay tong hoa don va doanh thu dong hang co the chenh. Hien hai nguon va so chenh de doi chieu, khong tu bu/sua giao dich; nguyen nhan chua du bang chung thi giu trang thai chua phan loai.

## Bo sung dieu khien day du dot 3

- Chi nhanh: 14 cot tu nguon P&L hien co, loc ten/loai/ket qua va nhieu khoang chi tieu; sort tung cot, tong theo bo loc, ty trong tren toan pham vi, link xuong bao cao chi nhanh.
- SKU: loc ket hop tat ca chi tieu so, gom ca ky truoc va so chenh; ho tro so am, so le va loc rieng chua du du lieu. Dieu kien SKU duoc giu tren URL.
- Excel day du khong ap dung an cot; Excel theo man hinh dung tuy chon cot. Cung tap dong va thu tu da loc/sort, co dieu kien trong dau file. Khong gioi han o trang dang xem.
- Khong them migration, khong thay cong thuc RPC, khong sua chung tu hay quyen.
- Con lai: bang lai gop tong hop khach hang can nguon tong hop chuan; dong gop chi nhanh theo ky truoc; truy nguyen chenh lech tong hoa don/dong hang; dot su dung von va nghiem thu lien bao cao.

## Doi chieu hai ky va ngu canh chi phi

- Lay P&L chi nhanh ky truoc qua RPC doc hien co, cung khoang so ngay va quyen truy cap; khong tao truy van theo tung chi nhanh.
- Them doanh thu, gia von, lai gop, ket qua va so dong thieu gia von ky truoc; chenhlech doanh thu/ket qua duoc loc, sort va xuat Excel cung tap dong. Tong hai ky cung tap chi nhanh da loc.
- Giu chi nhanh chi co ky truoc, khong de mat phan doanh thu ngung phat sinh. Thieu gia von ky truoc thi khong ket luan chenhlech ket qua.
- Ly Mang Ve duoc nguoi dung xac nhan khong tinh phi. Nhom hang doanh thu 0 co gia von duoc hien rieng theo so lieu, khong mac dinh la loi va khong an chi phi khoi tong. Khong hardcode ma SKU de bo qua canh bao.
- Chua hoan tat: tong hop lai gop khach hang, truy nguyen chenh lech hoa don/dong hang, su dung von va nghiem thu lien bao cao.

## Phan cap giao dien bao cao

- Ket qua kinh doanh va SKU: dung dai tieu de co phan tach ro, khong boc tung phan trong card noi; tieu de cap 2 co ten vung doc bang ban phim.
- Mau xanh nhe cho ket qua/doi chieu, trung tinh cho phan tich, vang chi khi co can cu can kiem tra. Du gia von khong hien nhu canh bao thieu gia von.
- Nhom cot chi nhanh: danh tinh, ky dang xem, doi chieu ky truoc. Nhom cot SKU: mat hang, ban/tra, doi chieu doanh thu, gia von/lai gop, kiem soat.
- Web va Excel dung chung nhom cot. An cot phai cap nhat dung so cot trong tung nhom; full van giu tat ca chi tieu va dong da loc/sort.
- Dot nay chi doi cach trinh bay, khong thay du lieu, cong thuc, RPC, quyen hay luong van hanh.
