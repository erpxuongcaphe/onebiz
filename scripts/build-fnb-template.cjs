/**
 * Build Excel master template "FNB-SETUP-MASTER.xlsx"
 *
 * CEO 03/06/2026 — Sprint 4: file Excel duy nhất 6 sheet để CEO import setup
 * FnB. Có data mẫu 10 món phổ biến để CEO học cách điền + tự thay sau.
 *
 * Sheets:
 *   1. Hướng dẫn       — đọc trước, workflow + lưu ý
 *   2. Nhóm hàng FnB   — categories scope=sku channel=fnb
 *   3. Modifier        — note: import qua UI form, Excel không support
 *   4. NVL FnB         — products productType=nvl
 *   5. SKU món FnB     — products productType=sku channel=fnb
 *   6. BOM             — công thức cho 10 món mẫu
 *
 * Chạy: node scripts/build-fnb-template.cjs
 * Output: docs/FNB-SETUP-MASTER.xlsx
 */

const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

// ────────────────────────────────────────────────────────────────
// Sheet 1: HƯỚNG DẪN
// ────────────────────────────────────────────────────────────────
const huongDanRows = [
  ["FILE EXCEL MẪU SETUP FNB — Hướng dẫn nhanh"],
  [""],
  ["CEO 03/06/2026 — File này dùng để import data FnB hàng loạt cho OneBiz ERP."],
  [""],
  ["📋 THỨ TỰ LÀM (LÀM ĐÚNG THỨ TỰ):"],
  [""],
  ["Bước 1: Nhóm hàng FnB", "Sheet 2 — Tạo nhóm để gắn món vào (vd 'Cà phê pha máy', 'Trà sữa')"],
  ["Bước 2: Modifier", "Sheet 3 — TẠO TRÊN WEB, không qua Excel. Vào /hang-hoa/tuy-chon-fnb"],
  ["Bước 3: NVL FnB", "Sheet 4 — Tạo nguyên vật liệu pha chế (sữa, đường, syrup, trân châu...)"],
  ["Bước 4: SKU món FnB", "Sheet 5 — Tạo các món bán (Bạc xỉu, Cà phê sữa...). LƯU Ý: phải có Nhóm + NVL tạo trước"],
  ["Bước 5: BOM (Công thức)", "Sheet 6 — Khai công thức pha chế: món A = NVL X qty + NVL Y qty"],
  [""],
  ["📤 CÁCH IMPORT:"],
  [""],
  ["Sheet 2 (Nhóm):", "Vào /hang-hoa/nhom → bấm 'Nhập từ Excel' → chọn file → check preview → Lưu"],
  ["Sheet 4+5 (SP):", "Vào /hang-hoa → bấm 'Nhập từ Excel' → chọn file → check preview → Lưu"],
  ["Sheet 6 (BOM):", "Vào /hang-hoa/cong-thuc → bấm 'Nhập từ Excel' → chọn file → check preview → Lưu"],
  [""],
  ["⚠️ LƯU Ý QUAN TRỌNG:"],
  [""],
  ["1. Mã (code) phải DUY NHẤT trong tenant — không trùng SP đã có"],
  ["2. Mã nhóm phải tồn tại trước khi tạo SP (làm Bước 1 trước)"],
  ["3. NVL phải tồn tại trước khi tạo BOM (làm Bước 3 trước Bước 5)"],
  ["4. Modifier KHÔNG có Excel — phải tạo qua UI ở /hang-hoa/tuy-chon-fnb"],
  ["5. Một dòng = một bản ghi. Đừng ghép nhiều thông tin vào 1 dòng"],
  ["6. ĐVT (đơn vị tính) ở BOM có thể KHÁC đơn vị chính của NVL (vd NVL theo kg, BOM theo g)"],
  [""],
  ["💡 10 MÓN MẪU SẴN — anh xem để biết cách điền, có thể XOÁ rồi thay menu thật của anh."],
  [""],
  ["📞 Hỏi gì → báo Claude Opus 4.7 (Assistant)."],
];

// ────────────────────────────────────────────────────────────────
// Sheet 2: NHÓM HÀNG FNB
// ────────────────────────────────────────────────────────────────
// Schema: scope, name, code, channel, sortOrder, modifierGroupsCsv
const nhomHangRows = [
  ["Loại", "Tên nhóm", "Mã nhóm", "Kênh bán", "Thứ tự", "Nhóm tuỳ chọn FnB (CSV)"],
  ["sku", "Cà phê pha máy", "CFM", "fnb", 1, "Mức đường, Mức đá"],
  ["sku", "Cà phê pha phin", "CFP", "fnb", 2, "Mức đường, Mức đá"],
  ["sku", "Trà sữa", "TS", "fnb", 3, "Mức đường, Mức đá, Topping"],
  ["sku", "Trà các loại", "TR", "fnb", 4, "Mức đường, Mức đá"],
  ["sku", "Đá xay", "DX", "fnb", 5, "Mức đường, Topping"],
  ["sku", "Sinh tố", "ST", "fnb", 6, "Mức đường"],
  ["sku", "Nước ép trái cây", "NE", "fnb", 7, "Mức đường, Mức đá"],
  ["sku", "Bánh ngọt + Bánh mặn", "BN", "fnb", 8, ""],
  ["sku", "Topping (bán riêng)", "TO", "fnb", 9, ""],
  ["sku", "Combo set", "CB", "fnb", 10, ""],
];

// ────────────────────────────────────────────────────────────────
// Sheet 3: MODIFIER (note: Excel KHÔNG support — chỉ guide)
// ────────────────────────────────────────────────────────────────
const modifierRows = [
  ["⚠️ MODIFIER KHÔNG IMPORT QUA EXCEL — phải tạo qua UI form."],
  [""],
  ["📍 Đường dẫn: /hang-hoa/tuy-chon-fnb"],
  [""],
  ["💡 Có sẵn nút 'Tạo bộ tuỳ chọn mẫu' — bấm 1 lần tạo 4 nhóm sau:"],
  [""],
  ["NHÓM 1: Mức đường", "Single choice", "Options: Không đường (×0), Ít đường (×0.5), 70% đường (×0.7), Bình thường (×1), Đường nhiều (×1.3)"],
  ["NHÓM 2: Mức đá", "Single choice", "Options: Không đá, Ít đá, Bình thường, Nhiều đá"],
  ["NHÓM 3: Topping", "Multi choice", "Options: Trân châu đen, Trân châu trắng, Thạch dừa, Pudding, Whip cream — mỗi cái có giá riêng + linked NVL"],
  ["NHÓM 4: Size", "Single choice", "Options: S (Nhỏ), M (Vừa), L (Lớn) — không scale (chỉ là thẻ ghi)"],
  [""],
  ["🎯 Sau khi có nhóm modifier:"],
  [""],
  ["• Gán nhóm vào CATEGORY (Nhóm hàng FnB) — toàn bộ SP trong nhóm tự thừa kế (Toast pattern)"],
  ["• HOẶC gán riêng cho từng SP — override category"],
  [""],
  ["• 'Mức đường' phải gắn vào BOM item Đường (cột Scale theo modifier) để POS scale auto"],
  ["• 'Topping' option có 'linked NVL' → khi cashier chọn → tự trừ tồn NVL topping"],
];

// ────────────────────────────────────────────────────────────────
// Sheet 4: NVL FNB
// ────────────────────────────────────────────────────────────────
// Schema: code, name, productType, channel, categoryCode, unit, bulkUnit, bulkFactor, sellPrice, costPrice, stock
// NVL: productType="nvl", channel để trống, sellPrice=0
const nvlRows = [
  ["Mã SP", "Tên sản phẩm", "Loại", "Kênh bán", "Mã nhóm", "ĐVT", "Đóng gói", "Hệ số quy đổi", "Giá bán", "Giá vốn", "Tồn ban đầu", "Tồn tối thiểu", "Mô tả"],
  // 15 NVL phổ biến cho FnB Việt
  ["NVL-CPH-001", "Cà phê rang xay Robusta", "nvl", "", "CFE", "g", "kg", 1000, 0, 200, 5000, 500, "Rang xay tại Kho Tổng — pha máy"],
  ["NVL-CPH-002", "Cà phê rang xay Arabica", "nvl", "", "CFE", "g", "kg", 1000, 0, 380, 2000, 300, "Arabica chua nhẹ — pha phin"],
  ["NVL-SUA-001", "Sữa đặc Ông Thọ (chiết từ lon)", "nvl", "", "SUA", "ml", "lon", 380, 0, 80, 10000, 1000, "Mở lon, đong vào pha chế"],
  ["NVL-SUA-002", "Sữa tươi Vinamilk có đường", "nvl", "", "SUA", "ml", "lít", 1000, 0, 35, 20000, 2000, "Carton 1L"],
  ["NVL-SUA-003", "Sữa tươi không đường", "nvl", "", "SUA", "ml", "lít", 1000, 0, 40, 15000, 1500, "Carton 1L"],
  ["NVL-DUO-001", "Đường cát trắng", "nvl", "", "DUO", "g", "kg", 1000, 0, 25, 10000, 1000, "Pha chế chung"],
  ["NVL-DUO-002", "Đường nâu", "nvl", "", "DUO", "g", "kg", 1000, 0, 45, 5000, 500, "Cho trà sữa premium"],
  ["NVL-SYR-001", "Syrup Caramel", "nvl", "", "SYR", "ml", "chai", 750, 0, 200, 3000, 300, "Monin"],
  ["NVL-SYR-002", "Syrup Vanilla", "nvl", "", "SYR", "ml", "chai", 750, 0, 200, 3000, 300, "Monin"],
  ["NVL-TRC-001", "Trân châu đen", "nvl", "", "TPV", "g", "kg", 1000, 0, 65, 5000, 500, "Trân châu Đài Loan"],
  ["NVL-TRC-002", "Trân châu trắng", "nvl", "", "TPV", "g", "kg", 1000, 0, 75, 3000, 300, ""],
  ["NVL-TPV-001", "Thạch dừa", "nvl", "", "TPV", "g", "kg", 1000, 0, 55, 3000, 300, ""],
  ["NVL-TPV-002", "Pudding trứng", "nvl", "", "TPV", "g", "kg", 1000, 0, 90, 2000, 200, ""],
  ["NVL-DAC-001", "Đá cục", "nvl", "", "DAC", "g", "kg", 1000, 0, 5, 50000, 5000, "Đá tinh khiết"],
  ["NVL-COC-001", "Ly nhựa M (300ml) + nắp + ống hút", "nvl", "", "BAO", "bộ", "", 0, 0, 1200, 2000, 200, ""],
];

// ────────────────────────────────────────────────────────────────
// Sheet 5: SKU MÓN FNB (10 món mẫu)
// ────────────────────────────────────────────────────────────────
const skuMonRows = [
  ["Mã SP", "Tên sản phẩm", "Loại", "Kênh bán", "Mã nhóm", "ĐVT", "Mã BOM", "Giá bán", "Giá vốn", "VAT %", "Mô tả"],
  // 10 món mẫu — anh thay được
  ["SKU-FNB-001", "Cà phê đen đá", "sku", "fnb", "CFM", "ly", "BOM-CDD-001", 25000, 0, 0, "Cà phê pha máy + đá"],
  ["SKU-FNB-002", "Cà phê sữa đá", "sku", "fnb", "CFM", "ly", "BOM-CSD-001", 30000, 0, 0, "Cà phê + sữa đặc + đá"],
  ["SKU-FNB-003", "Bạc xỉu nóng", "sku", "fnb", "CFM", "ly", "BOM-BXN-001", 35000, 0, 0, "Cà phê ít + sữa nhiều"],
  ["SKU-FNB-004", "Cà phê sữa nóng", "sku", "fnb", "CFP", "ly", "BOM-CSN-001", 30000, 0, 0, "Cà phê pha phin truyền thống"],
  ["SKU-FNB-005", "Trà sữa trân châu", "sku", "fnb", "TS", "ly", "BOM-TST-001", 35000, 0, 0, "Trà sữa + trân châu đen"],
  ["SKU-FNB-006", "Trà sữa thạch dừa", "sku", "fnb", "TS", "ly", "BOM-TSD-001", 38000, 0, 0, "Trà sữa + thạch dừa"],
  ["SKU-FNB-007", "Trà đào cam sả", "sku", "fnb", "TR", "ly", "BOM-TDS-001", 40000, 0, 0, "Mùa hè"],
  ["SKU-FNB-008", "Đá xay socola", "sku", "fnb", "DX", "ly", "BOM-DXS-001", 45000, 0, 0, "Frappuccino style"],
  ["SKU-FNB-009", "Sinh tố bơ", "sku", "fnb", "ST", "ly", "BOM-STB-001", 45000, 0, 0, "Bơ + sữa + đường"],
  ["SKU-FNB-010", "Caramel Macchiato", "sku", "fnb", "CFM", "ly", "BOM-CMA-001", 50000, 0, 0, "Cà phê + syrup caramel + sữa"],
];

// ────────────────────────────────────────────────────────────────
// Sheet 6: BOM CHO 10 MÓN
// ────────────────────────────────────────────────────────────────
// Schema: bomCode, bomName, branchCode, materialCode, quantity, unit, yieldQty, yieldUnit, note, modifierScaleTargetName
const bomRows = [
  ["Mã BOM", "Tên BOM", "Mã chi nhánh", "Mã NVL", "Số lượng", "ĐVT", "Năng suất", "ĐVT năng suất", "Ghi chú", "Scale theo modifier (Tên nhóm)"],
  // BOM-CDD-001: Cà phê đen đá
  ["BOM-CDD-001", "Cà phê đen đá", "", "NVL-CPH-001", 18, "g", 1, "ly", "Cà phê Robusta", ""],
  ["BOM-CDD-001", "Cà phê đen đá", "", "NVL-DUO-001", 10, "g", 1, "ly", "Đường — scale theo modifier", "Mức đường"],
  ["BOM-CDD-001", "Cà phê đen đá", "", "NVL-DAC-001", 100, "g", 1, "ly", "Đá — scale theo modifier", "Mức đá"],
  ["BOM-CDD-001", "Cà phê đen đá", "", "NVL-COC-001", 1, "bộ", 1, "ly", "Ly + nắp + ống hút", ""],
  // BOM-CSD-001: Cà phê sữa đá
  ["BOM-CSD-001", "Cà phê sữa đá", "", "NVL-CPH-001", 18, "g", 1, "ly", "", ""],
  ["BOM-CSD-001", "Cà phê sữa đá", "", "NVL-SUA-001", 25, "ml", 1, "ly", "Sữa đặc", ""],
  ["BOM-CSD-001", "Cà phê sữa đá", "", "NVL-DUO-001", 5, "g", 1, "ly", "Đường thêm — scale", "Mức đường"],
  ["BOM-CSD-001", "Cà phê sữa đá", "", "NVL-DAC-001", 100, "g", 1, "ly", "", "Mức đá"],
  ["BOM-CSD-001", "Cà phê sữa đá", "", "NVL-COC-001", 1, "bộ", 1, "ly", "", ""],
  // BOM-BXN-001: Bạc xỉu nóng
  ["BOM-BXN-001", "Bạc xỉu nóng", "", "NVL-CPH-001", 12, "g", 1, "ly", "Ít cà phê", ""],
  ["BOM-BXN-001", "Bạc xỉu nóng", "", "NVL-SUA-001", 40, "ml", 1, "ly", "Sữa nhiều", ""],
  ["BOM-BXN-001", "Bạc xỉu nóng", "", "NVL-DUO-001", 5, "g", 1, "ly", "", "Mức đường"],
  // BOM-CSN-001: Cà phê sữa nóng
  ["BOM-CSN-001", "Cà phê sữa nóng", "", "NVL-CPH-002", 20, "g", 1, "ly", "Arabica pha phin", ""],
  ["BOM-CSN-001", "Cà phê sữa nóng", "", "NVL-SUA-001", 25, "ml", 1, "ly", "", ""],
  ["BOM-CSN-001", "Cà phê sữa nóng", "", "NVL-DUO-001", 5, "g", 1, "ly", "", "Mức đường"],
  // BOM-TST-001: Trà sữa trân châu
  ["BOM-TST-001", "Trà sữa trân châu", "", "NVL-SUA-002", 200, "ml", 1, "ly", "Sữa tươi có đường", ""],
  ["BOM-TST-001", "Trà sữa trân châu", "", "NVL-DUO-001", 15, "g", 1, "ly", "Đường thêm — scale", "Mức đường"],
  ["BOM-TST-001", "Trà sữa trân châu", "", "NVL-TRC-001", 50, "g", 1, "ly", "Trân châu đen — base", ""],
  ["BOM-TST-001", "Trà sữa trân châu", "", "NVL-DAC-001", 80, "g", 1, "ly", "", "Mức đá"],
  ["BOM-TST-001", "Trà sữa trân châu", "", "NVL-COC-001", 1, "bộ", 1, "ly", "", ""],
  // BOM-TSD-001: Trà sữa thạch dừa
  ["BOM-TSD-001", "Trà sữa thạch dừa", "", "NVL-SUA-002", 200, "ml", 1, "ly", "", ""],
  ["BOM-TSD-001", "Trà sữa thạch dừa", "", "NVL-DUO-001", 15, "g", 1, "ly", "", "Mức đường"],
  ["BOM-TSD-001", "Trà sữa thạch dừa", "", "NVL-TPV-001", 50, "g", 1, "ly", "Thạch dừa — base", ""],
  ["BOM-TSD-001", "Trà sữa thạch dừa", "", "NVL-DAC-001", 80, "g", 1, "ly", "", "Mức đá"],
  // BOM-TDS-001: Trà đào cam sả
  ["BOM-TDS-001", "Trà đào cam sả", "", "NVL-DUO-001", 20, "g", 1, "ly", "", "Mức đường"],
  ["BOM-TDS-001", "Trà đào cam sả", "", "NVL-DAC-001", 100, "g", 1, "ly", "", "Mức đá"],
  // BOM-DXS-001: Đá xay socola
  ["BOM-DXS-001", "Đá xay socola", "", "NVL-SUA-003", 150, "ml", 1, "ly", "Sữa không đường", ""],
  ["BOM-DXS-001", "Đá xay socola", "", "NVL-DUO-001", 20, "g", 1, "ly", "", "Mức đường"],
  ["BOM-DXS-001", "Đá xay socola", "", "NVL-DAC-001", 150, "g", 1, "ly", "Đá xay nhuyễn", ""],
  // BOM-STB-001: Sinh tố bơ
  ["BOM-STB-001", "Sinh tố bơ", "", "NVL-SUA-002", 150, "ml", 1, "ly", "", ""],
  ["BOM-STB-001", "Sinh tố bơ", "", "NVL-DUO-001", 15, "g", 1, "ly", "", "Mức đường"],
  ["BOM-STB-001", "Sinh tố bơ", "", "NVL-DAC-001", 80, "g", 1, "ly", "", ""],
  // BOM-CMA-001: Caramel Macchiato
  ["BOM-CMA-001", "Caramel Macchiato", "", "NVL-CPH-002", 18, "g", 1, "ly", "Arabica", ""],
  ["BOM-CMA-001", "Caramel Macchiato", "", "NVL-SUA-002", 120, "ml", 1, "ly", "Sữa tươi nóng", ""],
  ["BOM-CMA-001", "Caramel Macchiato", "", "NVL-SYR-001", 15, "ml", 1, "ly", "Syrup caramel", ""],
  ["BOM-CMA-001", "Caramel Macchiato", "", "NVL-DUO-001", 5, "g", 1, "ly", "", "Mức đường"],
];

// ────────────────────────────────────────────────────────────────
// Build workbook
// ────────────────────────────────────────────────────────────────
function buildSheet(rows, options = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Set column width nếu provided
  if (options.colWidths) {
    ws["!cols"] = options.colWidths.map((w) => ({ wch: w }));
  }
  // Freeze header row
  if (options.freezeHeader) {
    ws["!freeze"] = { ySplit: 1 };
  }
  return ws;
}

const wb = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(
  wb,
  buildSheet(huongDanRows, { colWidths: [40, 70] }),
  "1. Hướng dẫn",
);

XLSX.utils.book_append_sheet(
  wb,
  buildSheet(nhomHangRows, {
    colWidths: [8, 28, 12, 10, 10, 35],
    freezeHeader: true,
  }),
  "2. Nhóm FnB",
);

XLSX.utils.book_append_sheet(
  wb,
  buildSheet(modifierRows, { colWidths: [35, 18, 70] }),
  "3. Modifier (UI)",
);

XLSX.utils.book_append_sheet(
  wb,
  buildSheet(nvlRows, {
    colWidths: [16, 35, 8, 10, 10, 8, 10, 12, 10, 10, 12, 12, 30],
    freezeHeader: true,
  }),
  "4. NVL FnB",
);

XLSX.utils.book_append_sheet(
  wb,
  buildSheet(skuMonRows, {
    colWidths: [16, 30, 8, 10, 10, 8, 16, 10, 10, 8, 35],
    freezeHeader: true,
  }),
  "5. SKU món",
);

XLSX.utils.book_append_sheet(
  wb,
  buildSheet(bomRows, {
    colWidths: [16, 28, 12, 16, 10, 8, 10, 14, 30, 22],
    freezeHeader: true,
  }),
  "6. BOM",
);

// ────────────────────────────────────────────────────────────────
// Write file
// ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, "..", "docs", "FNB-SETUP-MASTER.xlsx");
XLSX.writeFile(wb, outPath);

const stats = fs.statSync(outPath);
console.log(`✅ Built: ${outPath}`);
console.log(`   Size: ${(stats.size / 1024).toFixed(1)} KB`);
console.log(`   Sheets: 6 (Hướng dẫn, Nhóm FnB, Modifier, NVL, SKU món, BOM)`);
console.log(`   Sample data: 10 categories + 15 NVL + 10 món + 30+ BOM items`);
