import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeliveryReportFilters, { deliveryFilterDescriptions, deliveryOrderMetricFields, deliverySummaryMetricFields } from "@/components/shared/report/delivery-report-filters";
import { createDeliveryFilters, deliveryInvoiceView, type DeliveryFilters } from "@/lib/reports/delivery-invoice-view";
import type { DeliveryInvoiceRow } from "@/lib/services/supabase/delivery-invoice-management";
import type { MetricFilter } from "@/lib/reports/metric-filter";

vi.mock("@/lib/hooks/use-breakpoint", () => ({ useBreakpoint: () => true }));
afterEach(cleanup);
const row: DeliveryInvoiceRow = { id: "order-a", orderNumber: "DH-TEST", branchId: "branch-a", branchName: "Chi nhánh A",
  staffId: "staff-a", staffName: "Nhân viên A", createdAt: "2026-11-01T00:00:00Z", assignedAt: null, completedAt: null,
  orderStatus: "pending", invoiceId: "invoice-a", invoiceCode: "HD-TEST", invoiceStatus: "custom-status",
  customerName: "Khách thử", paymentMethod: "cash", invoiceTotal: 100, invoicePaid: 60, invoiceDebt: 40,
  deliveryFee: 10, deliveryTier: "custom-tier", durationSeconds: null, deliveryStatus: "assigned" };
const rows = deliveryInvoiceView([row]);
const metric = (key: string): MetricFilter => ({ key, state: "known", min: null, max: null });

function Harness({ money = true, initial = createDeliveryFilters(), summary = [] as MetricFilter[], tab = "staff", source = rows }: {
  money?: boolean; initial?: DeliveryFilters; summary?: MetricFilter[]; tab?: string; source?: typeof rows;
}) {
  const [filters, setFilters] = useState(initial);
  const [metrics, setMetrics] = useState(summary);
  return <><DeliveryReportFilters rows={source} canViewMoney={money} filters={filters} onChange={setFilters}
    summaryMetrics={metrics} onSummaryMetricsChange={setMetrics} tab={tab} />
    <output aria-label="Filter state">{JSON.stringify(filters)}</output><output aria-label="Summary state">{JSON.stringify(metrics)}</output></>;
}
const filterState = () => JSON.parse(screen.getByLabelText("Filter state").textContent!) as DeliveryFilters;
const summaryState = () => JSON.parse(screen.getByLabelText("Summary state").textContent!) as MetricFilter[];
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /^Bộ lọc/ }));

describe("delivery report filter UI", () => {
  it("keeps quick filters visible and closes the applied panel via result, close and Escape", async () => {
    render(<Harness />);
    expect(screen.getByLabelText("Tìm đơn, hóa đơn, khách")).toBeInTheDocument();
    expect(screen.getByLabelText("Nhân viên giao")).toBeInTheDocument();
    expect(screen.getByLabelText("Trạng thái giao")).toBeInTheDocument();
    openPanel(); expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cự ly"), { target: { value: "custom-tier" } });
    fireEvent.click(screen.getByRole("button", { name: "Xem kết quả" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(filterState().tier).toBe("custom-tier");
    openPanel(); fireEvent.click(screen.getByRole("button", { name: "Đóng bộ lọc" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    openPanel(); fireEvent.keyDown(screen.getByLabelText("Cự ly"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(filterState().tier).toBe("custom-tier");
    expect(screen.queryByText("Có nội dung chưa lưu")).not.toBeInTheDocument();
  });
  it("counts all conditions and clears individual field/detail/summary chips then resets everything", () => {
    render(<Harness initial={{ ...createDeliveryFilters(), search: "DH", branch: "branch-a", assignedFrom: "2026-11-01", metrics: [metric("durationSeconds"), metric("invoiceDebt")] }} summary={[metric("orders"), metric("completed")]} />);
    expect(screen.getByRole("button", { name: "Bộ lọc (7)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Xóa lọc Chỉ tiêu đơn: Thời gian giao/ }));
    expect(filterState().metrics?.map(filter => filter.key)).toEqual(["invoiceDebt"]);
    fireEvent.click(screen.getByRole("button", { name: /Xóa lọc Chỉ tiêu NV: Số đơn/ }));
    expect(summaryState().map(filter => filter.key)).toEqual(["completed"]);
    fireEvent.click(screen.getByRole("button", { name: /Xóa lọc Nhận giao từ/ }));
    expect(filterState().assignedFrom).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    expect(filterState()).toEqual(createDeliveryFilters()); expect(summaryState()).toEqual([]);
    expect(screen.getByRole("button", { name: "Bộ lọc" })).toBeInTheDocument();
  });
  it("keeps all selected options even when they are absent from the latest rows", () => {
    render(<Harness source={[]} initial={{ ...createDeliveryFilters(), staff: "old-staff", branch: "old-branch", status: "old-status", tier: "old-tier", invoiceStatus: "old-invoice" }} />);
    expect(screen.getByLabelText("Nhân viên giao")).toHaveValue("old-staff");
    expect(screen.getByLabelText("Trạng thái giao")).toHaveValue("old-status");
    openPanel();
    for (const [label, value] of [["Chi nhánh", "old-branch"], ["Cự ly", "old-tier"], ["Trạng thái HĐ", "old-invoice"]]) {
      const select = screen.getByLabelText(label); expect(select).toHaveValue(value);
      expect(within(select).getByRole("option", { name: value })).toBeInTheDocument();
    }
  });
  it("keeps the open panel and selected options while the scoped rows reload", () => {
    const view = render(<Harness initial={{ ...createDeliveryFilters(), tier: "custom-tier" }} />);
    openPanel();
    view.rerender(<Harness source={[]} initial={{ ...createDeliveryFilters(), tier: "custom-tier" }} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Cự ly")).toHaveValue("custom-tier");
  });
  it("includes unknown invoice status/tier from rows and edits date/evidence/assignment fields", () => {
    render(<Harness />); openPanel();
    expect(within(screen.getByLabelText("Trạng thái HĐ")).getByRole("option", { name: "custom-status" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Cự ly")).getByRole("option", { name: "custom-tier" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nhận giao từ"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("Nhận giao đến"), { target: { value: "2026-11-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ngày từ phải trước hoặc bằng ngày đến");
    fireEvent.change(screen.getByLabelText("Phân công"), { target: { value: "unassigned" } });
    fireEvent.change(screen.getByLabelText("Liên kết HĐ"), { target: { value: "missing" } });
    expect(filterState()).toMatchObject({ assignedFrom: "2026-11-02", assignedTo: "2026-11-01", assignedState: "unassigned", evidence: "missing" });
  });
  it.each(["staff", "orders"])("hides payment and money metric options and descriptions without permission on %s", tab => {
    render(<Harness money={false} tab={tab} initial={{ ...createDeliveryFilters(), method: "cash", metrics: [metric("invoiceDebt")] }} summary={[metric("missingInvoice")]} />);
    expect(screen.queryByRole("button", { name: /Xóa lọc Thanh toán/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xóa lọc Chỉ tiêu/ })).not.toBeInTheDocument();
    openPanel(); expect(screen.queryByLabelText("Thanh toán trên HĐ")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Lọc chỉ tiêu"));
    fireEvent.click(screen.getByRole("button", { name: "Thêm điều kiện" }));
    const fields = within(screen.getByLabelText("Chỉ tiêu 1"));
    expect(fields.queryByRole("option", { name: "Còn phải thu trên HĐ" })).not.toBeInTheDocument();
    expect(fields.queryByRole("option", { name: "Đơn cần kiểm tra HĐ" })).not.toBeInTheDocument();
  });
  it.each(["staff", "orders"])("edits only the active tab metric collection on %s", tab => {
    render(<Harness tab={tab} />); openPanel();
    fireEvent.click(screen.getByText("Lọc chỉ tiêu"));
    fireEvent.click(screen.getByRole("button", { name: "Thêm điều kiện" }));
    if (tab === "staff") { expect(summaryState()[0].key).toBe("orders"); expect(filterState().metrics).toEqual([]); }
    else { expect(filterState().metrics?.[0].key).toBe("durationSeconds"); expect(summaryState()).toEqual([]); }
  });
  it("clears both metric collections using the panel clear action without closing it", () => {
    render(<Harness initial={{ ...createDeliveryFilters(), completedTo: "2026-11-02", metrics: [metric("durationSeconds")] }} summary={[metric("orders")]} />);
    openPanel(); fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Xóa tất cả" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(filterState()).toEqual(createDeliveryFilters()); expect(summaryState()).toEqual([]);
  });
});

describe("delivery filter metadata", () => {
  it("exports full labels for dates and both metric collections", () => {
    const filters = { ...createDeliveryFilters(), staff: rows[0].staffKey, status: "assigned", method: "cash", tier: "custom-tier",
      invoiceStatus: "custom-status", assignedFrom: "2026-11-01", assignedTo: "2026-11-02", completedFrom: "2026-11-03", completedTo: "2026-11-04",
      metrics: [metric("durationSeconds"), metric("invoiceDebt")] };
    const descriptions = deliveryFilterDescriptions(filters, rows, true, [metric("orders"), metric("missingInvoice")]);
    expect(descriptions.find(item => item.key === "staff")?.value).toBe("Chi nhánh A · Nhân viên A");
    expect(descriptions.find(item => item.key === "assignedFrom")?.value).toBe("01/11/2026");
    expect(descriptions.filter(item => /^(assigned|completed)(From|To)$/.test(item.key))).toHaveLength(4);
    expect(descriptions.find(item => item.key === "metrics:0")?.value).toBe("Thời gian giao (giây): Có dữ liệu");
    expect(descriptions.find(item => item.key === "summaryMetrics:0")?.value).toBe("Số đơn: Có dữ liệu");
    const restricted = deliveryFilterDescriptions(filters, rows, false, [metric("orders"), metric("missingInvoice")]);
    expect(restricted.some(item => ["method", "metrics:1", "summaryMetrics:1"].includes(item.key))).toBe(false);
    expect(deliveryOrderMetricFields(false).map(field => field.key)).toEqual(["durationSeconds"]);
    expect(deliverySummaryMetricFields(false)).toHaveLength(6);
    expect(deliveryOrderMetricFields(true)).toHaveLength(5); expect(deliverySummaryMetricFields(true)).toHaveLength(11);
  });
});
