/**
 * F&B Print Module — phiếu tạm tính, phiếu thanh toán, phiếu bếp/bar
 *
 * Hỗ trợ: 58mm (220px) và 80mm (302px) thermal printer.
 * Dùng window.open() + window.print() (browser-native).
 */

import { formatCurrency, formatNumber, formatTime as formatTimeHelper, formatShortDate } from "@/lib/format";
import { getFnbFreeTextNote } from "@/lib/fnb-item-note";
import { EscPosBuilder } from "@/lib/printer/escpos";
import { getPrintSettings, sendPrintJob } from "@/lib/printer/print-job";
import type { StoredPrinter } from "@/lib/printer/webusb-printer";

// ============================================================
// Types
// ============================================================

export interface FnbPrintItem {
  name: string;
  variant?: string;
  quantity: number;
  unitPrice: number;
  toppings?: { name: string; quantity: number; price: number }[];
  /**
   * CEO 01/06/2026 — Sprint 2.4b: in modifier choices lên phiếu bếp.
   * Vd "Mức đường: 70% • Mức đá: Ít • Topping: Trân châu đen".
   * Bếp đọc 1 dòng compact thay vì phải parse note tự do.
   */
  modifierLabels?: string[];
  note?: string;
}

export interface PreBillData {
  branchName?: string;
  customerName?: string;
  tipAmount?: number;
  receiptStyle?: "minimal" | "standard" | "full";
  showQr?: boolean;
  bankInfo?: FnbReceiptData["bankInfo"];
  branchId?: string;
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
  /**
   * Migration 00070 — Phí sàn (Shopee / Grab / Gojek / Be).
   * Nếu là đơn platform != "direct" + percent > 0 → bill in:
   *   • "Khách trả qua app" = subtotal sau discount + deliveryFee (gross)
   *   • "Phí sàn (XX%)"     = − commissionAmount
   *   • "QUÁN THỰC THU"     = total (đã trừ phí sàn, đưa cho shipper)
   */
  deliveryPlatform?: "direct" | "shopee_food" | "grab_food" | "gojek" | "be" | "other";
  platformCommissionPercent?: number;
  platformCommissionAmount?: number;
}

export interface FnbReceiptData extends PreBillData {
  billPhase?: "prebill" | "receipt";
  invoiceCode: string;
  paymentMethod: "cash" | "transfer" | "card" | "mixed";
  paid: number;
  change: number;
  customerName?: string;
  /** Tiền tip khách cho — hiển thị tách riêng trên hoá đơn (đã cộng vào total). */
  tipAmount?: number;
  /** Receipt style from settings */
  receiptStyle?: "minimal" | "standard" | "full";
  showBarcode?: boolean;
  showQr?: boolean;
  bankInfo?: {
    bankName: string;
    bankAccount: string;
    bankHolder: string;
    /**
     * CEO 14/05: bankBin (NAPAS 6 chữ số) — bắt buộc để render VietQR image.
     * Khi có bankBin + vietQrEnabled → in QR thật (template "print").
     * Khi thiếu → fallback hiển thị text "Chuyển khoản: STK xxx" như cũ.
     */
    bankBin?: string;
    vietQrEnabled?: boolean;
  };
  /** true = payment saved offline, will sync when online */
  isOffline?: boolean;
}

export interface KitchenTicketDataV2 {
  branchId?: string;
  stationId?: string;
  title?: string;
  itemFontSize?: "sm" | "md" | "lg";
  footerText?: string;
  printer?: StoredPrinter;
  bridgePrinter?: string;
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
  /**
   * Sprint KITCHEN-1 (CEO 07/05): Tên trạm chế biến hiển thị header LỚN
   * trên phiếu (vd "BAR PHA CHẾ", "BẾP NÓNG"). Để trống = "PHIẾU BAR/BẾP" mặc định.
   */
  stationName?: string;
  /**
   * Màu badge station (hex) cho border + text accent. Default = "#000".
   */
  stationColor?: string;
  /**
   * Sprint POS-FNB-EXT-1 (CEO 08/05): Ghi chú toàn đơn — vd "Khách kiêng
   * đường", "Đơn VIP". In dòng riêng dưới header station, font đậm + bg xám
   * để bếp/bar dễ nhận biết.
   */
  orderNote?: string;
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
  return formatTimeHelper(iso);
}

function formatDate(iso: string): string {
  return formatShortDate(iso);
}

function baseStyles(width: number, pageSize: string): string {
  return `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:13px;width:${width}px;margin:0 auto;padding:8px;color:#000}
.center{text-align:center}
.right{text-align:right}
.bold{font-weight:bold}
.line{border-top:2px dashed #000;margin:3px 0}
.line-thin{border-top:1px dotted #999;margin:3px 0}
table{width:100%;border-collapse:collapse}
td{padding:1px 0;font-size:12px;vertical-align:top}
.footer-text{font-size:11px;color:#333;margin-top:3px;text-align:center}
@media print{body{width:${width}px}@page{size:${pageSize} auto;margin:0}}`;
}

// ============================================================
// 1. PHIẾU TẠM TÍNH (Pre-bill)
// ============================================================

/**
 * Build HTML string của phiếu tạm tính — KHÔNG mở popup print.
 * Dùng cho preview component (iframe srcDoc) hoặc test snapshot.
 *
 * CEO 13/05: tách logic build HTML ra khỏi printPreBill để preview
 * dùng được. Logic 100% giống printPreBill — chỉ skip openAndPrint.
 */
export function buildPreBillHtml(data: PreBillData): string {
  return buildFnbReceiptHtml({...data, invoiceCode: data.orderNumber, paymentMethod: "transfer", paid: 0, change: 0, billPhase: "prebill"});
}

export function printPreBill(data: PreBillData): void {
  data = {...data, paperSize: data.paperSize ?? (getPrintSettings().paperSize === "58mm" ? "58mm" : "80mm")};
  void (async () => {
    const { printFnbBillWithTemplate } = await import("./print-fnb-template");
    const printed = await printFnbBillWithTemplate({
      ...data, branchId: data.branchId, invoiceCode: data.orderNumber,
      tableName: data.tableName ?? data.orderNumber, tipAmount: data.tipAmount ?? 0,
      paid: 0, billPhase: "prebill",
    });
    if (!printed) await sendPrintJob({html:buildPreBillHtml(data),paperSize:data.paperSize ?? "80mm",role:"cashier",branchId:data.branchId,label:`Tạm tính ${data.orderNumber}`.slice(0,80),buildHtml:paperSize=>buildPreBillHtml({...data,paperSize})});
  })();
}

// ============================================================
// 2. PHIẾU THANH TOÁN (FnB Receipt)
// ============================================================

/**
 * Build HTML string của hoá đơn thanh toán FnB — KHÔNG dispatch printer.
 * Dùng cho preview (iframe srcDoc).
 *
 * CEO 13/05: tách HTML builder để Settings page render preview live khi
 * user toggle paperSize / receiptStyle / showQr / etc.
 */
export function buildFnbReceiptHtml(data: FnbReceiptData): string {
  const width = getWidth(data.paperSize);
  const pageSize = getPageSize(data.paperSize);
  const typeLabel = ORDER_TYPE_VN[data.orderType] ?? data.orderType;
  const tableLabel = data.tableName ?? typeLabel;
  const style = data.receiptStyle ?? "standard";
  const isPreBill = data.billPhase === "prebill";
  const billTitle = isPreBill ? "PHIẾU TẠM TÍNH" : "HOÁ ĐƠN THANH TOÁN";
  const paymentLabel = PAYMENT_METHOD_VN[data.paymentMethod] ?? data.paymentMethod;

  // Migration 00070: platform order → tách "Khách trả app" vs "Quán thực thu"
  const isPlatformOrder =
    data.orderType === "delivery" &&
    !!data.deliveryPlatform &&
    data.deliveryPlatform !== "direct" &&
    (data.platformCommissionPercent ?? 0) > 0;
  const commissionAmount = isPlatformOrder ? (data.platformCommissionAmount ?? 0) : 0;
  const grossTotal = data.total + commissionAmount;
  const platformLabel = ({
    shopee_food: "Shopee Food",
    grab_food: "Grab Food",
    gojek: "Gojek",
    be: "Be",
    other: "Sàn khác",
  } as Record<string, string>)[data.deliveryPlatform ?? ""] ?? "Sàn";

  // Minimal: no item details, just total
  // Standard: items + prices + mọi chi tiết ảnh hưởng cách pha/tiền món
  // Full: như Standard + phần trình bày mở rộng, barcode/QR

  let itemsHtml = "";
  if (style !== "minimal") {
    itemsHtml = data.items.map((item) => {
      const itemTotal = item.quantity * item.unitPrice;
      let html = `<tr>
        <td>${formatNumber(item.quantity)}x ${item.name}${item.variant ? ` (${item.variant})` : ""}</td>
        <td class="right">${formatCurrency(itemTotal)}</td>
      </tr>`;

      if (item.toppings && item.toppings.length > 0) {
        for (const t of item.toppings) {
          if (t.quantity <= 0) continue;
          const tTotal = t.quantity * item.quantity * t.price;
          html += `<tr><td style="padding-left:12px;font-size:11px;color:#555">+ ${t.name} x${formatNumber(t.quantity)}</td>
            <td class="right" style="font-size:11px;color:#555">${formatCurrency(tTotal)}</td></tr>`;
        }
      }
      // Mọi hoá đơn có danh sách món đều phải nói rõ lựa chọn pha chế.
      if (item.modifierLabels && item.modifierLabels.length > 0) {
        const label = item.modifierLabels.join(" • ");
        html += `<tr><td colspan="2" style="padding-left:12px;font-size:11px;color:#1976d2">▸ ${label}</td></tr>`;
      }
      const freeTextNote = getFnbFreeTextNote(item.note, item.modifierLabels);
      if (freeTextNote) {
        html += `<tr><td colspan="2" style="padding-left:12px;font-size:11px;font-style:italic;color:#888">* ${freeTextNote}</td></tr>`;
      }
      return html;
    }).join("");
  }

  // CEO 14/05: nếu vietQrEnabled + bankBin → render QR image thật
  // (VietQR.io CDN). Khi POS in qua nhiệt 58/80mm, browser sẽ tự fetch
  // image embed vào bill. Offline: image broken → fallback text dưới.
  let qrHtml = "";
  if (data.showQr && data.bankInfo) {
    const info = data.bankInfo;
    if (info.vietQrEnabled && info.bankBin && info.bankAccount) {
      // Build VietQR URL inline (không import vietqr.ts để tránh circular dep)
      const cleanInfo = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-zA-Z0-9\s-]/g, "")
          .trim()
          .slice(0, 50);
      const cleanHolder = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toUpperCase()
          .replace(/[^A-Z0-9\s]/g, "")
          .trim()
          .slice(0, 50);
      const params = new URLSearchParams();
      params.set("amount", String(Math.round(data.total)));
      params.set("addInfo", cleanInfo(data.invoiceCode));
      if (info.bankHolder) {
        params.set("accountName", cleanHolder(info.bankHolder));
      }
      const qrUrl = `https://img.vietqr.io/image/${info.bankBin}-${info.bankAccount}-print.png?${params.toString()}`;
      qrHtml = `<div class="center" style="margin:8px 0;page-break-inside:avoid">
        <div style="font-size:11px;font-weight:bold;margin-bottom:4px">QUÉT QR ĐỂ THANH TOÁN</div>
        <img src="${qrUrl}" alt="VietQR" style="max-width:180px;width:100%;height:auto" />
        <div style="font-size:10px;margin-top:4px;color:#555">
          ${info.bankName} · ${info.bankAccount}
        </div>
      </div>`;
    } else {
      // Fallback: text-only (legacy behavior)
      qrHtml = `<div class="center" style="margin:8px 0">
        <div style="font-size:11px;font-weight:bold">Chuyển khoản:</div>
        <div style="font-size:11px">${info.bankName} — ${info.bankAccount}</div>
        <div style="font-size:11px">${info.bankHolder}</div>
      </div>`;
    }
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${billTitle} ${data.invoiceCode}</title>
<style>${baseStyles(width, pageSize)}
.title{font-size:20px;font-weight:bold;letter-spacing:1px}
.invoice-code{font-size:14px;margin:2px 0}
</style></head><body>

${data.isOffline ? `<div class="center" style="background:#f59e0b;color:#000;padding:4px;font-size:13px;font-weight:bold;letter-spacing:2px;border:2px dashed #000;margin-bottom:4px">● CHỜ ĐỒNG BỘ ●</div>` : ""}
${data.storeName ? `<div class="center bold" style="font-size:14px">${data.storeName}</div>` : ""}
${data.storeAddress ? `<div class="center" style="font-size:10px;color:#666">${data.storeAddress}</div>` : ""}
${data.storePhone ? `<div class="center" style="font-size:10px;color:#666">ĐT: ${data.storePhone}</div>` : ""}

<div class="center" style="margin-top:6px">
  <div class="title">${billTitle}</div>
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
  ${(data.tipAmount ?? 0) > 0 ? `<tr><td>Tiền tip</td><td class="right">+${formatCurrency(data.tipAmount ?? 0)}</td></tr>` : ""}
  ${isPlatformOrder ? `<tr><td>Khách trả qua ${platformLabel}</td><td class="right" style="text-decoration:line-through;color:#888">${formatCurrency(grossTotal)}</td></tr><tr><td>Phí sàn (${data.platformCommissionPercent}%)</td><td class="right">-${formatCurrency(commissionAmount)}</td></tr>` : ""}
  <tr class="bold"><td style="font-size:16px;padding-top:4px">${isPlatformOrder ? "QUÁN THỰC THU" : "TỔNG CỘNG"}</td><td class="right" style="font-size:16px;padding-top:4px">${formatCurrency(data.total)}</td></tr>
</table>

${!isPreBill ? `<div data-fnb-payment><div class="line-thin"></div>

<table>
  <tr><td>Thanh toán</td><td class="right bold">${isPlatformOrder ? "Chuyển khoản (sàn)" : paymentLabel}</td></tr>
  ${isPlatformOrder ? `<tr><td colspan="2" style="font-style:italic;color:#666;font-size:11px">Khách đã thanh toán qua app — sàn chuyển khoản về quán sau khi đối soát.</td></tr>` : `<tr><td>Tiền khách đưa</td><td class="right">${formatCurrency(data.paid)}</td></tr>`}
  ${!isPlatformOrder && data.change > 0 ? `<tr class="bold"><td>Tiền thừa</td><td class="right">${formatCurrency(data.change)}</td></tr>` : ""}
</table>
</div>` : ""}

${qrHtml}

<div class="line"></div>

${data.cashierName ? `<div class="center" style="font-size:10px;color:#888">Thu ngân: ${data.cashierName}</div>` : ""}
${data.footer ? `<div class="footer-text">${data.footer}</div>` : ""}

</body></html>`;

  return html;
}

export function printFnbReceipt(data: FnbReceiptData): void {
  data = {...data, paperSize: data.paperSize ?? (getPrintSettings().paperSize === "58mm" ? "58mm" : "80mm")};
  const html = buildFnbReceiptHtml(data);
  void sendPrintJob({html,paperSize:data.paperSize ?? "80mm",role:"cashier",branchId:data.branchId,label:`Bill ${data.invoiceCode}`.slice(0,80),buildHtml:paperSize=>buildFnbReceiptHtml({...data,paperSize}),openCashDrawer:getPrintSettings().openCashDrawer && data.paymentMethod === "cash"});
}

// ============================================================
// 3. PHIẾU BẾP/BAR (Kitchen Ticket v2 — 3 styles)
// ============================================================

/**
 * Build HTML phiếu bếp/bar — dùng cho preview, không pop window.
 */
export function buildKitchenTicketHtml(data: KitchenTicketDataV2): string {
  const width = getWidth(data.paperSize);
  const pageSize = getPageSize(data.paperSize);
  const style = data.style ?? "standard";
  const typeLabel = ORDER_TYPE_VN[data.orderType] ?? data.orderType;
  const tableLabel = data.tableName ?? typeLabel;
  const time = formatTime(data.createdAt);
  const date = formatDate(data.createdAt);
  const itemFontSize = data.itemFontSize === "lg" ? 22 : data.itemFontSize === "sm" ? 14 : data.itemFontSize === "md" ? 18 : style === "compact" ? 14 : 18;
  const stationColor = /^#[0-9a-f]{6}$/i.test(data.stationColor ?? "") ? data.stationColor : undefined;

  const itemsHtml = data.items.map((item) => {
    // Mọi kiểu phiếu đều phải giữ đủ thông tin pha chế. "Gọn" chỉ giảm
    // kích thước và khoảng cách, không được làm mất topping, tuỳ chọn hay ghi chú.
    let html = `<div class="item">
      <div class="item-name">
        <span class="qty">${formatNumber(item.quantity)}x</span>
        ${escapeKitchenText(item.name)}
        ${item.variant ? `<span class="variant">(${escapeKitchenText(item.variant)})</span>` : ""}
      </div>`;

    if (item.toppings && item.toppings.length > 0) {
      const toppingTexts = item.toppings
        .filter(t => t.quantity > 0)
        .map(t => `${t.name} x${formatNumber(t.quantity)}`);
      if (toppingTexts.length > 0) {
        html += `<div class="toppings">+ ${escapeKitchenText(toppingTexts.join(", "))}</div>`;
      }
    }
    // CEO 01/06/2026 — Sprint 2.4b: print modifier choices lên phiếu bếp.
    // Format compact: "▸ Mức đường: 70% • Mức đá: Ít • Topping: Trân châu"
    if (item.modifierLabels && item.modifierLabels.length > 0) {
      html += `<div class="modifier">▸ ${escapeKitchenText(item.modifierLabels.join(" • "))}</div>`;
    }
    const freeTextNote = getFnbFreeTextNote(item.note, item.modifierLabels);
    if (freeTextNote) {
      html += `<div class="note">** ${escapeKitchenText(freeTextNote)}</div>`;
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
    ? `<div class="center" style="background:#f59e0b;color:#000;padding:4px;font-size:13px;font-weight:bold;letter-spacing:2px;border:2px dashed #000;margin-bottom:4px">● CHỜ ĐỒNG BỘ ●</div>`
    : "";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Phiếu bếp ${escapeKitchenText(data.orderNumber)}</title>
<style>${baseStyles(width, pageSize)}
.order-number{font-size:${style === "compact" ? "12px" : "14px"};overflow-wrap:anywhere;margin:4px 0}
.table-label{font-size:${style === "compact" ? "22px" : "26px"};font-weight:bold;margin:4px 0}
.type-badge{display:inline-block;padding:2px 8px;border:2px solid #000;font-size:14px;font-weight:bold;margin:4px 0}
.item{margin:${style === "compact" ? "2px" : "3px"} 0;padding-bottom:2px;border-bottom:1px dotted #ccc}
.item:last-child{border-bottom:none}
.item-name{font-size:${itemFontSize}px;font-weight:bold;overflow-wrap:anywhere}
.qty{font-size:${style === "compact" ? "18px" : "22px"};font-weight:bold;margin-right:4px}
.variant{font-size:${style === "compact" ? "12px" : "14px"};font-weight:normal;color:#333}
.toppings{font-size:14px;padding-left:8px;margin-top:1px}
.modifier{font-size:14px;font-weight:bold;padding:1px 6px;margin-top:1px;border-left:2px solid #000;color:#000}
.note{font-size:16px;font-weight:bold;padding:1px 6px;margin-top:1px;border-left:2px solid #000}
.price{font-size:12px;color:#555;padding-left:24px;margin-top:2px}
.time{font-size:16px;font-weight:bold}
</style></head><body>

${offlineBanner}
${supplementBanner}

<div class="center">
  ${data.title ? `<div class="bold">${escapeKitchenText(data.title)}</div>` : ""}
  <div style="font-size:14px;letter-spacing:3px;font-weight:bold;${stationColor ? `color:${stationColor};` : ""}padding:6px 0;${stationColor ? `border:2px solid ${stationColor};` : "border:1px solid #000;"}margin-bottom:4px">
    ${escapeKitchenText(data.stationName ?? "PHIẾU BAR/BẾP")}
  </div>
  <div class="table-label">${escapeKitchenText(tableLabel)}</div>
  <div class="order-number">Phiếu: ${escapeKitchenText(data.orderNumber)}</div>
</div>

<div class="line"></div>

<div class="center">
  <div class="type-badge">${escapeKitchenText(typeLabel.toUpperCase())}</div>
</div>

${
  data.orderNote
    ? `<div style="margin:3px 0;padding:2px 6px;border-left:2px solid #000;font-size:14px;font-weight:bold;line-height:1.3">GHI CHÚ ĐƠN: ${escapeKitchenText(data.orderNote)}</div>`
    : ""
}

<div class="line"></div>

${itemsHtml}

<div class="line"></div>

<div class="center">
  <div class="time">${time}</div>
  <div style="font-size:11px;color:#666">${date}${data.cashierName ? ` \u2022 ${escapeKitchenText(data.cashierName)}` : ""}</div>
  ${data.footerText ? `<div>${escapeKitchenText(data.footerText)}</div>` : ""}
</div>

</body></html>`;

  return html;
}

export async function printKitchenTicketV2(data: KitchenTicketDataV2): Promise<void> {
  // CEO 04/06/2026 — Sprint 5 multi-printer: kitchen ticket dispatch theo
  // backend + role="kitchen". Browser → window.open như cũ; ESC/POS USB →
  // dùng printer config slot "kitchen" (user trỏ chung 1 máy hoặc khác máy).
  const html = buildKitchenTicketHtml(data);
  const result = await sendPrintJob({html, paperSize: data.paperSize ?? "80mm", role: "kitchen", branchId:data.branchId,stationId:data.stationId,label:`${data.isSupplement ? "Bổ sung" : "Bếp"} ${data.orderNumber}`.slice(0,80),buildHtml:paperSize=>buildKitchenTicketHtml({...data,paperSize}),printer: data.printer, bridgePrinter: data.bridgePrinter});
  if (!result.success) throw new Error(result.warning ?? "Không in được phiếu bếp");
}

function escapeKitchenText(text: string): string {
  return text.replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]!));
}

export function buildKitchenTicketBytes(data: KitchenTicketDataV2): Uint8Array {
  const b = new EscPosBuilder(data.paperSize ?? "80mm");
  if (data.isOffline) b.text("CHO DONG BO", {bold:true, align:"center"});
  if (data.isSupplement) b.text("BO SUNG", {bold:true, size:"double", align:"center"});
  if (data.title) b.text(data.title, {bold:true, align:"center"});
  b.text(data.stationName ?? "PHIEU BAR/BEP", {bold:true, align:"center"});
  b.text(data.tableName ?? ORDER_TYPE_VN[data.orderType], {bold:true, size:"double", align:"center"});
  b.text(`Phieu: ${data.orderNumber}`).text(ORDER_TYPE_VN[data.orderType]).divider();
  if (data.orderNote) b.text(`GHI CHU DON: ${data.orderNote}`, {bold:true});
  for (const item of data.items) {
    b.text(`${formatNumber(item.quantity)}x ${item.name}${item.variant ? ` (${item.variant})` : ""}`, {bold:true, size:data.itemFontSize === "lg" ? "double" : "normal"});
    for (const topping of item.toppings ?? []) if (topping.quantity > 0) b.text(`+ ${topping.name} x${formatNumber(topping.quantity)}`);
    for (const label of item.modifierLabels ?? []) b.text(`> ${label}`, {bold:true});
    const note = getFnbFreeTextNote(item.note, item.modifierLabels);
    if (note) b.text(`** ${note}`, {bold:true});
    if (data.style === "detailed") b.text(`${formatCurrency(item.unitPrice)} x ${formatNumber(item.quantity)}`);
    b.divider();
  }
  b.text(`${formatTime(data.createdAt)} ${formatDate(data.createdAt)}`, {align:"center"});
  if (data.cashierName) b.text(data.cashierName, {align:"center"});
  if (data.footerText) b.text(data.footerText, {align:"center"});
  return b.build();
}
