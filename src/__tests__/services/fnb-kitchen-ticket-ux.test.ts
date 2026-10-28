import { describe, expect, it, vi } from "vitest";
import { buildKitchenTicketHtml, buildKitchenTicketBytes } from "@/lib/print-fnb";

vi.mock("@/lib/printer", () => ({ printerService: { print: vi.fn() } }));

describe("kitchen ticket information hierarchy", () => {
  it.each(["compact", "standard", "detailed"] as const)("underlines only selected values on %s tickets", style => {
    const html = buildKitchenTicketHtml({ orderNumber: "TEST", orderType: "takeaway", style,
      createdAt: "2026-10-28T08:00:00Z", items: [{ name: "Cà phê", variant: "L", quantity: 1, unitPrice: 30000,
        modifierLabels: ["Mức đường: 80%", "Nhiệt độ: Nóng", "Ít béo", "Ghi chú: <script>"],
        toppings: [{ name: "Trân châu", quantity: 1, price: 5000 }], note: "Giao trước" }] });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect([...doc.querySelectorAll(".kitchen-choice")].map(el => el.textContent)).toEqual(["L", "Trân châu", "80%", "Nóng", "Ít béo", "<script>"]);
    expect(doc.querySelector(".modifier")?.textContent).toContain("Mức đường: 80%");
    expect(doc.querySelector(".note .kitchen-choice")).toBeNull();
    expect(doc.querySelector("script")).toBeNull();
  });
  it("resets underline between choice values, labels and free text in ESC/POS", () => {
    const bytes = buildKitchenTicketBytes({ orderNumber: "TEST", orderType: "takeaway", createdAt: "2026-10-28T08:00:00Z",
      items: [{ name: "Coffee", quantity: 1, unitPrice: 10, modifierLabels: ["Sugar: 80%"], note: "Deliver first" }] });
    const encoded = String.fromCharCode(...bytes);
    expect(encoded).toContain("> Sugar: \x1b-\x0180%\x1b-\x00\n");
    expect(encoded).not.toContain("\x1b-\x01> Sugar");
    expect(encoded).toContain("Deliver first");
  });
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
