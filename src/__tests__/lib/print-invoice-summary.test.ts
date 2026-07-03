import { describe, it, expect } from "vitest";
import { buildInvoicePrintData } from "@/lib/print-templates";

type InvoiceRow = Parameters<typeof buildInvoicePrintData>[0];

/** Hoá đơn tối thiểu cho khối tổng tiền (CEO 03/07: nhãn Khách đã thanh toán). */
function row(over: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "x",
    code: "HD001330",
    date: "03/07/2026",
    customerName: "Chị Diễm Châu",
    customerCode: "KHA-KLE-047",
    customerPhone: "",
    customerAddress: "",
    createdBy: "Nguyễn Thị Huyền Trang",
    totalAmount: 350000,
    discount: 0,
    paid: 350000,
    debt: 0,
    customerId: undefined,
    customerCurrentDebt: undefined,
    ...over,
  } as unknown as InvoiceRow;
}

const labels = (d: { summaryRows?: { label: string }[] }) =>
  (d.summaryRows ?? []).map((r) => r.label);

describe("buildInvoicePrintData — khối tổng tiền rõ nghĩa", () => {
  it("đã trả đủ → 'Khách đã thanh toán', KHÔNG còn nhãn cũ, không thối/còn lại", () => {
    const d = buildInvoicePrintData(row());
    expect(labels(d)).toContain("Khách đã thanh toán");
    expect(labels(d)).not.toContain("Khách thanh toán");
    expect(labels(d)).not.toContain("Tiền thối lại");
    expect(labels(d)).not.toContain("Còn lại");
  });

  it("khách đưa dư (paid > tổng) → thêm 'Tiền thối lại' đúng số", () => {
    const d = buildInvoicePrintData(row({ paid: 400000 } as Partial<InvoiceRow>));
    const thoi = d.summaryRows?.find((r) => r.label === "Tiền thối lại");
    expect(thoi?.value).toContain("50"); // 400.000 - 350.000 = 50.000
  });

  it("trả thiếu + KHÔNG in khối nợ → thêm 'Còn lại' (kẻo tưởng thu đủ)", () => {
    const d = buildInvoicePrintData(row({ paid: 200000 } as Partial<InvoiceRow>));
    const conLai = d.summaryRows?.find((r) => r.label === "Còn lại");
    expect(conLai).toBeTruthy();
    expect(conLai?.value).toContain("150"); // 350.000 - 200.000
  });

  it("khách công nợ (khối nợ in) → giữ 'Nợ cũ' + 'Còn nợ', KHÔNG thêm 'Còn lại' trùng", () => {
    const d = buildInvoicePrintData(
      row({
        paid: 200000,
        debt: 150000,
        customerId: "kh-1",
        customerCurrentDebt: 150000,
      } as Partial<InvoiceRow>),
    );
    expect(labels(d)).toContain("Nợ cũ");
    expect(labels(d)).toContain("Còn nợ");
    expect(labels(d)).not.toContain("Còn lại");
  });
});
