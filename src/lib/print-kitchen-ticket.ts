/**
 * Kitchen Ticket Printer — prints to 80mm thermal printer.
 *
 * Different from customer receipt:
 * - NO prices
 * - Large item names
 * - Prominent toppings and notes
 * - Table/order info
 */

import { formatTime, formatShortDate } from "@/lib/format";

export interface KitchenTicketData {
  orderNumber: string;
  tableName?: string;
  orderType: "dine_in" | "takeaway" | "delivery";
  items: {
    name: string;
    variant?: string;
    quantity: number;
    toppings: string[];
    note?: string;
  }[];
  createdAt: string;
  cashierName?: string;
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: "Tại quán",
  takeaway: "Mang về",
  delivery: "Giao hàng",
};

export function printKitchenTicket(data: KitchenTicketData) {
  const time = formatTime(data.createdAt);
  const date = formatShortDate(data.createdAt);

  const typeLabel = ORDER_TYPE_LABELS[data.orderType] ?? data.orderType;
  const tableLabel = data.tableName ? `${data.tableName}` : typeLabel;

  const itemsHtml = data.items
    .map((item) => {
      let html = `
        <div class="item">
          <div class="item-name">
            <span class="qty">${item.quantity}x</span>
            ${item.name}
            ${item.variant ? `<span class="variant">(${item.variant})</span>` : ""}
          </div>`;

      if (item.toppings.length > 0) {
        html += `<div class="toppings">+ ${item.toppings.join(", ")}</div>`;
      }
      if (item.note) {
        html += `<div class="note">** ${item.note}</div>`;
      }
      html += `</div>`;
      return html;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Kitchen ${data.orderNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:14px;width:302px;margin:0 auto;padding:8px}
.center{text-align:center}
.bold{font-weight:bold}
.line{border-top:2px dashed #000;margin:8px 0}
.order-number{font-size:28px;font-weight:bold;letter-spacing:2px}
.table-label{font-size:22px;font-weight:bold;margin:4px 0}
.type-badge{display:inline-block;padding:2px 8px;border:2px solid #000;font-size:14px;font-weight:bold;margin:4px 0}
.item{margin:6px 0;padding-bottom:6px;border-bottom:1px dotted #ccc}
.item:last-child{border-bottom:none}
.item-name{font-size:18px;font-weight:bold}
.qty{font-size:20px;margin-right:4px}
.variant{font-size:14px;font-weight:normal;color:#333}
.toppings{font-size:14px;padding-left:24px;margin-top:2px}
.note{font-size:16px;font-weight:bold;padding-left:24px;margin-top:2px;background:#f0f0f0;padding:4px 24px;border-left:4px solid #000}
.footer{font-size:11px;color:#666;margin-top:6px}
.time{font-size:16px;font-weight:bold}
@media print{body{width:302px}@page{size:80mm auto;margin:0}}
</style></head><body>

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
  <div class="footer">${date}${data.cashierName ? ` • ${data.cashierName}` : ""}</div>
</div>

</body></html>`;

  const win = window.open("", "_blank", "width=350,height=600");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  setTimeout(() => win.close(), 1000);
}
