import { describe, expect, it, vi } from "vitest";
import { buildKitchenTicketHtml } from "@/lib/print-fnb";

vi.mock("@/lib/printer", () => ({ printerService: { print: vi.fn() } }));

describe("kitchen ticket information hierarchy", () => {
  it.each(["58mm", "80mm"] as const)("keeps preparation information and long references on %s", (paperSize) => {
    const code = "FNB-20261005-REFERENCE-12345678901234567890";
    const html = buildKitchenTicketHtml({
      orderNumber: code, tableName: "Bàn 12", orderType: "dine_in", paperSize,
      createdAt: "2026-10-05T08:20:36Z", stationName: "BAR PHA CHẾ",
      isSupplement: true, isOffline: true, orderNote: "Khách dị ứng sữa",
      items: [{ name: "Cacao", quantity: 3, unitPrice: 35000,
        modifierLabels: ["Mức đường: 50%"], note: "Đá riêng" }],
    });
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector(".table-label")?.textContent).toContain("Bàn 12");
    expect(document.querySelector(".order-number")?.textContent).toContain(code);
    expect(document.querySelector(".table-label")!.compareDocumentPosition(document.querySelector(".order-number")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector(".qty")?.textContent).toBe("3x");
    for (const detail of ["BAR PHA CHẾ", "Cacao", "Mức đường: 50%", "Đá riêng", "Khách dị ứng sữa", "CHỜ ĐỒNG BỘ", "BỔ SUNG"]) {
      expect(document.body.textContent).toContain(detail);
    }
  });
});
