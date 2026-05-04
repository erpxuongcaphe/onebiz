/**
 * Printer Service — Facade cho mọi print operation
 * ------------------------------------------------------------
 * Abstraction layer giúp POS/Invoice/Kitchen có 1 API duy nhất,
 * không cần quan tâm đang in qua browser hay USB.
 *
 * Flow:
 *   1. User chọn backend trong Cài đặt → In ấn
 *      - "browser"    → dùng window.print() dialog (mặc định — mọi máy in)
 *      - "escpos-usb" → dùng WebUSB + ESC/POS byte stream (silent, tức thì)
 *   2. Mỗi call printReceipt(data) sẽ dispatch theo backend
 *   3. Nếu USB backend fail (không kết nối / device disconnect / WebUSB
 *      không support) → TỰ ĐỘNG FALLBACK browser → không bao giờ gãy flow
 *
 * Lý do tách service:
 *   - Call site (POS FnB, POS Retail, Invoice detail) chỉ gọi
 *     `printerService.printReceipt(data)` — không biết chi tiết backend
 *   - Thêm backend mới (Bluetooth, LAN print server) không cần sửa call site
 *   - Test: mock service trong unit test dễ hơn mock window.open
 */

import { EscPosBuilder, type PaperWidth } from "./escpos";
import {
  isWebUsbSupported,
  loadPrinter,
  sendToUsbPrinter,
  type StoredPrinter,
} from "./webusb-printer";
import { formatNumber, formatDate } from "@/lib/format";

// ─── Types ───

export type PrinterBackend = "browser" | "escpos-usb";

export interface PrintReceiptPayload {
  // Header
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  storeTaxCode?: string;

  // Invoice meta
  invoiceCode: string;
  createdAt: string;
  cashierName?: string;
  customerName?: string;
  tableName?: string;
  orderType?: "dine_in" | "takeaway" | "delivery" | "retail";

  // Items
  items: Array<{
    name: string;
    variant?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;

  // Totals
  subtotal: number;
  discountAmount?: number;
  deliveryFee?: number;
  taxAmount?: number;
  /** Tiền tip FnB — hiển thị tách riêng trên phiếu (đã cộng vào total). */
  tipAmount?: number;
  total: number;
  paid: number;
  change?: number;
  debt?: number;
  paymentMethod: string;

  // Footer
  footer?: string;

  // Config
  paperSize?: PaperWidth;
}

export interface PrintResult {
  success: boolean;
  backend: PrinterBackend;
  /** true = đã fallback sang browser vì USB fail */
  fallback?: boolean;
  /** Error message nếu có vấn đề (vẫn success nếu fallback OK) */
  warning?: string;
}

// ─── Format helpers ───

function formatVnd(n: number): string {
  return formatNumber(Math.round(n));
}

function formatTime(iso: string): string {
  try {
    return formatDate(iso);
  } catch {
    return iso;
  }
}

const PAYMENT_METHOD_VN: Record<string, string> = {
  cash: "Tien mat",
  transfer: "Chuyen khoan",
  card: "The",
  mixed: "Hon hop",
};

const ORDER_TYPE_VN: Record<string, string> = {
  dine_in: "Tai quan",
  takeaway: "Mang ve",
  delivery: "Giao hang",
  retail: "Ban le",
};

// ─── ESC/POS byte builder ───

function buildReceiptBytes(payload: PrintReceiptPayload): Uint8Array {
  const width = payload.paperSize ?? "80mm";
  const builder = new EscPosBuilder(width);

  // Header — store info
  if (payload.storeName) {
    builder.text(payload.storeName, { align: "center", bold: true, size: "double" });
  }
  if (payload.storeAddress) {
    builder.text(payload.storeAddress, { align: "center" });
  }
  if (payload.storePhone) {
    builder.text(`DT: ${payload.storePhone}`, { align: "center" });
  }
  if (payload.storeTaxCode) {
    builder.text(`MST: ${payload.storeTaxCode}`, { align: "center" });
  }

  builder.divider();

  // Invoice title
  builder.text("HOA DON BAN HANG", { align: "center", bold: true, size: "double" });
  builder.newline();

  // Meta
  builder.text(`So: ${payload.invoiceCode}`);
  builder.text(`Ngay: ${formatTime(payload.createdAt)}`);
  if (payload.cashierName) builder.text(`Thu ngan: ${payload.cashierName}`);
  if (payload.customerName) builder.text(`Khach: ${payload.customerName}`);
  if (payload.tableName) builder.text(`Ban: ${payload.tableName}`);
  if (payload.orderType && ORDER_TYPE_VN[payload.orderType]) {
    builder.text(`Loai: ${ORDER_TYPE_VN[payload.orderType]}`);
  }

  builder.divider();

  // Items header
  builder.bold(true);
  builder.textTwoColumns("Mat hang", "T.Tien");
  builder.bold(false);
  builder.text("-".repeat(builder.getWidth() > 32 ? 48 : 32));

  // Items
  for (const item of payload.items) {
    const name = item.variant ? `${item.name} (${item.variant})` : item.name;
    builder.text(name);
    const qtyPrice = `${item.quantity} x ${formatVnd(item.unitPrice)}`;
    builder.textTwoColumns(`  ${qtyPrice}`, formatVnd(item.total));
  }

  builder.divider();

  // Totals
  builder.textTwoColumns("Tam tinh:", formatVnd(payload.subtotal));
  if (payload.discountAmount && payload.discountAmount > 0) {
    builder.textTwoColumns("Giam gia:", `-${formatVnd(payload.discountAmount)}`);
  }
  if (payload.deliveryFee && payload.deliveryFee > 0) {
    builder.textTwoColumns("Phi giao hang:", formatVnd(payload.deliveryFee));
  }
  if (payload.taxAmount && payload.taxAmount > 0) {
    builder.textTwoColumns("VAT:", formatVnd(payload.taxAmount));
  }
  if (payload.tipAmount && payload.tipAmount > 0) {
    builder.textTwoColumns("Tien tip:", `+${formatVnd(payload.tipAmount)}`);
  }

  builder.bold(true).size("double");
  builder.textTwoColumns("TONG:", formatVnd(payload.total));
  builder.size("normal").bold(false);

  // Payment
  builder.newline();
  builder.textTwoColumns(
    `Thanh toan (${PAYMENT_METHOD_VN[payload.paymentMethod] ?? payload.paymentMethod}):`,
    formatVnd(payload.paid)
  );
  if (payload.change && payload.change > 0) {
    builder.textTwoColumns("Tien thoi:", formatVnd(payload.change));
  }
  if (payload.debt && payload.debt > 0) {
    builder.textTwoColumns("Con no:", formatVnd(payload.debt));
  }

  // Footer
  if (payload.footer) {
    builder.newline();
    builder.text(payload.footer, { align: "center" });
  } else {
    builder.newline();
    builder.text("Cam on quy khach!", { align: "center" });
  }

  // Feed + cut handled in build()
  return builder.build();
}

// ─── Browser fallback — HTML preview ───

/**
 * Build HTML giống format ESC/POS cho browser preview.
 * Dùng khi backend=browser hoặc fallback từ USB.
 *
 * Lưu ý: Repo đã có `printFnbReceipt` và `printReceiptDirect` với HTML
 * template xịn hơn (có ảnh nền, font VN). Function này là fallback tối
 * giản — call site nên dùng function cũ nếu muốn format đẹp.
 */
function buildReceiptHtml(payload: PrintReceiptPayload): string {
  const width = payload.paperSize === "58mm" ? 220 : 302;
  const pageSize = payload.paperSize === "58mm" ? "58mm" : "80mm";

  const itemRows = payload.items
    .map((it) => {
      const name = it.variant ? `${it.name} (${it.variant})` : it.name;
      return `
        <tr><td colspan="2">${escapeHtml(name)}</td></tr>
        <tr>
          <td style="padding-left:8px">${it.quantity} x ${formatVnd(it.unitPrice)}</td>
          <td class="right">${formatVnd(it.total)}</td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(payload.invoiceCode)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:12px;width:${width}px;margin:0 auto;padding:8px;color:#000}
.center{text-align:center}
.right{text-align:right}
.bold{font-weight:bold}
.big{font-size:16px}
.line{border-top:2px dashed #000;margin:6px 0}
table{width:100%;border-collapse:collapse}
td{padding:1px 0;font-size:12px;vertical-align:top}
@media print{body{width:${width}px}@page{size:${pageSize} auto;margin:0}}
</style></head>
<body>
${payload.storeName ? `<div class="center bold big">${escapeHtml(payload.storeName)}</div>` : ""}
${payload.storeAddress ? `<div class="center">${escapeHtml(payload.storeAddress)}</div>` : ""}
${payload.storePhone ? `<div class="center">ĐT: ${escapeHtml(payload.storePhone)}</div>` : ""}
<div class="line"></div>
<div class="center bold big">HÓA ĐƠN BÁN HÀNG</div>
<div>Số: ${escapeHtml(payload.invoiceCode)}</div>
<div>Ngày: ${formatTime(payload.createdAt)}</div>
${payload.cashierName ? `<div>Thu ngân: ${escapeHtml(payload.cashierName)}</div>` : ""}
${payload.customerName ? `<div>Khách: ${escapeHtml(payload.customerName)}</div>` : ""}
${payload.tableName ? `<div>Bàn: ${escapeHtml(payload.tableName)}</div>` : ""}
<div class="line"></div>
<table>${itemRows}</table>
<div class="line"></div>
<table>
  <tr><td>Tạm tính:</td><td class="right">${formatVnd(payload.subtotal)}</td></tr>
  ${payload.discountAmount ? `<tr><td>Giảm giá:</td><td class="right">-${formatVnd(payload.discountAmount)}</td></tr>` : ""}
  ${payload.deliveryFee ? `<tr><td>Phí giao:</td><td class="right">${formatVnd(payload.deliveryFee)}</td></tr>` : ""}
  ${payload.taxAmount ? `<tr><td>VAT:</td><td class="right">${formatVnd(payload.taxAmount)}</td></tr>` : ""}
  ${payload.tipAmount && payload.tipAmount > 0 ? `<tr><td>Tiền tip:</td><td class="right">+${formatVnd(payload.tipAmount)}</td></tr>` : ""}
  <tr class="bold big"><td>TỔNG:</td><td class="right">${formatVnd(payload.total)}</td></tr>
</table>
<div style="margin-top:6px">
  <div>Thanh toán (${PAYMENT_METHOD_VN[payload.paymentMethod] ?? payload.paymentMethod}): ${formatVnd(payload.paid)}</div>
  ${payload.change && payload.change > 0 ? `<div>Tiền thối: ${formatVnd(payload.change)}</div>` : ""}
  ${payload.debt && payload.debt > 0 ? `<div>Còn nợ: ${formatVnd(payload.debt)}</div>` : ""}
</div>
<div class="center" style="margin-top:8px">${escapeHtml(payload.footer ?? "Cảm ơn quý khách!")}</div>
<script>window.print();setTimeout(()=>window.close(),1500);</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c] ?? c);
}

function openBrowserPrint(html: string): void {
  const win = window.open("", "_blank", "width=400,height=700");
  if (!win) {
    throw new Error("Không mở được cửa sổ in — vui lòng cho phép popup");
  }
  win.document.write(html);
  win.document.close();
  win.focus();
}

// ─── Main API ───

export interface PrinterServiceOptions {
  /** Override backend tạm thời (không đổi setting) */
  backend?: PrinterBackend;
  /** Mở ngăn kéo sau khi in (chỉ hoạt động với escpos-usb + cash payment) */
  openCashDrawer?: boolean;
  /** Nếu true, in raw HTML thay vì đi qua PrinterService format
   *  (dùng khi call site đã có HTML xịn như printFnbReceipt) */
  rawHtml?: string;
}

export class PrinterService {
  /** Backend mặc định — set từ Settings */
  private configuredBackend: PrinterBackend = "browser";

  setBackend(backend: PrinterBackend): void {
    this.configuredBackend = backend;
  }

  getBackend(): PrinterBackend {
    return this.configuredBackend;
  }

  getStoredPrinter(): StoredPrinter | null {
    return loadPrinter();
  }

  /**
   * In hoá đơn. Tự động fallback browser nếu USB lỗi.
   * Không throw — luôn in bằng cách nào đó hoặc return warning.
   */
  async printReceipt(
    payload: PrintReceiptPayload,
    options: PrinterServiceOptions = {}
  ): Promise<PrintResult> {
    const backend = options.backend ?? this.configuredBackend;

    // ─── Browser backend ───
    if (backend === "browser") {
      try {
        const html = options.rawHtml ?? buildReceiptHtml(payload);
        openBrowserPrint(html);
        return { success: true, backend: "browser" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, backend: "browser", warning: msg };
      }
    }

    // ─── ESC/POS USB backend ───
    if (!isWebUsbSupported()) {
      return this.fallbackToBrowser(
        payload,
        options,
        "Trình duyệt không hỗ trợ WebUSB — đã chuyển sang in qua trình duyệt"
      );
    }

    const printer = loadPrinter();
    if (!printer) {
      return this.fallbackToBrowser(
        payload,
        options,
        "Chưa kết nối máy in USB — đã in qua trình duyệt. Vui lòng vào Cài đặt để kết nối."
      );
    }

    try {
      const bytes = buildReceiptBytes(payload);
      await sendToUsbPrinter(printer.vendorId, printer.productId, bytes);

      // Optional: mở ngăn kéo nếu thanh toán tiền mặt
      if (options.openCashDrawer && payload.paymentMethod === "cash") {
        const drawerBytes = new EscPosBuilder(payload.paperSize).openDrawer().buildRaw();
        try {
          await sendToUsbPrinter(printer.vendorId, printer.productId, drawerBytes);
        } catch {
          // Ignore drawer errors — not critical
        }
      }

      return { success: true, backend: "escpos-usb" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.fallbackToBrowser(
        payload,
        options,
        `Máy in USB lỗi (${msg}) — đã in qua trình duyệt`
      );
    }
  }

  /**
   * In raw — dành cho call site đã tự build HTML + ESC/POS bytes.
   * Bypass toàn bộ logic format hoá đơn của service. Dùng cho:
   *   - Báo cáo ca X/Z (print-shift-report.ts)
   *   - Kitchen ticket (print-fnb.ts)
   *   - Pre-bill
   *
   * Fallback: nếu USB lỗi → mở browser print với rawHtml.
   */
  async printRaw(args: {
    rawHtml: string;
    escposBytes?: Uint8Array;
    backend?: PrinterBackend;
    openCashDrawer?: boolean;
  }): Promise<PrintResult> {
    const backend = args.backend ?? this.configuredBackend;

    if (backend === "browser" || !args.escposBytes) {
      try {
        openBrowserPrint(args.rawHtml);
        return { success: true, backend: "browser" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, backend: "browser", warning: msg };
      }
    }

    if (!isWebUsbSupported()) {
      return this.fallbackRawToBrowser(args.rawHtml, "Trình duyệt không hỗ trợ WebUSB — đã chuyển sang in qua trình duyệt");
    }
    const printer = loadPrinter();
    if (!printer) {
      return this.fallbackRawToBrowser(args.rawHtml, "Chưa kết nối máy in USB — đã in qua trình duyệt");
    }

    try {
      await sendToUsbPrinter(printer.vendorId, printer.productId, args.escposBytes);

      if (args.openCashDrawer) {
        const drawerBytes = new EscPosBuilder().openDrawer().buildRaw();
        try {
          await sendToUsbPrinter(printer.vendorId, printer.productId, drawerBytes);
        } catch {
          /* ignore */
        }
      }
      return { success: true, backend: "escpos-usb" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.fallbackRawToBrowser(args.rawHtml, `Máy in USB lỗi (${msg}) — đã in qua trình duyệt`);
    }
  }

  private fallbackRawToBrowser(html: string, warning: string): PrintResult {
    try {
      openBrowserPrint(html);
      return { success: true, backend: "browser", fallback: true, warning };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, backend: "browser", fallback: true, warning: `${warning} — ${msg}` };
    }
  }

  /**
   * Test print — 1 dòng "TEST PRINT OK" để verify connection.
   * Dùng trong Cài đặt → In ấn → "In thử".
   */
  async testPrint(options: PrinterServiceOptions = {}): Promise<PrintResult> {
    const backend = options.backend ?? this.configuredBackend;
    const paperSize: PaperWidth = "80mm";

    if (backend === "escpos-usb") {
      if (!isWebUsbSupported()) {
        return { success: false, backend: "escpos-usb", warning: "Trình duyệt không hỗ trợ WebUSB" };
      }
      const printer = loadPrinter();
      if (!printer) {
        return { success: false, backend: "escpos-usb", warning: "Chưa kết nối máy in" };
      }
      try {
        const builder = new EscPosBuilder(paperSize);
        builder
          .text("ONEBIZ ERP - TEST PRINT", { align: "center", bold: true, size: "double" })
          .newline()
          .text(`Thoi gian: ${formatTime(new Date().toISOString())}`, { align: "center" })
          .text(`May in: ${printer.manufacturer} ${printer.name}`, { align: "center" })
          .divider()
          .text("Neu ban doc duoc dong nay => OK", { align: "center", bold: true })
          .newline();
        await sendToUsbPrinter(printer.vendorId, printer.productId, builder.build());
        return { success: true, backend: "escpos-usb" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, backend: "escpos-usb", warning: msg };
      }
    }

    // Browser test
    try {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:monospace;text-align:center;padding:20px">
<h2>ONEBIZ ERP — IN THỬ</h2>
<p>Thời gian: ${formatTime(new Date().toISOString())}</p>
<p>Nếu bạn đọc được dòng này → OK ✓</p>
<script>window.print();setTimeout(()=>window.close(),1500);</script>
</body></html>`;
      openBrowserPrint(html);
      return { success: true, backend: "browser" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, backend: "browser", warning: msg };
    }
  }

  private fallbackToBrowser(
    payload: PrintReceiptPayload,
    options: PrinterServiceOptions,
    warning: string
  ): PrintResult {
    try {
      const html = options.rawHtml ?? buildReceiptHtml(payload);
      openBrowserPrint(html);
      return { success: true, backend: "browser", fallback: true, warning };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, backend: "browser", fallback: true, warning: `${warning} — ${msg}` };
    }
  }
}

// ─── Singleton ───

export const printerService = new PrinterService();

// ─── Public helper functions ───

/** Shorthand để call site dùng. Đọc backend từ localStorage. */
export async function printReceipt(
  payload: PrintReceiptPayload,
  options?: PrinterServiceOptions
): Promise<PrintResult> {
  // Cập nhật backend từ settings trước khi in
  // (Đọc trực tiếp localStorage để không phụ thuộc React context)
  try {
    const settingsRaw = typeof window !== "undefined" ? localStorage.getItem("onebiz_settings") : null;
    if (settingsRaw) {
      const parsed = JSON.parse(settingsRaw);
      const backend: PrinterBackend = parsed?.print?.backend === "escpos-usb" ? "escpos-usb" : "browser";
      printerService.setBackend(backend);
    }
  } catch {
    // Keep current backend
  }
  return printerService.printReceipt(payload, options);
}

export async function testPrint(options?: PrinterServiceOptions): Promise<PrintResult> {
  return printerService.testPrint(options);
}
