import { describe, it, expect, vi } from "vitest";

// Mock 3 module anh em để import applyTemplateToDocData KHÔNG kéo supabase/print thật.
// applyTemplateToDocData tự thân không gọi printDocument/resolve/getResolvedBrand;
// buildVietQrUrl chỉ chạy khi showQr=true (các test dưới không bật).
vi.mock("@/lib/print-document", () => ({ printDocument: vi.fn() }));
vi.mock("@/lib/services", () => ({
  resolvePrintTemplate: vi.fn(),
  getResolvedBrand: vi.fn(),
}));
vi.mock("@/lib/vietqr", () => ({ buildVietQrUrl: vi.fn(() => "http://qr") }));

import { applyTemplateToDocData } from "@/lib/print-apply-template";

/** Hoá đơn mẫu: headerFields đúng như buildInvoicePrintData sinh (nhãn khách). */
function makeBase() {
  return {
    documentType: "HOÁ ĐƠN BÁN HÀNG",
    documentCode: "HD-0001",
    date: "30/06/2026",
    headerFields: [
      { label: "Khách hàng", value: "Nguyễn Văn A" },
      { label: "Mã KH", value: "KH00123" },
      { label: "Điện thoại", value: "0912345678" },
      { label: "Địa chỉ", value: "45 Lê Lợi" },
      { label: "Người tạo", value: "Thu ngân" },
    ],
    items: [],
  } as any;
}

function resolvedWith(customer: Record<string, boolean> | undefined) {
  return { brand: {}, config: { customer }, paperSize: "A4" } as any;
}

const labels = (d: { headerFields?: { label: string }[] }) =>
  (d.headerFields ?? []).map((f) => f.label);

describe("applyTemplateToDocData — lọc khách hàng theo toggle", () => {
  it("tắt Mã KH + Địa chỉ → ẩn đúng 2 dòng, giữ phần còn lại", () => {
    const out = applyTemplateToDocData(makeBase(), resolvedWith({
      name: true,
      code: false,
      phone: true,
      address: false,
    }));
    expect(labels(out)).toEqual(["Khách hàng", "Điện thoại", "Người tạo"]);
  });

  it("tắt Tên khách + Điện thoại → ẩn đúng 2 dòng đó", () => {
    const out = applyTemplateToDocData(makeBase(), resolvedWith({
      name: false,
      code: true,
      phone: false,
      address: true,
    }));
    expect(labels(out)).toEqual(["Mã KH", "Địa chỉ", "Người tạo"]);
  });

  it("tất cả bật → headerFields GIỮ NGUYÊN (zero-regression)", () => {
    const out = applyTemplateToDocData(makeBase(), resolvedWith({
      name: true,
      code: true,
      phone: true,
      address: true,
    }));
    expect(labels(out)).toEqual([
      "Khách hàng",
      "Mã KH",
      "Điện thoại",
      "Địa chỉ",
      "Người tạo",
    ]);
  });

  it("KHÔNG có config.customer (phiếu NCC/kho) → giữ nguyên", () => {
    const base = {
      documentType: "PHIẾU NHẬP HÀNG",
      documentCode: "PN-0001",
      date: "30/06/2026",
      headerFields: [{ label: "Nhà cung cấp", value: "Milkman" }],
      items: [],
    } as any;
    const out = applyTemplateToDocData(base, resolvedWith(undefined));
    expect(labels(out)).toEqual(["Nhà cung cấp"]);
  });

  it("KHÔNG đột biến base gốc (immutability)", () => {
    const base = makeBase();
    const before = base.headerFields.length;
    applyTemplateToDocData(base, resolvedWith({ code: false } as any));
    expect(base.headerFields.length).toBe(before); // base vẫn đủ 5 dòng
  });
});
