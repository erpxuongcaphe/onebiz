import { describe, expect, it } from "vitest";
import {
  invoiceStatusesForKpi,
  isInvoiceKpiSelected,
  resolveInvoiceDeliveryFilter,
} from "@/lib/utils/invoice-list-filters";
import { getInvoiceShipmentQueryPlan } from "@/lib/services/supabase/invoices";

describe("Bộ lọc có/không giao hàng", () => {
  it("chọn cả hai hoặc bỏ cả hai đều không thu hẹp", () => {
    expect(resolveInvoiceDeliveryFilter(["delivery", "no_delivery"])).toBe("all");
    expect(resolveInvoiceDeliveryFilter([])).toBe("all");
  });

  it("chỉ chọn một loại thì lọc đúng loại đó", () => {
    expect(resolveInvoiceDeliveryFilter(["delivery"])).toBe("delivery");
    expect(resolveInvoiceDeliveryFilter(["no_delivery"])).toBe("no_delivery");
  });

  it("dùng inner join cho có giao hàng và anti-join cho không giao hàng", () => {
    expect(getInvoiceShipmentQueryPlan("delivery")).toEqual({
      relation: "shipments:shipping_orders!shipping_orders_invoice_id_fkey!inner(id)",
      requireNull: false,
    });
    expect(getInvoiceShipmentQueryPlan("no_delivery")).toEqual({
      relation: "shipments:shipping_orders!shipping_orders_invoice_id_fkey(id)",
      requireNull: true,
    });
    expect(getInvoiceShipmentQueryPlan("all")).toEqual({
      relation: "shipments:shipping_orders!shipping_orders_invoice_id_fkey(id)",
      requireNull: false,
    });
  });
});

describe("Bấm thẻ chỉ số để lọc trạng thái", () => {
  it("mọi trạng thái dùng mảng rỗng, các thẻ trạng thái dùng đúng mã", () => {
    expect(invoiceStatusesForKpi("all")).toEqual([]);
    expect(invoiceStatusesForKpi("completed")).toEqual(["completed"]);
    expect(invoiceStatusesForKpi("cancelled")).toEqual(["cancelled"]);
  });

  it("chỉ đánh dấu thẻ khi bộ lọc khớp chính xác", () => {
    expect(isInvoiceKpiSelected([], "all")).toBe(true);
    expect(isInvoiceKpiSelected(["completed"], "completed")).toBe(true);
    expect(isInvoiceKpiSelected(["processing", "completed"], "completed")).toBe(false);
    expect(isInvoiceKpiSelected(["cancelled"], "cancelled")).toBe(true);
  });
});

describe("Wiring màn Hóa đơn", () => {
  it("bảng và chỉ số dùng chung bộ lọc giao hàng, không còn điều khiển chết", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/app/(main)/don-hang/hoa-don/page.tsx",
      "utf8",
    );
    expect(src).toContain("commonFilters.delivery = deliveryFilter");
    expect(src).toContain("delivery: deliveryFilter");
    expect(src).not.toContain('label="Trạng thái giao hàng"');
    expect(src).not.toContain('label="Đối tác giao hàng"');
  });

  it("ba thẻ trạng thái đều nối tới cùng lệnh lọc", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/app/(main)/don-hang/hoa-don/page.tsx",
      "utf8",
    );
    expect(src).toContain('locTheoChiSo("all")');
    expect(src).toContain('locTheoChiSo("completed")');
    expect(src).toContain('locTheoChiSo("cancelled")');
  });
});
