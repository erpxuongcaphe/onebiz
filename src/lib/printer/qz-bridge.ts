import type { PaperSize } from "@/lib/print-document";

export type BridgeRole = "cashier" | "kitchen" | "documents";
const key = (role: BridgeRole, branchId?: string, stationId?: string) =>
  `onebiz_qz_printer:${branchId ?? "this-machine"}:${stationId ?? role}`;

export function loadBridgePrinter(role: BridgeRole, branchId?: string, stationId?: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key(role, branchId, stationId)) || null; } catch { return null; }
}
export function saveBridgePrinter(role: BridgeRole, name: string, branchId?: string, stationId?: string): void {
  const storageKey = key(role, branchId, stationId);
  if (name.trim()) localStorage.setItem(storageKey, name.trim());
  else localStorage.removeItem(storageKey);
}

let connecting: Promise<void> | undefined;
async function connection() {
  const { default: qz } = await import("qz-tray");
  if (!qz.websocket.isActive()) {
    connecting ??= qz.websocket.connect({ retries: 0 }).then(() => undefined).finally(() => { connecting = undefined; });
    await connecting;
  }
  return qz;
}
export async function findBridgePrinters(): Promise<string[]> {
  const qz = await connection();
  const printers = await qz.printers.find();
  return Array.isArray(printers) ? printers : [printers];
}

/** QZ receives print-only HTML, never the auto-print scripts used by browser windows. */
export function bridgeHtml(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?(?:<\\?\/script\s*>|$)/gi, "");
}

export async function printViaBridge(html: string, printer: string, paperSize: PaperSize): Promise<void> {
  const qz = await connection();
  const available = await qz.printers.find();
  const names = Array.isArray(available) ? available : [available];
  if (!names.includes(printer)) throw new Error(`Máy “${printer}” không còn trong danh sách. Hãy tìm và chọn lại máy in.`);
  const cleanHtml = bridgeHtml(html);
  const width = paperSize === "58mm" ? 58 : paperSize === "80mm" ? 80 : paperSize === "A5" ? 148 : 210;
  let height = paperSize === "A5" ? 210 : 297;
  if (paperSize === "58mm" || paperSize === "80mm") {
    // Measure the actual receipt so long orders aren't shrunk onto a fixed sheet.
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width / 25.4 * 96}px;height:1px;border:0;visibility:hidden`;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Dựng bản in quá thời gian.")), 5000);
        frame.onload = () => { clearTimeout(timer); resolve(); };
        frame.srcdoc = cleanHtml;
        document.body.appendChild(frame);
      });
      const body = frame.contentDocument?.body;
      if (!body) throw new Error("Không dựng được bản in. Hãy dùng in qua trình duyệt.");
      await Promise.race([
        Promise.all(Array.from(body.querySelectorAll("img")).map(img => img.decode())),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Không tải đủ logo/QR. Kiểm tra mạng rồi in lại.")), 8000)),
      ]);
      height = Math.max(40, Math.ceil(Math.max(body.scrollHeight, frame.contentDocument!.documentElement.scrollHeight) / 96 * 25.4) + 8);
    } finally { frame.remove(); }
  }
  const config = qz.configs.create(printer, { units: "in", size: { width: width / 25.4, height: height / 25.4 }, margins: 0, scaleContent: false, jobName: "ONEBIZ" });
  await qz.print(config, [{ type: "pixel", format: "html", flavor: "plain", data: cleanHtml, options: { pageWidth: width / 25.4, pageHeight: height / 25.4 } }]);
}
