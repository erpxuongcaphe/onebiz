"use client";

import { SummaryCard } from "@/components/shared/summary-card";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatStockQuantity } from "@/lib/format";
import { inventoryCapitalCategories, inventoryCapitalSummary, INVENTORY_REVIEW_LABELS, type InventoryReview } from "@/lib/reports/inventory-capital";
import type { XntRow } from "@/lib/services/supabase/xnt-report";
import { ReportSection } from "./report-section";
import { ReportDataTable } from "./report-data-table";

const money = (value: number | null) => value === null ? "Chưa đủ dữ liệu" : formatCurrency(value);
export function InventoryCapitalReview({ rows, onReview, categorySort, onCategorySort }: { rows: XntRow[]; onReview: (value: InventoryReview) => void; categorySort: { id: string; direction: "asc" | "desc" }; onCategorySort: (value: { id: string; direction: "asc" | "desc" }) => void }) {
  const totals = inventoryCapitalSummary(rows);
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <SummaryCard label="Giá trị tồn cuối kỳ" value={money(totals.closingValue)} highlight hint={totals.missing ? `Đã xác định: ${formatCurrency(totals.knownClosingValue)}đ` : "Theo giá vốn lịch sử"} />
      <SummaryCard label="Còn tồn, chưa xuất" value={money(totals.noOutValue)} hint={`${totals.noOut} mặt hàng trong kỳ`} />
      <SummaryCard label="Tồn cuối âm" value={formatStockQuantity(totals.negative)} hint="Đối chiếu phát sinh" />
      <SummaryCard label="Thiếu giá trị cuối kỳ" value={formatStockQuantity(totals.missing)} hint="Kiểm tra giá vốn" />
    </div>
    <ReportSection title="Kiểm soát vốn tồn kho" tone={totals.negative + totals.missing + totals.mismatch ? "review" : "neutral"} subtitle="Trong phạm vi bộ lọc">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([
        { key: "noOut", count: totals.noOut, note: "Xem nhu cầu sử dụng hoặc điều chuyển; chưa kết luận hàng chậm luân chuyển." },
        { key: "negative", count: totals.negative, note: "Đối chiếu nhập, xuất, quy đổi và thời điểm ghi nhận." },
        { key: "missing", count: totals.missing, note: "Kiểm tra giá vốn lịch sử; không thay bằng giá danh mục hiện tại." },
        { key: "mismatch", count: totals.mismatch, note: "Đối chiếu đầu kỳ + nhập − xuất với cuối kỳ." },
      ] as const).map(item => <div key={item.key} className="border-l-2 pl-3"><p className="text-sm font-medium">{INVENTORY_REVIEW_LABELS[item.key]}: {item.count}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.note}</p><button type="button" disabled={!item.count} onClick={() => onReview(item.key)} className="inline-flex min-h-9 items-center gap-1 text-sm text-primary disabled:opacity-50">Xem mặt hàng<Icon name="arrow_forward" size={16} /></button></div>)}</div>
    </ReportSection>
    <ReportSection title="Vốn tồn theo nhóm hàng" tone="primary">
      <ReportDataTable tablePreferenceKey="report.inventory-capital.categories" rows={inventoryCapitalCategories(rows, categorySort)} sortState={categorySort} onSortChange={onCategorySort} getRowKey={row => row.category} columns={[
        { key: "category", label: "Nhóm hàng", sticky: true, hideable: false, width: "240px" },
        { key: "products", label: "Mặt hàng", align: "right" },
        { key: "closingValue", label: "Giá trị tồn cuối kỳ", align: "right", cell: row => money(row.closingValue) },
        { key: "knownClosingValue", label: "Giá trị đã xác định", align: "right", cell: row => money(row.knownClosingValue) },
        { key: "missing", label: "Thiếu giá trị", align: "right" },
        { key: "negative", label: "Tồn âm", align: "right" },
        { key: "noOut", label: "Còn tồn, chưa xuất", align: "right" },
      ]} />
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Không cộng số lượng khác đơn vị. Giá trị đã xác định là phần có căn cứ, không phải tổng khi còn thiếu dữ liệu.</p>
    </ReportSection>
  </div>;
}
