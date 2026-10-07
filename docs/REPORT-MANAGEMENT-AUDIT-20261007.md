# Danh gia bao cao tu goc nhin quan tri - 07/10/2026

## Ket luan

Chua du bang chung de nghiem thu toan bo trung tam bao cao. He thong co do phu
rong va nhieu bang chi tiet, nhung do tin cay khi tai loi, kha nang truy ve chung
tu va hop dong xuat Excel chua dong deu. Khong danh dong co bang voi so lieu da
doi soat. Khong cham ton dau ky, chung tu, cong no hay quy trinh Retail.

Pham vi: doc 36 route trong thu muc phan-tich (bao gom trung tam), danh muc bao
cao, bang dung chung, dich vu tai chinh, cac test hop dong va audit truoc.
Quet tu khoa chi dung tim diem can doc, KHONG chung minh tinh nang co/khong co.
Phien trinh duyet chuyen ve dang nhap khi mo bao cao Kho Tong; doi soat so that
trong dot nay chua thuc hien duoc. Khong tu gan diem chat luong so lieu.

## Chuan quan tri

- Doanh thu, tien thu, tien coc, cong no va thu nhap khac la cac chi tieu rieng.
- Gia von va chi phi ghi nhan khac voi tien chi; mua hang khong tu dong la chi
  phi van hanh. Hoan tien khong duoc dem lai thanh chi phi.
- Moi so co ky, chi nhanh, ngay ghi nhan, doi tuong va nguon chung tu ro rang.
- Bang chi tiet co ma, ten, don vi, so luong va gia tri phu hop nghiep vu.
- Tong hop -> doi tuong -> chung tu giu cung pham vi ngay/chi nhanh.
- Sap xep truoc phan trang, Excel theo cung bo loc/thu tu va toan bo ket qua.
- Loi tai, rong hop le va thieu gia von la ba trang thai khac nhau.
- Kho Retail theo NVL; SKU Retail la lich su ban; kho F&B giu SKU dau vao/BTP.
- Khong goi bao cao quan tri la bao cao tai chinh phap dinh.

## Danh gia theo nhom

| Nhom | Kha nang hien co | Khoang thieu / dieu kien nghiem thu |
| --- | --- | --- |
| Dieu hanh, cuoi ngay, doi chieu ca | KPI, ky, chi nhanh, doi chieu ca | Chung minh doanh thu rong va thu/hoan khop chung tu; ca khac ngay hoan khong gan nguoc tuy tien |
| Ban hang, tra hang | Bang hoa don, tim kiem, tra hang | Kiem toan bo cac trang; ngay chung tu, VAT, chiet khau, huy/tra va tong KPI phai khop |
| Hang hoa, khach hang, khach x san pham | Tim, loc nhom/don vi, thu tu va bang chi tiet | Bo sung duong sang hoa don cung pham vi; khong cong so luong khac DVT; gia von/loi nhuan theo nguon duoc xac minh |
| Dat hang | KPI, co cau trang thai, san pham, don gan day | Dang goi getRecentOrders(10); day khong phai so chi tiet day du. Can phan trang va bo loc. Mot dat hang co nhieu hoa don; co hoa don khong dong nghia da hoan tat |
| Kenh, khuyen mai, nhan vien | Bang tong hop va bieu do | Can loc doi tuong va truy hoa don; doi soat viec phan bo giam gia/hoan tra, khong cong trung |
| XNT, lo, tuoi ton, kiem ke, chenh lech, ton that | Bang kho, nhieu goc nhin va canh bao gia | Doi soat dau + nhap - xuat = cuoi theo tung ma/chi nhanh. Thieu snapshot khong suy dien gia hien tai. Phan ton dau ky do chat khac phu trach |
| NCC | Tong hop va phieu nhap chi tiet | Xuong thanh toan/ung truoc; phan biet no hien tai va no tai cuoi ky, doi soat ngay phieu nhap |
| KQKD, phan tich tai chinh | KQKD co nhieu bang; phan tich tai chinh con nghieng bieu do | Sua loi tai bi nuot va Excel bao thanh cong som; them bang doanh thu/gia von/chi phi/loi nhuan theo ky |
| Dong tien | Bang thu/chi va phan loai | Doi soat phieu goc, chot ngay thu/chi khac ngay ghi nhan, so du dau/cuoi. Khoan coc khong thanh doanh thu |
| Cong no/tuoi no | Bao cao doi tac va nhom tuoi | Phai ro snapshot hien tai hay cuoi ky; tach ung truoc/can tru va xuong chung tu |
| VAT | Bang thu dau vao/dau ra | Khop ngay va trang thai chung tu, hoa don tra/huy; khong chung nhan bao cao thue phap dinh |
| F&B, shipper, modifier, thoi gian phuc vu | Bang van hanh va hoa don | Tach so lieu bep voi doanh thu hoa don; tra mot phan, mang ve, ban mien phi va BOM snapshot |
| Tieu hao, gia von BOM | Bang nguyen lieu/gia von | Dinh luong vs tieu hao that; gia BTP chi nhanh vs gia uoc tinh cong thuc; khong dung gia von Retail cho nhap F&B |
| ABC/RFM/cohort | Phan tich phan khuc | Can danh sach cau thanh nhom va hoa don nguon. Khong coi nhom phan tich la so chung tu |

## Phat hien cu the

1. P1: tai-chinh/page.tsx catch chi log, giu du lieu ky cu; exportDisabled chi
   kiem loading. Co the xuat du lieu cu/0 sau khi doi pham vi ma tai that bai.
2. P1: hai handler Excel tai-chinh khong await ham async, thong bao thanh cong
   truoc khi file hoan tat, khong co trang thai busy.
3. P2: tai-chinh khai bao defaultViewMode chart nhung khong noi nut chuyen view;
   khong co bang doanh thu/gia von/chi phi theo ky de giai thich KPI.
4. P1 can sua tiep: dat-hang chi lay 10 don gan day, catch chi log; chua du de
   quan tri backlog. Khong sua logic mot dat hang -> nhieu hoa don trong dot nay.
5. Cac route co hop dong xuat/tai loi khac nhau. Can test hanh vi tung route,
   khong thay hang loat catch hay cap quyen de lam hien du lieu.
6. P1: get_finance_dashboard_report (00258) goi P&L cu; 00439 chi noi so ghi
   nhan quan tri vao get_profit_and_loss_report_v2 va bao cao chi nhanh V2.
   analytics.ts cung tinh profit tu revenue - cogs - operating_expense, khong
   co other_income. Can doc dinh nghia dang chay va doi soat hai man truoc khi
   coi Phan tich tai chinh la KQKD day du. Ban sua UI nay khong khang dinh da
   sua hop dong nay; khong tu doi cong thuc tren nguon chua xac minh.

## Ban sua dot nay

- Phan tich tai chinh mac dinh bang, co chuyen bieu do/bang qua URL hien co.
- Bang theo ky: doanh thu thuan, gia von, chi phi van hanh, tong chi phi, loi
  nhuan; tong cot, so can phai, tabular nums, chon cot va phan trang dung chung.
- Thu tu bang so lieu va sheet theo ky trong Excel dang xem dung cung visibleTrend.
- Khi tai loi xoa ket qua cu, hien loi + Thu lai, khoa xuat. Không hien 0 gia.
- Hai che do xuat cho await, bao thanh cong sau khi xong, chan bam lap.
- Khong migration, khong ghi du lieu kinh doanh, khong doi cong thuc tai chinh.

## Thu tu tiep theo va dieu kien hoan tat

1. Tin cay: test tai thanh cong/loi/doi nhanh ky/quyen, Excel loi/nhieu trang.
2. Doi soat Kho Tong: 1 ky co du lieu va 1 ky co tra/huy; KPI = tong bang =
   Excel, truy nguon hoa don/phieu nhap/phieu tien. Chua xac minh thi ghi ro.
3. Dat hang va drill-down: phan trang that, trang thai da xu ly co dong chu dong,
   lien ket nhieu hoa don; khong suy ra dong don chi bang tong tien hoa don.
4. Khach/hang/kenh/NCC: chi tiet chung tu, loc phu hop va sap xep toan cuc.
5. Van hanh/F&B: doi soat BOM, BTP, tra hang, ca va mang ve theo snapshot.
6. Moi dot CI, PostgreSQL neu doi RPC, preview, merge dung commit, production
   READY va QC. Khong tu nhan nghiem thu toan bo chi vi CI xanh.

## Tham chieu

- KiotViet, bao cao: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-bao-cao/bao-cao/
- KiotViet, khach hang: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/huong-dan-bao-cao/bao-cao-khach-hang/
- MISA, KQKD chi tiet khoan muc/chi nhanh: https://help.amis.vn/v2/amis_act_bo_sung_bao_cao_ket_qua_kinh_doanh_theo_khoan_muc_chi_phi_chi_tiet_theo_tung_chi_nhanh.htm

Dung lam chuan ve chieu phan tich va doi soat, khong sao chep giao dien, khong
khuyen nghi bien OneBiz thanh phan mem ke toan tong hop.
