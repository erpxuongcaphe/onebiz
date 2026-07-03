import { describe, it, expect } from "vitest";
import { buildInvoicePrintData } from "@/lib/print-templates";

type InvoiceRow = Parameters<typeof buildInvoicePrintData>[0];

/** Hoá đơn tối thiểu cho khối tổng tiền (CEO 03/07: cặp đối xứng đã trả / còn phải trả). */
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
const find = (
  d: { summaryRows?: { label: string; value: string; tone?: string }[] },
  label: string,
) => (d.summaryRows ?? []).find((r) => r.label === label);

describe("buildInvoicePrintData — khối tổng tiền đối xứng, rõ nghĩa", () => {
  it("trả đủ → 'Khách còn phải trả' = 0 đ (tone success), không thối lại, không nhãn cũ", () => {
    const d = buildInvoicePrintData(row());
    expect(labels(d)).toContain("Khách đã thanh toán");
    const con = find(d, "Khách còn phải trả");
    expect(con?.value).toBe("0 đ");
    expect(con?.tone).toBe("success");
    expect(labels(d)).not.toContain("Khách thanh toán"); // nhãn cũ mơ hồ
    expect(labels(d)).not.toContain("Còn lại"); // nhãn cũ
    expect(labels(d)).not.toContain("Tiền thối lại");
  });

  it("chưa trả đồng nào → 'Khách đã thanh toán' = 0 đ + 'Khách còn phải trả' = tổng (tone danger)", () => {
    const d = buildInvoicePrintData(row({ paid: 0 } as Partial<InvoiceRow>));
    expect(find(d, "Khách đã thanh toán")?.value).toBe("0 đ");
    const con = find(d, "Khách còn phải trả");
    expect(con?.value).toContain("350"); // 350.000 đ
    expect(con?.tone).toBe("danger");
  });

  it("trả thiếu → 'Khách còn phải trả' đúng số (tone danger), KHÔNG dùng nhãn cũ 'Còn lại'", () => {
    const d = buildInvoicePrintData(row({ paid: 200000 } as Partial<InvoiceRow>));
    const con = find(d, "Khách còn phải trả");
    expect(con?.value).toContain("150"); // 350.000 - 200.000
    expect(con?.tone).toBe("danger");
    expect(labels(d)).not.toContain("Còn lại");
  });

  it("khách đưa dư (paid > tổng) → 'Khách còn phải trả' = 0 đ + thêm 'Tiền thối lại' đúng số", () => {
    const d = buildInvoicePrintData(row({ paid: 400000 } as Partial<InvoiceRow>));
    const con = find(d, "Khách còn phải trả");
    expect(con?.value).toBe("0 đ");
    expect(con?.tone).toBe("success");
    expect(find(d, "Tiền thối lại")?.value).toContain("50"); // 400.000 - 350.000
  });

  it("khách công nợ (khối nợ in) → giữ 'Nợ cũ' + 'Còn nợ', KHÔNG thêm 'Khách còn phải trả' trùng", () => {
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
    expect(labels(d)).not.toContain("Khách còn phải trả");
    expect(labels(d)).not.toContain("Còn lại");
  });
});
