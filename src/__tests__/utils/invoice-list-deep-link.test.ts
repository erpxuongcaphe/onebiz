import { describe, expect, it } from "vitest";
import {
  buildInvoiceListDeepLink,
  findInvoiceListRowByCode,
  getInvoiceListDeepLinkFilters,
  readInvoiceListDeepLink,
} from "@/lib/utils/invoice-list-deep-link";

describe("invoice list deep link", () => {
  it("builds an encoded link that requests the invoice detail", () => {
    expect(buildInvoiceListDeepLink("HD 001551")).toBe(
      "/don-hang/hoa-don?tim=HD+001551&mo=1",
    );
  });

  it("does not create a search link from an empty invoice code", () => {
    expect(buildInvoiceListDeepLink("  ")).toBe("/don-hang/hoa-don");
  });

  it("reads a direct-open link without treating a normal search as an open request", () => {
    expect(readInvoiceListDeepLink("?tim=HD001551&mo=1")).toEqual({
      code: "HD001551",
      openDetail: true,
    });
    expect(readInvoiceListDeepLink("?tim=HD001551")).toEqual({
      code: "HD001551",
      openDetail: false,
    });
  });

  it("opens only the matching invoice row", () => {
    const rows = [{ code: "HD001550" }, { code: "HD001551" }];

    expect(findInvoiceListRowByCode(rows, "HD001551")).toBe(1);
    expect(findInvoiceListRowByCode(rows, "HD001599")).toBe(-1);
  });

  it("clears local list filters only for a direct-open link", () => {
    expect(
      getInvoiceListDeepLinkFilters(readInvoiceListDeepLink("?tim=HD001551&mo=1")),
    ).toEqual({
      datePreset: "all",
      statuses: [],
      types: ["no_delivery", "delivery"],
    });
    expect(
      getInvoiceListDeepLinkFilters(readInvoiceListDeepLink("?tim=HD001551")),
    ).toEqual({ datePreset: null, statuses: null, types: null });
  });
});
