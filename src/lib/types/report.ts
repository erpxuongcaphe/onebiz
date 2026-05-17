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
// Report kinds — tất cả 14 báo cáo + XNT mới
// ============================================================

export type ReportKind =
  | "cuoi-ngay"
  | "ban-hang"
  | "fnb"
  | "dat-hang"
  | "kenh-ban"
  | "khuyen-mai"
  | "xuat-nhap-ton"
  | "hang-hoa"
  | "khach-hang"
  | "nha-cung-cap"
  | "tai-chinh"
  | "luong-tien"
  | "bao-cao-tai-chinh"
  | "canh-bao"
  | "so-quy";

/**
 * Sub-mode XNT (Xuất-Nhập-Tồn).
 * - "summary": 9 cột (Tồn đầu / Nhập / Xuất / Tồn cuối) — view tổng hợp
 * - "detail": 13 cột (NHẬP × 5 + XUẤT × 6) — view chi tiết kế toán
 * - "by-branch": matrix theo chi nhánh
 */
export type XntSubMode = "summary" | "detail" | "by-branch";
