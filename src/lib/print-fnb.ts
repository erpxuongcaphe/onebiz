/**
 * F&B Print Module — phiếu tạm tính, phiếu thanh toán, phiếu bếp/bar
 *
 * Hỗ trợ: 58mm (220px) và 80mm (302px) thermal printer.
 * Dùng window.open() + window.print() (browser-native).
 */

import { formatCurrency } from "@/lib/format";

// ============================================================
// Types
// ============================================================

export interface FnbPrintItem {
  name: string;
  variant?: string;
  quantity: number;
  unitPrice: number;
  toppings?: { name: string; quantity: number; price: number }[];
  note?: string;
}

export interface PreBillData {
  orderNumber: string;
  tableName?: string;
  orderType: "dine_in" | "takeaway" | "delivery";
  items: FnbPrintItem[];
  subtotal: number;
  discountAmount: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  cashierName?: string;
  /** From AppSettings */
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  paperSize?: "58mm" | "80mm";
  footer?: string;
}

export interface FnbReceiptData extends PreBillData {
  invoiceCode: string;
  paymentMethod: "cash" | "transfer" | "card" | "mixed";
  paid: number;
  change: number;
  customerName?: string;
  /** Receipt style from settings */
  receiptStyle?: "minimal" | "standard" | "full";
  showBarcode?: boolean;
  showQr?: boolean;
  bankInfo?: { bankName: string; bankAccount: string; bankHolder: string };
  /** true = payment saved offline, will sync when online */
  isOffline?: boolean;
}

export interface KitchenTicketDataV2 {
  orderNumber: string;
  tableName?: string;
  orderType: "dine_in" | "takeaway" | "delivery";
  items: FnbPrintItem[];
  createdAt: string;
  cashierName?: string;
  /** Kitchen ticket style from settings */
  style?: "compact" | "standard" | "detailed";
  paperSize?: "58mm" | "80mm";
  /** true = this is a supplement order (bổ sung) */
  isSupplement?: boolean;
  /** true = order saved offline, will sync when online */
  isOffline?: boolean;
}

// ============================================================
// Helpers
// ============================================================

const ORDER_TYPE_VN: Record<string, string> = {
  dine_in: "Tại quán",
  takeaway: "Mang về",
  delivery: "Giao hàng",
};

const PAYMENT_METHOD_VN: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  mixed: "Hỗn hợp",
};

function getWidth(paperSize?: string): number {
  return paperSize === "58mm" ? 220 : 302;
}

function getPageSize(paperSize?: string): string {
  return paperSize === "58mm" ? "58mm" : "80mm";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN");
}

function openAndPrint(html: string) {
  const win = window.open("", "_blank", "width=400,height=700");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  setTimeout(() => win.close(), 1500);
}

function baseStyles(width: number, pageSize: string): string {
  return `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:13px;width:${width}px;margin:0 auto;padding:8px;color:#000}
.center{text-align:center}
.right{text-align:right}
.bold{font-weight:bold}
.line{border-top:2px dashed #000;margin:8px 0}
.line-thin{border-top:1px dotted #999;margin:6px 0}
table{width:100%;border-collapse:collapse}
td{padding:1px 0;font-size:12px;vertical-align:top}
.footer-text{font-size:11px;color:#666;margin-top:8px;text-align:center}
@media print{body{width:${width}px}@page{size:${pageSize} auto;margin:0}}`;
}

// ============================================================
// 1. PHIẾU TẠM TÍNH (Pre-bill)
// ============================================================

export function printPreBill(data: PreBillData): void {
  const width = getWidth(data.paperSize);
  const pageSize = getPageSize(data.paperSize);
  const typeLabel = ORDER_TYPE_VN[data.orderType] ?? data.orderType;
  const tableLabel = data.tableName ?? typeLabel;

  const itemsHtml = data.items.map((item) => {
    const itemTotal = item.quantity * item.unitPrice;
    let html = `<tr>
      <td style="width:50%">${item.quantity}x ${item.name}${item.variant ? ` (${item.variant})` : ""}</td>
      <td class="right">${formatCurrency(itemTotal)}</td>
    </tr>`;

    if (item.toppings && item.toppings.length > 0) {
      for (const t of item.toppings) {
        if (t.quantity <= 0) continue;
        const tTotal = t.quantity * item.quantity * t.price;
        html += `<tr><td style="padding-left:12px;font-size:11px;color:#555">+ ${t.name} x${t.quantity}</td>
          <td class="right" style="font-size:11px;color:#555">${formatCurrency(tTotal)}</td></tr>`;
      }
    }
    if (item.note) {
      html += `<tr><td colspan="2" style="padding-left:12px;font-size:11px;font-style:italic;color:#888">* ${item.note}</td></tr>`;
    }
    return html;
  }).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Tạm tính ${data.orderNumber}</title>
<style>${baseStyles(width, pageSize)}
.title{font-size:20px;font-weight:bold;letter-spacing:1px}
.order-info{font-size:14px;margin:4px 0}
</style></head><body>

${data.storeName ? `<div class="center bold" style="font-size:14px">${data.storeName}</div>` : ""}
${data.storeAddress ? `<div class="center" style="font-size:10px;color:#666">${data.storeAddress}</div>` : ""}
${data.storePhone ? `<div class="center" style="font-size:10px;color:#666">ĐT: ${data.storePhone}</div>` : ""}

<div class="center" style="margin-top:6px">
  <div class="title">PHIẾU TẠM TÍNH</div>
  <div class="order-info">${data.orderNumber} — ${tableLabel}</div>
  <div style="font-size:11px;color:#888">${typeLabel} • ${formatTime(data.createdAt)} ${formatDate(data.createdAt)}</div>
</div>

<div class="line"></div>

<table>${itemsHtml}</table>

<div class="line"></div>

<table>
  <tr><td>Tạm tính</td><td class="right">${formatCurrency(data.subtotal)}</td></tr>
  ${data.discountAmount > 0 ? `<tr><td>Giảm giá</td><td class="right">-${formatCurrency(data.discountAmount)}</td></tr>` : ""}
  ${data.deliveryFee > 0 ? `<tr><td>Phí giao hàng</td><td class="right">${formatCurrency(data.deliveryFee)}</td></tr>` : ""}
  <tr class="bold"><td style="font-size:16px;padding-top:4px">TỔNG CỘNG</td><td class="right" style="font-size:16px;padding-top:4px">${formatCurrency(data.total)}</td></tr>
</table>

<div class="line"></div>

<div class="center" style="font-size:12px;font-style:italic;margin:6px 0">
  Đây là phiếu tạm tính, chưa phải hoá đơn thanh toán
</div>

${data.cashierName ? `<div class="center" style="font-size:10px;color:#888">Thu ngân: ${data.cashierName}</div>` : ""}
${data.footer ? `<div class="footer-text">${data.footer}</div>` : ""}

</body></html>`;

  openAndPrint(html);
}

// ============================================================
// 2. PHIẾU THANH TOÁN (FnB Receipt)
// ============================================================

export function printFnbReceipt(data: FnbReceiptData): void {
  const width = getWidth(data.paperSize);
  const pageSize = getPageSize(data.paperSize);
  const typeLabel = ORDER_TYPE_VN[data.orderType] ?? data.orderType;
  const tableLabel = data.tableName ?? typeLabel;
  const style = data.receiptStyle ?? "standard";
  const paymentLabel = PAYMENT_METHOD_VN[data.paymentMethod] ?? data.paymentMethod;

  // Minimal: no item details, just total
  // Standard: items + prices
  // Full: items + toppings + notes + barcode/QR

  let itemsHtml = "";
  if (style !== "minimal") {
    itemsHtml = data.items.map((item) => {
      const itemTotal = item.quantity * item.unitPrice;
      let html = `<tr>
        <td>${item.quantity}x ${item.name}${item.variant ? ` (${item.variant})` : ""}</td>
        <td class="right">${formatCurrency(itemTotal)}</td>
      </tr>`;

      if (style === "full" && item.toppings && item.toppings.length > 0) {
        for (const t of item.toppings) {
          if (t.quantity <= 0) continue;
          const tTotal = t.quantity * item.quantity * t.price;
          html += `<tr><td style="padding-left:12px;font-size:11px;color:#555">+ ${t.name} x${t.quantity}</td>
            <td class="right" style="font-size:11px;color:#555">${formatCurrency(tTotal)}</td></tr>`;
        }
      }
      if (style === "full" && item.note) {
        html += `<tr><td colspan="2" style="padding-left:12px;font-size:11px;font-style:italic;color:#888">* ${item.note}</td></tr>`;
      }
      return html;
    }).join("");
  }

  const qrHtml = data.showQr && data.bankInfo && data.paymentMethod !== "cash"
    ? `<div class="center" style="margin:8px 0">
        <div style="font-size:11px;font-weight:bold">Chuyển khoản:</div>
        <div style="font-size:11px">${data.bankInfo.bankName} — ${data.bankInfo.bankAccount}</div>
        <div style="font-size:11px">${data.bankInfo.bankHolder}</div>
      </div>`
    : "";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Hoá đơn ${data.invoiceCode}</title>
<style>${baseStyles(width, pageSize)}
.title{font-size:20px;font-weight:bold;letter-spacing:1px}
.invoice-code{font-size:14px;margin:2px 0}
</style></head><body>

${data.isOffline ? `<div class="center" style="background:#f59e0b;color:#000;padding:4px;font-size:13px;font-weight:bold;letter-spacing:2px;border:2px dashed #000;margin-bottom:4px">● PENDING SYNC ●</div>` : ""}
${data.storeName ? `<div class="center bold" style="font-size:14px">${data.storeName}</div>` : ""}
${data.storeAddress ? `<div class="center" style="font-size:10px;color:#666">${data.storeAddress}</div>` : ""}
${data.storePhone ? `<div class="center" style="font-size:10px;color:#666">ĐT: ${data.storePhone}</div>` : ""}

<div class="center" style="margin-top:6px">
  <div class="title">HOÁ ĐƠN THANH TOÁN</div>
  <div class="invoice-code">${data.invoiceCode}</div>
  <div style="font-size:11px;color:#888">${data.orderNumber} — ${tableLabel} — ${typeLabel}</div>
  <div style="font-size:11px;color:#888">${formatTime(data.createdAt)} ${formatDate(data.createdAt)}</div>
</div>

${data.customerName && data.customerName !== "Khách lẻ" ? `<div style="font-size:12px;margin-top:4px">Khách hàng: ${data.customerName}</div>` : ""}

<div class="line"></div>

${itemsHtml ? `<table>${itemsHtml}</table><div class="line"></div>` : ""}

<table>
  ${style !== "minimal" ? `<tr><td>Tạm tính</td><td class="right">${formatCurrency(data.subtotal)}</td></tr>` : ""}
  ${data.discountAmount > 0 ? `<tr><td>Giảm giá</td><td class="right">-${formatCurrency(data.discountAmount)}</td></tr>` : ""}
  ${data.deliveryFee > 0 ? `<tr><td>Phí giao hàng</td><td class="right">${formatCurrency(data.deliveryFee)}</td></tr>` : ""}
  <tr class="bold"><td style="font-size:16px;padding-top:4px">TỔNG CỘNG</td><td class="right" style="font-size:16px;padding-top:4px">${formatCurrency(data.total)}</td></tr>
</table>

<div class="line-thin"></div>

<table>
  <tr><td>Thanh toán</td><td class="right bold">${paymentLabel}</td></tr>
  <tr><td>Tiền khách đưa</td><td class="right">${formatCurrency(data.paid)}</td></tr>
  ${data.change > 0 ? `<tr class="bold"><td>Tiền thừa</td><td class="right">${formatCurrency(data.change)}</td></tr>` : ""}
</table>

${qrHtml}

<div class="line"></div>

${data.cashierName ? `<div class="center" style="font-size:10px;color:#888">Thu ngân: ${data.cashierName}</div>` : ""}
${data.footer ? `<div class="footer-text">${data.footer}</div>` : ""}

</body></html>`;

  openAndPrint(html);
}

// ============================================================
// 3. PHIẾU BẾP/BAR (Kitchen Ticket v2 — 3 styles)
// ============================================================

export function printKitchenTicketV2(data: KitchenTicketDataV2): void {
  const width = getWidth(data.paperSize);
  const pageSize = getPageSize(data.paperSize);
  const style = data.style ?? "standard";
  const typeLabel = ORDER_TYPE_VN[data.orderType] ?? data.orderType;
  const tableLabel = data.tableName ?? typeLabel;
  const time = formatTime(data.createdAt);
  const date = formatDate(data.createdAt);

  const itemsHtml = data.items.map((item) => {
    if (style === "compact") {
      return `<div class="item">
        <span class="qty">${item.quantity}x</span> ${item.name}${item.variant ? ` (${item.variant})` : ""}
      </div>`;
    }

    // Standard + Detailed
    let html = `<div class="item">
      <div class="item-name">
        <span class="qty">${item.quantity}x</span>
        ${item.name}
        ${item.variant ? `<span class="variant">(${item.variant})</span>` : ""}
      </div>`;

    if (item.toppings && item.toppings.length > 0) {
      const toppingTexts = item.toppings
        .filter(t => t.quantity > 0)
        .map(t => `${t.name} x${t.quantity}`);
      if (toppingTexts.length > 0) {
        html += `<div class="toppings">+ ${toppingTexts.join(", ")}</div>`;
      }
    }
    if (item.note) {
      html += `<div class="note">** ${item.note}</div>`;
    }
    if (style === "detailed") {
      html += `<div class="price">${formatCurrency(item.unitPrice)} x ${item.quantity}</div>`;
    }
    html += `</div>`;
    return html;
  }).join("");

  const supplementBanner = data.isSupplement
    ? `<div class="center" style="background:#000;color:#fff;padding:6px;font-size:18px;font-weight:bold;letter-spacing:3px">BỔ SUNG</div>`
    : "";

  const offlineBanner = data.isOffline
    ? `<div class="center" style="background:#f59e0b;color:#000;padding:4px;font-size:13px;font-weight:bold;letter-spacing:2px;border:2px dashed #000;margin-bottom:4px">● PENDING SYNC ●</div>`
    : "";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Kitchen ${data.orderNumber}</title>
<style>${baseStyles(width, pageSize)}
.order-number{font-size:${style === "compact" ? "24px" : "28px"};font-weight:bold;letter-spacing:2px}
.table-label{font-size:${style === "compact" ? "18px" : "22px"};font-weight:bold;margin:4px 0}
.type-badge{display:inline-block;padding:2px 8px;border:2px solid #000;font-size:14px;font-weight:bold;margin:4px 0}
.item{margin:${style === "compact" ? "4px" : "6px"} 0;padding-bottom:${style === "compact" ? "4px" : "6px"};border-bottom:1px dotted #ccc}
.item:last-child{border-bottom:none}
.item-name{font-size:${style === "compact" ? "14px" : "18px"};font-weight:bold}
.qty{font-size:${style === "compact" ? "16px" : "20px"};margin-right:4px}
.variant{font-size:${style === "compact" ? "12px" : "14px"};font-weight:normal;color:#333}
.toppings{font-size:14px;padding-left:24px;margin-top:2px}
.note{font-size:16px;font-weight:bold;padding:4px 24px;margin-top:2px;background:#f0f0f0;border-left:4px solid #000}
.price{font-size:12px;color:#555;padding-left:24px;margin-top:2px}
.time{font-size:16px;font-weight:bold}
</style></head><body>

${offlineBanner}
${supplementBanner}

<div class="center">
  <div style="font-size:12px;letter-spacing:3px">PHIẾU BAR/BẾP</div>
  <div class="order-number">${data.orderNumber}</div>
</div>

<div class="line"></div>

<div class="center">
  <div class="table-label">${tableLabel}</div>
  <div class="type-badge">${typeLabel.toUpperCase()}</div>
</div>

<div class="line"></div>

${itemsHtml}

<div class="line"></div>

<div class="center">
  <div class="time">${time}</div>
  <div style="font-size:11px;color:#666">${date}${data.cashierName ? ` \u2022 ${data.cashierName}` : ""}</div>
</div>

</body></html>`;

  openAndPrint(html);
}
