import type { CohortEvidence } from "@/lib/reports/cohort-evidence";

const integer = new Intl.NumberFormat("vi-VN");
const percent = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** Keep identity coverage separate from customer-retention conclusions. */
export function CustomerCohortCoverage({ data, canView, error }: { data?: CohortEvidence; canView: boolean; error?: string }) {
  if (!canView) return null;
  if (error) return <p role="alert" className="border-l-2 border-status-error px-3 py-2 text-sm">Không tải được độ phủ khách hàng.</p>;
  if (!data) return <p role="status" className="text-sm text-muted-foreground">Đang tải độ phủ khách hàng...</p>;
  const c = data.coverage;
  const rateLabel = c.identified_invoice_rate === null ? "Chưa có hóa đơn"
    : c.identified_invoices < c.external_invoices && Math.round(c.identified_invoice_rate * 10) === 1000
      ? ">99,9%" : `${percent.format(c.identified_invoice_rate)}%`;
  const review = c.unresolved_customer_invoices + c.invalid_date_records + c.creation_date_fallbacks + c.historical_legacy_trace_gaps;
  const details = [
    ["Không gắn khách", c.anonymous_invoices], ["Khách lẻ mặc định", c.walk_in_invoices],
    ["Liên kết khách cần kiểm tra", c.unresolved_customer_invoices],
    ["Thiếu ngày nghiệp vụ", c.creation_date_fallbacks], ["Ngày không hợp lệ", c.invalid_date_records],
    ["Giao dịch nội bộ đã loại", c.excluded_internal_invoices], ["Đơn gốc đã loại", c.excluded_order_records],
    ["Lần bán cũ có nhật ký POS", c.confirmed_legacy_sales], ["Thiếu nhật ký trong kỳ", c.legacy_trace_gaps],
    ["Thiếu nhật ký lịch sử (mọi kỳ)", c.historical_legacy_trace_gaps],
  ] as const;
  return <section aria-label="Độ phủ khách hàng" className="border-y border-border bg-background">
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">Độ phủ khách hàng</h2>
        <p className="mt-1 text-xs text-muted-foreground">Có mã khách <strong className="text-foreground tabular-nums">{integer.format(c.identified_invoices)} / {integer.format(c.external_invoices)}</strong> hóa đơn</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div><p className="text-xs text-muted-foreground">Định danh</p><p className="font-semibold tabular-nums text-status-info">{rateLabel}</p></div>
        <div><p className="text-xs text-muted-foreground">Khách lẻ / chưa gắn</p><p className="font-semibold tabular-nums text-foreground">{integer.format(c.walk_in_invoices + c.anonymous_invoices)} <span className="text-xs font-normal">hóa đơn</span></p></div>
      </div>
    </div>
    {!data.retention_ready && <p role="alert" className="border-l-2 border-status-warning bg-status-warning/5 px-3 py-2 text-xs leading-5">Chưa đủ căn cứ tính khách quay lại: còn ngày chứng từ cần đối chiếu.</p>}
    {c.historical_legacy_trace_gaps > 0 && <p role="status" className="border-l-2 border-status-warning bg-status-warning/5 px-3 py-2 text-xs leading-5">Có lần bán cũ thiếu nhật ký. Đã giữ theo trạng thái hóa đơn hoàn tất.</p>}
    <details className="border-t border-border">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary">Chi tiết dữ liệu{review > 0 ? " · Có mục cần kiểm tra" : ""}</summary>
      <div className="space-y-3 px-3 pb-3 text-xs">
        <dl className="grid gap-4 sm:grid-cols-2">{details.map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b border-border/60 py-1"><dt className="text-muted-foreground">{label}</dt><dd className="shrink-0 font-medium tabular-nums text-foreground">{integer.format(value)}</dd></div>)}</dl>
        <p className="leading-5 text-muted-foreground">Lần mua đầu: {data.first_purchase_scope === "tenant" ? "toàn công ty" : "trong chi nhánh đang chọn"}. Độ phủ tính theo hóa đơn, không phải số người. Không cộng số khách các chi nhánh để tính khách toàn công ty.</p>
        <p className="leading-5 text-muted-foreground">Đo lần mua trên hóa đơn hoàn tất, không phải doanh thu sau trả hàng. Đơn lịch sử và ngày thiếu cần đối chiếu trước khi kết luận.</p>
      </div>
    </details>
  </section>;
}
