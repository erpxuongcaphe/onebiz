/**
 * Types cho báo cáo phân tích — framework Sprint REP-1.
 *
 * Pattern KiotViet (CEO 06/05/2026):
 * - 16 preset thời gian chia 5 nhóm (Ngày / Tuần / Tháng / Quý / Năm)
 * - Toggle Chart / Table view mode
 * - 2 mode export: view (mirror current view) hoặc full (multi-sheet)
 */

// ============================================================
// Date preset — 16 cái chia 5 nhóm theo KiotViet
// ============================================================

export type DatePresetGroup = "day" | "week" | "month" | "quarter" | "year";

export type DatePreset =
  // Theo ngày
  | "today"
  | "yesterday"
  // Theo tuần
  | "thisWeek"
  | "lastWeek"
  | "last7Days"
  // Theo tháng
  | "thisMonth"
  | "lastMonth"
  | "last30Days"
  | "thisMonthLunar"
  | "lastMonthLunar"
  // Theo quý
  | "thisQuarter"
  | "lastQuarter"
  // Theo năm
  | "thisYear"
  | "lastYear"
  | "thisYearLunar"
  | "lastYearLunar"
  // Custom
  | "custom";

export interface DateRange {
  /** ISO date string YYYY-MM-DD (start of day, Asia/Ho_Chi_Minh) */
  from: string;
  /** ISO date string YYYY-MM-DD (end of day, inclusive) */
  to: string;
}

// ============================================================
// View mode — Biểu đồ vs Báo cáo (bảng)
// ============================================================

export type ReportViewMode = "chart" | "table";

// ============================================================
// Export mode — view (mirror) vs full (multi-sheet)
// ============================================================

export type ReportExportMode = "view" | "full";

// ============================================================
// Report kinds — toàn bộ catalog báo cáo và các loại legacy còn được export
// ============================================================

export type ReportKind =
  | "tong-quan"
  | "cuoi-ngay"
  | "tong-hop-kenh"
  | "canh-bao"
  | "doi-chieu-ca"
  | "ban-hang"
  | "dat-hang"
  | "kenh-ban"
  | "khuyen-mai"
  | "tra-hang"
  | "platform-commission"
  | "khach-hang"
  | "khach-san-pham"
  | "customer-cohort"
  | "rfm"
  | "xuat-nhap-ton"
  | "hang-hoa"
  | "abc-analysis"
  | "lot-traceability"
  | "kiem-ke"
  | "chenh-lech-kiem-ke"
  | "aging"
  | "ton-that"
  | "tieu-hao-nvl"
  | "cogs-theo-bom"
  | "tai-chinh"
  | "bao-cao-tai-chinh"
  | "luong-tien"
  | "vat"
  | "cong-no-aging"
  | "fnb"
  | "fnb-shipper"
  | "fnb-modifier"
  | "serve-time"
  | "nhan-vien"
  | "nha-cung-cap"
  | "so-quy"
  | "du-kien-mua-hang";

/**
 * Sub-mode XNT (Xuất-Nhập-Tồn).
 * - "summary": 9 cột (Tồn đầu / Nhập / Xuất / Tồn cuối) — view tổng hợp
 * - "detail": 13 cột (NHẬP × 5 + XUẤT × 6) — view chi tiết kế toán
 * - "by-branch": matrix theo chi nhánh
 */
export type XntSubMode = "summary" | "detail" | "by-branch";
