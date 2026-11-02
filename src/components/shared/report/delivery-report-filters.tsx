"use client";

import { useState } from "react";
import { FilterPanel } from "@/components/shared/filter-sidebar/filter-panel";
import { FilterChips } from "@/components/shared/filter-chips";
import { MetricFilters } from "@/components/shared/report/metric-filters";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { createDeliveryFilters, DELIVERY_STATUS_LABELS, DELIVERY_INVOICE_STATUS_LABELS, INVOICE_PAYMENT_LABELS, type DeliveryFilters, type DeliveryInvoiceView } from "@/lib/reports/delivery-invoice-view";
import { DELIVERY_TIER_LABELS } from "@/lib/reports/delivery-report-export";
import { metricFilterLabel, type MetricFilter } from "@/lib/reports/metric-filter";
import { formatCashBookDate } from "@/lib/cash-time";

const MONEY_KEYS = new Set(["invoiceTotal", "invoicePaid", "invoiceDebt", "deliveryFee", "missingInvoice"]);
const EVIDENCE_LABELS: Record<string, string> = { linked: "Có hóa đơn phù hợp", missing: "Chưa có hóa đơn phù hợp", duplicate: "Hóa đơn gắn nhiều đơn giao" };
const ASSIGNED_LABELS: Record<string, string> = { assigned: "Đã phân công", unassigned: "Chưa phân công" };
export const DELIVERY_ORDER_METRIC_FIELDS = [
  { key: "durationSeconds", label: "Thời gian giao (giây)" },
  { key: "invoiceTotal", label: "Giá trị hóa đơn" }, { key: "invoicePaid", label: "Đã thanh toán trên HĐ" },
  { key: "invoiceDebt", label: "Còn phải thu trên HĐ" }, { key: "deliveryFee", label: "Phí giao trên đơn" },
];
export const DELIVERY_SUMMARY_METRIC_FIELDS = [
  { key: "orders", label: "Số đơn" }, { key: "completed", label: "Đã giao" },
  { key: "cancelled", label: "Đã hủy" }, { key: "unassigned", label: "Chưa phân công" },
  { key: "avgDeliverySeconds", label: "Thời gian giao TB (giây)" }, { key: "timedCount", label: "Đơn đủ mốc giao" },
  ...DELIVERY_ORDER_METRIC_FIELDS.filter(field => MONEY_KEYS.has(field.key)),
  { key: "missingInvoice", label: "Đơn cần kiểm tra HĐ" },
];
export function deliveryOrderMetricFields(canViewMoney: boolean) {
  return DELIVERY_ORDER_METRIC_FIELDS.filter(field => canViewMoney || !MONEY_KEYS.has(field.key));
}
export function deliverySummaryMetricFields(canViewMoney: boolean) {
  return DELIVERY_SUMMARY_METRIC_FIELDS.filter(field => canViewMoney || !MONEY_KEYS.has(field.key));
}

export interface DeliveryFilterDescription { key: string; label: string; value: string }
export function deliveryFilterDescriptions(filters: DeliveryFilters, rows: DeliveryInvoiceView[], canViewMoney: boolean, summaryMetrics: MetricFilter[] = []): DeliveryFilterDescription[] {
  const descriptions: DeliveryFilterDescription[] = [];
  const add = (key: keyof DeliveryFilters, label: string, value?: string) => {
    const selected = filters[key];
    if (typeof selected === "string" && selected) descriptions.push({ key, label, value: value || selected });
  };
  add("search", "Tìm kiếm");
  const staff = rows.find(row => row.staffKey === filters.staff);
  add("staff", "Nhân viên", staff ? `${staff.branchName} · ${staff.staffName}` : undefined);
  add("status", "Trạng thái giao", (DELIVERY_STATUS_LABELS as Record<string, string>)[filters.status]);
  add("branch", "Chi nhánh", rows.find(row => row.branchId === filters.branch)?.branchName);
  add("tier", "Cự ly", DELIVERY_TIER_LABELS[filters.tier ?? ""]);
  add("assignedState", "Phân công", ASSIGNED_LABELS[filters.assignedState ?? ""]);
  add("invoiceStatus", "Trạng thái HĐ", DELIVERY_INVOICE_STATUS_LABELS[filters.invoiceStatus ?? ""]);
  add("evidence", "Liên kết HĐ", EVIDENCE_LABELS[filters.evidence ?? ""]);
  if (canViewMoney) add("method", "Thanh toán", INVOICE_PAYMENT_LABELS[filters.method]);
  for (const [key, label] of [["assignedFrom", "Nhận giao từ"], ["assignedTo", "Nhận giao đến"], ["completedFrom", "Hoàn tất từ"], ["completedTo", "Hoàn tất đến"]] as const) {
    add(key, label, filters[key] ? formatCashBookDate(filters[key]!) : undefined);
  }
  const addMetrics = (items: MetricFilter[], fields: { key: string; label: string }[], prefix: string, label: string) => {
    items.forEach((filter, index) => {
      if (fields.some(field => field.key === filter.key)) descriptions.push({ key: `${prefix}:${index}`, label, value: metricFilterLabel([filter], fields) });
    });
  };
  addMetrics(filters.metrics ?? [], deliveryOrderMetricFields(canViewMoney), "metrics", "Chỉ tiêu đơn");
  addMetrics(summaryMetrics, deliverySummaryMetricFields(canViewMoney), "summaryMetrics", "Chỉ tiêu NV");
  return descriptions;
}

export interface DeliveryReportFiltersProps {
  rows: DeliveryInvoiceView[];
  canViewMoney: boolean;
  filters: DeliveryFilters;
  onChange: (next: DeliveryFilters) => void;
  summaryMetrics: MetricFilter[];
  onSummaryMetricsChange: (next: MetricFilter[]) => void;
  tab: string;
}

function optionsWithSelection(entries: [string, string][], selected: string | undefined) {
  const options = new Map(entries.filter(([value]) => !!value));
  if (selected && !options.has(selected)) options.set(selected, selected);
  return [...options.entries()];
}

export default function DeliveryReportFilters({ rows, canViewMoney, filters, onChange, summaryMetrics, onSummaryMetricsChange, tab }: DeliveryReportFiltersProps) {
  const [open, setOpen] = useState(false);
  const descriptions = deliveryFilterDescriptions(filters, rows, canViewMoney, summaryMetrics);
  const update = (key: keyof DeliveryFilters, value: string) => onChange({ ...filters, [key]: value });
  const clearAll = () => { onChange(createDeliveryFilters()); onSummaryMetricsChange([]); };
  const clear = (key: string) => {
    if (key.startsWith("summaryMetrics:")) onSummaryMetricsChange(summaryMetrics.filter((_, index) => index !== Number(key.split(":")[1])));
    else if (key.startsWith("metrics:")) onChange({ ...filters, metrics: (filters.metrics ?? []).filter((_, index) => index !== Number(key.split(":")[1])) });
    else update(key as keyof DeliveryFilters, "");
  };
  const select = (key: keyof DeliveryFilters, label: string, entries: [string, string][]) => <label className="min-w-0 space-y-1 text-sm"><span>{label}</span><select className="h-11 w-full min-w-0 rounded-md border bg-background px-2" value={typeof filters[key] === "string" ? filters[key] as string : ""} onChange={event => update(key, event.target.value)}><option value="">Tất cả</option>{optionsWithSelection(entries, filters[key] as string | undefined).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  const fields = tab === "staff" ? deliverySummaryMetricFields(canViewMoney) : deliveryOrderMetricFields(canViewMoney);
  const metrics = tab === "staff" ? summaryMetrics : filters.metrics ?? [];
  // Permission-hidden conditions are never exposed in the editor.
  const visibleMetrics = metrics.filter(filter => fields.some(field => field.key === filter.key));
  const updateMetrics = (next: MetricFilter[]) => {
    const hidden = metrics.filter(filter => !fields.some(field => field.key === filter.key));
    const merged = [...next, ...hidden];
    if (tab === "staff") onSummaryMetricsChange(merged);
    else onChange({ ...filters, metrics: merged });
  };
  return <div className="min-w-0 space-y-2">
    <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(160px,1fr)_auto]">
      <label className="min-w-0 space-y-1 text-sm"><span>Tìm đơn, hóa đơn, khách</span><Input className="h-11" value={filters.search} onChange={event => update("search", event.target.value)} /></label>
      {select("staff", "Nhân viên giao", rows.map(row => [row.staffKey, `${row.branchName} · ${row.staffName}`]))}
      {select("status", "Trạng thái giao", Object.entries(DELIVERY_STATUS_LABELS))}
      <div className="flex h-11 items-center gap-2"><Button variant="outline" className="h-11" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="filter_alt" />Bộ lọc{descriptions.length ? ` (${descriptions.length})` : ""}</Button>{descriptions.length > 0 && <Button variant="ghost" className="h-11 w-11 shrink-0 p-0" aria-label="Xóa bộ lọc" title="Xóa bộ lọc" onClick={clearAll}><Icon name="filter_alt_off" /></Button>}</div>
    </div>
    <FilterChips className="h-11 min-h-11 border-y px-0 [&_button]:min-h-11" filters={descriptions.map(description => ({ ...description, onClear: () => clear(description.key) }))} onClearAll={clearAll} />
    <FilterPanel open={open} onOpenChange={setOpen} title="Bộ lọc giao hàng" activeCount={descriptions.length} onClearAll={clearAll}>
      <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Giao hàng</legend>
        {select("branch", "Chi nhánh", rows.map(row => [row.branchId, row.branchName]))}
        {select("tier", "Cự ly", [...Object.entries(DELIVERY_TIER_LABELS), ...rows.flatMap(row => row.deliveryTier ? [[row.deliveryTier, DELIVERY_TIER_LABELS[row.deliveryTier] ?? row.deliveryTier] as [string, string]] : [])])}
        {select("assignedState", "Phân công", Object.entries(ASSIGNED_LABELS))}
        {select("invoiceStatus", "Trạng thái HĐ", [...Object.entries(DELIVERY_INVOICE_STATUS_LABELS), ...rows.flatMap(row => row.invoiceStatus ? [[row.invoiceStatus, DELIVERY_INVOICE_STATUS_LABELS[row.invoiceStatus] ?? row.invoiceStatus] as [string, string]] : [])])}
        {select("evidence", "Liên kết HĐ", Object.entries(EVIDENCE_LABELS))}
        {canViewMoney && select("method", "Thanh toán trên HĐ", [...Object.entries(INVOICE_PAYMENT_LABELS).filter(([key]) => key !== "bank_transfer"), ...rows.flatMap(row => row.paymentMethod ? [[row.paymentMethod === "bank_transfer" ? "transfer" : row.paymentMethod, INVOICE_PAYMENT_LABELS[row.paymentMethod] ?? row.paymentMethod] as [string, string]] : [])])}
      </fieldset>
      <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Mốc giao hàng (VN)</legend>
        {([["assignedFrom", "Nhận giao từ"], ["assignedTo", "Nhận giao đến"], ["completedFrom", "Hoàn tất từ"], ["completedTo", "Hoàn tất đến"]] as const).map(([key, label]) => <label key={key} className="block min-w-0 space-y-1 text-sm"><span>{label}</span><input type="date" className="h-11 w-full min-w-0 rounded-md border bg-background px-2" value={filters[key] ?? ""} onChange={event => update(key, event.target.value)} /></label>)}
        {((filters.assignedFrom && filters.assignedTo && filters.assignedFrom > filters.assignedTo) || (filters.completedFrom && filters.completedTo && filters.completedFrom > filters.completedTo)) && <p role="alert" className="text-sm text-destructive">Ngày từ phải trước hoặc bằng ngày đến.</p>}
      </fieldset>
      <div className="[&_.grid]:grid-cols-2 [&_select]:h-11 [&_input]:h-11 [&_button]:min-h-11 [&_button]:min-w-11"><MetricFilters fields={fields} value={visibleMetrics} onChange={updateMetrics} /></div>
    </FilterPanel>
  </div>;
}
