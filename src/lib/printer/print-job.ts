import { printerService, type PrintResult, type PrinterBackend } from "./printer-service";
import type { PaperSize } from "@/lib/print-document";
import type { StoredPrinter } from "./webusb-printer";
import type { BridgeRole } from "./qz-bridge";

export function getPrintSettings(): { backend: PrinterBackend; paperSize: PaperSize; openCashDrawer: boolean; fnbBranchQueue: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem("onebiz_settings") ?? "{}").print ?? {};
    return { backend: p.backend === "escpos-usb" || p.backend === "qz-tray" ? p.backend : "browser", paperSize: ["58mm", "80mm", "A4", "A5"].includes(p.paperSize) ? p.paperSize : "80mm", openCashDrawer: p.openCashDrawer === true, fnbBranchQueue: p.fnbBranchQueue === true };
  } catch { return { backend: "browser", paperSize: "80mm", openCashDrawer: false, fnbBranchQueue: false }; }
}

export function reportPrintResult(result: PrintResult): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("onebiz-print-result", {detail:result}));
  if ((result.warning || !result.success) && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fnb-print-failed", { detail: { message: result.warning ?? "Không gửi được lệnh in. Hãy kiểm tra máy và thử lại." } }));
  }
}

export async function sendPrintJob(args: { html: string; bytes?: Uint8Array; paperSize: PaperSize; role?: BridgeRole; printer?: StoredPrinter; bridgePrinter?: string; openCashDrawer?: boolean; branchId?: string; stationId?: string; label?: string; jobId?: string; buildHtml?: (paper: "58mm" | "80mm") => string }): Promise<PrintResult> {
  const {backend, fnbBranchQueue} = getPrintSettings();
  if (fnbBranchQueue && args.branchId && args.role !== "documents") {
    let result: PrintResult;
    try {
      if (!args.branchId || args.role === "documents") throw new Error("Chưa có chi nhánh/nơi nhận F&B. Với chứng từ ERP, chọn phương thức in thủ công trong Cài đặt → In ấn.");
      const { enqueueBranchPrint } = await import("./branch-queue");
      const job = await enqueueBranchPrint({ branchId: args.branchId, routeKey: args.stationId ?? args.role ?? "cashier", label: args.label ?? "Phiếu F&B", html: args.html, paper: args.paperSize, buildHtml: args.buildHtml, jobId: args.jobId ?? crypto.randomUUID() });
      result = { success: true, backend: "branch-queue", queued: { id: job.id, routeLabel: job.route_label } };
    } catch (error) { result = { success: false, backend: "branch-queue", warning: `${error instanceof Error ? error.message : "Chưa gửi được phiếu."} Nếu mạng ngắt trong lúc gửi, xem lịch sử lệnh trước khi gửi lại.` }; }
    reportPrintResult(result); return result;
  }
  let bytes = args.bytes;
  if (backend === "escpos-usb" && !bytes && (args.paperSize === "58mm" || args.paperSize === "80mm")) {
    try {
      const {rasterPrintBytes} = await import("./raster-print");
      bytes = await rasterPrintBytes(args.html,args.paperSize);
    } catch (error) {
      const result = await printerService.printRaw({rawHtml:args.html,backend:"browser"});
      result.fallback = true;
      result.warning = `Không dựng được bản USB (${error instanceof Error ? error.message : String(error)}). ${result.success ? "Đã mở hộp thoại in." : result.warning ?? "Không mở được hộp thoại in."}`;
      reportPrintResult(result);
      return result;
    }
  }
  const result = await printerService.printRaw({ rawHtml: args.html, escposBytes: bytes, paperSize: args.paperSize, role: args.role === "documents" ? undefined : args.role, bridgeRole: args.role, printer: args.printer, bridgePrinter: args.bridgePrinter, openCashDrawer: args.openCashDrawer, backend });
  reportPrintResult(result);
  return result;
}
