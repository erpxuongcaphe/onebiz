import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";
import { buildKitchenTicketHtml, type KitchenTicketDataV2 } from "@/lib/print-fnb";
import { applyKitchenTemplate } from "@/lib/kitchen-print-template";
import { applyTemplateToDocData } from "@/lib/print-apply-template";
import { resolvePrintTemplate } from "@/lib/services/supabase/print-templates-engine";
import type { PrintRoute, BranchPrintPolicy } from "./branch-queue";
import type { PaperWidth } from "./escpos";

/** Test the saved branch template without creating a bill or collecting money. */
export async function resolveBranchPrintTestBuilder(branchId: string, route: PrintRoute, kitchenStyle: BranchPrintPolicy["kitchenTicketStyle"], date: string) {
  const cashier = route.key === "cashier";
  const resolved = await resolvePrintTemplate("fnb", cashier ? "sale_invoice" : "kitchen_ticket", branchId);
  return (paper: PaperWidth) => {
    if (cashier) {
      const base: DocumentPrintData = {
        fnbThermalReadable: true, documentType: "DỮ LIỆU IN THỬ", documentCode: "TEST-ONEBIZ", date,
        headerFields: [{ label: "Nơi nhận", value: route.label }],
        items: [{ name: "Cà phê sữa đá", quantity: 2, unitPrice: 35000, total: 70000, note: "Đường 70% • ít đá • thêm trân châu" }],
        summaryRows: [{ label: "Tổng thử", value: "70.000 đ", bold: true }], showSignature: false,
        note: "Phiếu thử không ghi nhận doanh thu. Kiểm tra chữ, lề và dao cắt.",
      };
      const data = resolved ? applyTemplateToDocData(base, resolved) : base;
      // Keep the test unmistakable; no payable QR on a synthetic amount.
      data.documentType = "DỮ LIỆU IN THỬ";
      data.qrImageUrl = undefined;
      return generateDocumentHtml(data, paper);
    }
    const base: KitchenTicketDataV2 = {
      title: "IN THỬ BAR / BẾP", orderNumber: "TEST-ONEBIZ", tableName: "Bàn thử", orderType: "dine_in", createdAt: date,
      stationName: route.label, paperSize: paper, style: kitchenStyle ?? "compact",
      items: [{ name: "Cà phê sữa đá", quantity: 2, unitPrice: 35000, modifierLabels: ["Đường: 70%", "Đá: Ít"], note: "Thêm trân châu" }],
      footerText: "DỮ LIỆU THỬ — KHÔNG GHI DOANH THU",
    };
    const data = resolved ? applyKitchenTemplate(base, resolved.config, paper) : base;
    data.title = "IN THỬ BAR / BẾP";
    data.footerText = base.footerText;
    return buildKitchenTicketHtml(data);
  };
}
