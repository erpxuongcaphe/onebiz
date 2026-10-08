import type { KitchenTicketDataV2 } from "./print-fnb";
import type { PrintTemplateConfig, ResolvedPrint } from "./services/supabase/print-templates-engine";

export function applyKitchenTemplate(data: KitchenTicketDataV2, config: PrintTemplateConfig, paperSize: string): KitchenTicketDataV2 {
  return {...data, thermalLayout:config.thermal, title:config.title?.trim() || undefined, itemFontSize:config.items?.fontSize,
    footerText:config.footer?.customText?.trim() || undefined,
    style:config.kitchen?.style ?? "standard",
    paperSize:paperSize === "58mm" ? "58mm" : "80mm"};
}

export async function resolveKitchenPrintTemplate(branchId: string): Promise<ResolvedPrint | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  // Read once per batch. Offline/missing template keeps the built-in ticket.
  try {
    const { resolvePrintTemplate } = await import("./services/supabase/print-templates-engine");
    return await resolvePrintTemplate("fnb", "kitchen_ticket", branchId);
  } catch (error) {
    console.warn("[kitchen-print] Dùng phiếu mặc định vì không tải được mẫu:", error);
    return null;
  }
}
