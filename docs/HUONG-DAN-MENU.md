# 🧭 Hướng dẫn cấu trúc Menu — OneBiz ERP

**Tài liệu này là CHUẨN cho mọi thay đổi menu sau này** (thêm trang mới, di chuyển, gộp/tách group). Đọc trước khi đụng vào `src/components/shared/nav-config.ts`.

**Phiên bản**: 03/06/2026 (CEO + Claude Opus 4.7).

---

## 🎯 Triết lý phân nhóm

Menu được tổ chức theo **2 trục chính**:

| Trục | Nội dung | Áp dụng cho |
|---|---|---|
| **A. Business Function** *(xương sống)* | Chức năng nghiệp vụ kế toán | Phân top-level group |
| **D. Frequency** *(xương phụ)* | Tần suất sử dụng | Sort item trong group |

→ Không phân theo User Role (cashier/kế toán) vì 1 user thường đa năng (CEO chuỗi vừa quản lý vừa xem báo cáo).

---

## 🌳 Decision Tree — khi thêm 1 trang mới

```
1. Trang này LÀM GÌ?
   ├─ Tạo / Xem giao dịch bán hàng → 🛒 Bán hàng
   ├─ Tạo / Xem giao dịch mua hàng → 📦 Mua hàng
   ├─ Quản lý tồn (đếm, chuyển, kiểm) → 🏪 Kho
   ├─ Sản xuất / BOM / Production Order → 🏭 Sản xuất
   ├─ Khai báo master data (SP, KH, NCC) → 🗂️ Danh mục
   ├─ Tiền vào / tiền ra / nợ → 💰 Tài chính
   ├─ Khuyến mãi / Loyalty / Marketing → 🎁 Khuyến mãi
   ├─ Đọc số liệu phân tích → 📊 Báo cáo
   ├─ AI / automation → 🤖 AI & Tự động
   └─ Cấu hình system / quyền hạn → ⚙️ Hệ thống

2. Có sinh DOANH THU hoặc CHI PHÍ KẾ TOÁN không?
   ├─ CÓ → group "Bán hàng" / "Mua hàng" / "Tài chính"
   └─ KHÔNG (chỉ chuyển động hàng) → group "Kho"

   Ví dụ:
   - "Bán nội bộ" có invoice + VAT → Bán hàng (sinh doanh thu)
   - "Chuyển kho" chỉ di chuyển hàng → Kho
   - "Xuất hủy" trừ tồn không có giá → Kho
   - "Xuất dùng nội bộ" giảm tồn + tăng chi phí → Kho (chi phí nội bộ, không invoice)

3. Frequency dùng?
   ├─ Hàng ngày (cashier, thủ kho) → ĐẦU group, có thể pin lên top-nav
   ├─ Tuần / sự kiện → GIỮA group
   └─ Tháng / quý → CUỐI group

4. Cross-cut (vào nhiều nơi)?
   ├─ Có (vd Khuyến mãi: cấu hình + báo cáo) → Item chính ở group "owner"
   │  + cross-link ở group khác (text link, không icon)
   └─ Không → chỉ 1 nơi
```

---

## 📐 Quy tắc cứng

### Quy tắc 1 — Mỗi group ≥ 3 items, ≤ 8 items

- < 3 items → gộp vào group khác hoặc rename group.
- > 8 items → chia subGroup theo "Action" vs "Report" hoặc theo workflow.

### Quy tắc 2 — Mỗi item chỉ ở 1 group "owner"

- Cross-link ở group khác phải là text link hoặc deep-link (không phải item chính).
- Tránh duplicate route (đã từng có `/don-hang/doi-tac-giao-hang` vs `/doi-tac/giao-hang` → cleanup).

### Quy tắc 3 — Naming convention

- Tên group: danh từ ngắn 1-2 từ ("Bán hàng", "Kho", "Tài chính").
- Tên item: action-oriented ("Hoá đơn", "Kiểm kho") HOẶC document-name ("Sổ quỹ", "Công nợ").
- Tránh viết tắt khó hiểu ("BC TC" → "Báo cáo tài chính").

### Quy tắc 4 — Sort theo Frequency trong group

```
Đầu group → Daily use   (vd Tồn kho, Hoá đơn)
Giữa     → Weekly       (vd Kiểm kho, Đặt hàng nhập)
Cuối     → Monthly/Rare (vd Xuất hủy, Audit log)
```

### Quy tắc 5 — Hệ thống pinBottom

- Group "Hệ thống" (Settings) luôn `pinBottom: true` — sticky đáy sidebar.
- AI & Tự động đang ở giữa — có thể move xuống đáy khi mature.

---

## 🗺️ Sơ đồ menu hiện tại (sau Sprint 3, 03/06/2026)

```
1. 📊 Tổng quan                    (2 items)
   ├─ Trang chủ
   └─ Cảnh báo

2. 🛒 Bán hàng                     (5 items)
   ├─ Hóa đơn
   ├─ Bán nội bộ chuỗi             ← intercompany (đã chuyển từ Kho)
   ├─ Đơn đặt hàng
   ├─ Trả hàng
   └─ Vận đơn

3. 🏪 Kho                          (7 items, flat sort by frequency)
   ├─ Tồn kho                      (daily)
   ├─ Lịch sử kho                  (daily)
   ├─ Kiểm kho                     (weekly)
   ├─ Hạn sử dụng                  (weekly)
   ├─ Chuyển kho                   (weekly)
   ├─ Xuất dùng nội bộ             (occasionally)
   └─ Xuất hủy                     (rare)

4. 📦 Mua hàng                     (4 items)
   ├─ Đặt hàng nhập
   ├─ Nhập hàng
   ├─ Trả hàng nhập
   └─ Hóa đơn đầu vào

5. 🏭 Sản xuất                     (4 items)
   ├─ Dashboard Sản xuất
   ├─ Lệnh sản xuất
   ├─ Công thức sản xuất (BOM)
   └─ Lô sản xuất

6. 🗂️ Danh mục                    (3 subGroups, 9 items)
   ├─ Sản phẩm (5)
   ├─ Khách hàng (2)
   └─ Nhà cung cấp (2)

7. 💰 Tài chính                   (2 subGroups, 6 items)
   ├─ Sổ sách & thu chi (2)        ← daily action
   │   ├─ Sổ quỹ
   │   └─ Công nợ
   └─ Báo cáo tài chính (4)        ← reports
       ├─ Phân tích tài chính
       ├─ Lưu chuyển tiền tệ
       ├─ Công nợ aging
       └─ VAT đầu vào / ra

8. 🎁 Khuyến mãi                  (3 items)
   ├─ Chương trình khuyến mãi
   ├─ Mã giảm giá
   └─ Báo cáo khuyến mãi

9. 🤖 AI & Tự động                (3 items)
   ├─ AI Agents
   ├─ KPI Breakdown
   └─ Task hàng ngày

10. 📊 Báo cáo                    (4 subGroups, ~22 items)
    ├─ Tổng quan (3)
    ├─ Bán hàng (~10)
    ├─ Hàng hoá & Kho (~10)
    └─ Đối tác (4)

11. ⚙️ Hệ thống (pinBottom)        (8 items)
    ├─ Cấp OTP
    ├─ Users
    ├─ Chi nhánh
    ├─ Bàn & Khu vực
    ├─ Thiết lập chung
    ├─ Tích hợp
    ├─ Audit log
    └─ Toàn vẹn kho
```

---

## 🔄 Thay đổi đã làm trong Sprint 3 + lý do

| # | Trước | Sau | Lý do |
|---|---|---|---|
| 1 | Bán nội bộ ở Kho | Bán nội bộ chuỗi ở Bán hàng | Sinh doanh thu (Q2 Decision Tree) |
| 2 | Route `/don-hang/doi-tac-giao-hang` riêng | Redirect → `/doi-tac/giao-hang` | Quy tắc 2 (no duplicate) |
| 3 | "Khuyến mãi" trong /cai-dat | Group riêng "Khuyến mãi" 3 items | Cross-cut quan trọng (Q1+Q4) |
| 4 | Tài chính 2 items + Báo cáo sub "Tài chính" 4 items | Tài chính 6 items chia 2 sub | Gộp cùng chủ đề (Q1) |
| 5 | Kho 8 items flat | Kho 7 items flat sort by frequency | Quy tắc 4 (Bán nội bộ rời sang Bán hàng) |

---

## ❓ Trường hợp lưỡng lự — em đã chốt thế nào?

### "Bán nội bộ" — Bán hàng hay Kho?
→ **Bán hàng**. Có invoice + VAT + status = sale thật. SAP/Odoo/Misa đều xếp ở module Sales. Kế toán cần hợp nhất P&L chuỗi → ở chung Hoá đơn.

### "Tài chính" — flat 6 hay chia sub?
→ **Chia sub**. 6 items mixed Action (Sổ quỹ, Công nợ — daily) với Report (Aging, Phân tích, VAT — monthly) → mental model khác nhau. Sub "Sổ sách & thu chi" vs "Báo cáo tài chính" phân định rõ.

### "Kho" — chia sub hay flat?
→ **Flat 7 items**. ≤ 8 items vẫn fit, không cần expand thêm 1 lần click. Sort theo frequency là đủ.

### "Khuyến mãi" — group riêng hay item trong Bán hàng?
→ **Group riêng**. CEO chuỗi cà phê chạy promo theo tháng/quán → cần dễ thấy. KiotViet/Sapo/MISA đều có module Marketing riêng.

### "Cài đặt /cai-dat/*" — 18 trang ở đâu?
→ **Phase sau**: tạo subGroup trong "Hệ thống" hoặc khi cần. Hiện chưa khẩn cấp vì admin/owner ít vào.

---

## 🚧 Khi nào KHÔNG làm gì?

- Thêm 1 trang vào group đã có ≥ 6 items → cân nhắc tách sub trước khi add.
- Group mới chỉ có 1-2 items → KHÔNG tạo group, gộp vào group gần nhất.
- Item dùng cực ít (audit log, integrations) → bỏ vào "Hệ thống".

---

## 📋 Checklist trước khi merge thay đổi menu

- [ ] Đã chạy qua Decision Tree?
- [ ] Tên group ≤ 2 từ + danh từ?
- [ ] Group nguồn vẫn ≥ 3 items?
- [ ] Group đích ≤ 8 items?
- [ ] Sort theo frequency trong group?
- [ ] Cross-link cho item liên quan?
- [ ] Test mobile bottom-nav active state đúng?
- [ ] Update file này nếu rule mới?

---

**Tài liệu liên quan**:
- `src/components/shared/nav-config.ts` — config thực tế.
- `src/components/shared/mobile-bottom-nav.tsx` — bottom nav 5 tabs.
- `src/components/shared/app-sidebar.tsx` — render sidebar V2.
