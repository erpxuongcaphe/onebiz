import type { ExcelSheet } from "@/lib/utils/excel-export";
import { parseCohortEvidence, summarizeCohortEvidence, type CohortEvidence } from "./cohort-evidence";

export function buildCohortEvidenceSheets(input: CohortEvidence, scope: { tenantId: string; branchId: string | null; months: number }): ExcelSheet[] {
  const data = parseCohortEvidence(input, scope);
  const c = data.coverage;
  const summary = summarizeCohortEvidence(data);
  const titleRows = ["KHÁCH HÀNG QUAY LẠI", `Thời điểm nguồn: ${data.generated_at}`,
    `Lần mua đầu: ${data.first_purchase_scope === "tenant" ? "toàn công ty" : "trong chi nhánh"}`,
    data.retention_ready ? "Theo hóa đơn hoàn tất; không phải doanh thu sau trả hàng." : "CHƯA ĐỦ CĂN CỨ: ngày chứng từ cần đối chiếu. Tỷ lệ và số khách cohort để trống.",
    `Lần bán cũ thiếu nhật ký (mọi kỳ): ${c.historical_legacy_trace_gaps}. Đã giữ theo trạng thái hóa đơn hoàn tất.`];
  const metrics: [string, number | null, string, string][] = [
    ["Khách lần đầu trong kỳ", summary.firstTimeCustomers, "mã khách", "Theo phạm vi lần mua đầu đã nêu."],
    ["Quay lại tháng kế", summary.m1Retention, "%", "Bình quân các nhóm có khách và đã kết thúc tháng kế; không phải tỷ lệ gộp tất cả khách."],
    ["Hóa đơn bên ngoài", c.external_invoices, "hóa đơn", "Không gồm nội bộ và đơn gốc có hóa đơn thay thế hợp lệ."],
    ["Có mã khách", c.identified_invoices, "hóa đơn", ""],
    ["Độ phủ định danh", c.identified_invoice_rate, "%", "Theo hóa đơn, không phải tỷ lệ số người."],
    ["Khách định danh có mua trong kỳ", c.identified_customers, "mã khách", "Không phải số khách lần đầu."],
    ["Không gắn khách", c.anonymous_invoices, "hóa đơn", ""],
    ["Khách lẻ mặc định", c.walk_in_invoices, "hóa đơn", ""],
    ["Liên kết khách cần kiểm tra", c.unresolved_customer_invoices, "hóa đơn", ""],
    ["Giao dịch nội bộ đã loại", c.excluded_internal_invoices, "hóa đơn", ""],
    ["Đơn gốc đã loại", c.excluded_order_records, "đơn", "Có hóa đơn bán thay thế hợp lệ."],
    ["Lần bán cũ có nhật ký POS", c.confirmed_legacy_sales, "hóa đơn", "Nằm trong hóa đơn bên ngoài, không cộng thêm lần nữa."],
    ["Thiếu nhật ký trong kỳ", c.legacy_trace_gaps, "hóa đơn", "Vẫn ghi nhận theo trạng thái hóa đơn hoàn tất."],
    ["Thiếu nhật ký lịch sử", c.historical_legacy_trace_gaps, "hóa đơn", "Mọi kỳ trong phạm vi; không cộng với thiếu nhật ký trong kỳ."],
    ["Thiếu ngày nghiệp vụ", c.creation_date_fallbacks, "bản ghi", "Đã dùng ngày tạo, cần đối chiếu."],
    ["Ngày không hợp lệ", c.invalid_date_records, "bản ghi", "Chưa gán vào kỳ; thống kê trên toàn lịch sử trong phạm vi."],
  ];
  const matrix: ExcelSheet = { name: "Khách quay lại", titleRows, tablePreferenceKey: "report.customer-cohort.matrix",
    columns: [{ key: "label", label: "Tháng mua đầu", width: 18 }, { key: "size", label: "Số khách", width: 12, format: "number" },
      ...Array.from({ length: data.months_tracked }, (_, index) => ({ key: `m${index}`, label: index === 0 ? "Tháng đầu (%)" : `Tháng +${index} (%)`, width: 16, format: "number" as const }))],
    rows: data.rows.map(row => ({ label: row.label, size: data.retention_ready ? row.size : null,
      ...Object.fromEntries(Array.from({ length: data.months_tracked }, (_, index) => [`m${index}`, data.retention_ready && row.size > 0 ? row.retention[index] ?? null : null])) })),
  };
  return [{ name: "Độ phủ", titleRows, columns: [
    { key: "label", label: "Chỉ tiêu", width: 39 }, { key: "value", label: "Giá trị", width: 16, format: "number" },
    { key: "unit", label: "Đơn vị", width: 14 }, { key: "note", label: "Cơ sở", width: 85 },
  ], rows: metrics.map(([label, value, unit, note]) => ({ label, value, unit, note })) }, matrix,
  { name: "Kỳ quan sát", titleRows, columns: [{ key: "cohort", label: "Tháng mua đầu", width: 18 }, { key: "offset", label: "Tháng theo dõi", width: 18, format: "number" }, { key: "state", label: "Trạng thái", width: 25 }],
    rows: data.rows.flatMap(row => row.closed_observations.map((closed, offset) => ({ cohort: row.label, offset, state: closed ? "Đã kết thúc tháng" : "Tháng đang diễn ra" }))) }];
}
