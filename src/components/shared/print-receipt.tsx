"use client";

import { useRef, useCallback } from "react";
import { formatCurrency } from "@/lib/format";

export interface ReceiptData {
  invoiceCode: string;
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  customerName: string;
  cashierName?: string;
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
  }[];
  subtotal: number;
  discountAmount: number;
  total: number;
  paid: number;
  change: number;
  paymentMethod: string;
  date: string;
  note?: string;
  /** True when hoá đơn được tạo trong chế độ offline và chờ đồng bộ lên server. */
  isOffline?: boolean;
}

interface PrintReceiptProps {
  data: ReceiptData;
  width?: "58mm" | "80mm";
}

export function PrintReceipt({ data, width = "80mm" }: PrintReceiptProps) {
  const receiptRef = useRef<HTMLDivElement>(null);

  const handlePrint = useCallback(() => {
    if (!receiptRef.current) return;

    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (!printWindow) return;

    const widthPx = width === "58mm" ? "220px" : "302px";

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${data.invoiceCode}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Courier New', monospace; font-size: 12px; width: ${widthPx}; margin: 0 auto; padding: 8px; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .line { border-top: 1px dashed #000; margin: 6px 0; }
          .row { display: flex; justify-content: space-between; padding: 1px 0; }
          .item-name { font-size: 11px; }
          .item-detail { font-size: 11px; padding-left: 12px; color: #555; }
          .total-row { font-size: 14px; font-weight: bold; }
          .store-name { font-size: 16px; font-weight: bold; }
          .invoice-code { font-size: 13px; }
          .footer { font-size: 10px; color: #666; margin-top: 8px; }
          @media print {
            body { width: ${widthPx}; }
            @page { size: ${width} auto; margin: 0; }
          }
        </style>
      </head>
      <body>
        ${receiptRef.current.innerHTML}
        <script>window.onload = function() { window.print(); window.close(); }<\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }, [data.invoiceCode, width]);

  const paymentLabel =
    data.paymentMethod === "cash"
      ? "Tien mat"
      : data.paymentMethod === "transfer"
        ? "Chuyen khoan"
        : "The";

  return (
    <>
      {/* Hidden receipt template */}
      <div ref={receiptRef} style={{ display: "none" }}>
        <div className="center">
          {data.storeName && (
            <div className="store-name">{data.storeName}</div>
          )}
          {data.storeAddress && (
            <div style={{ fontSize: "10px", marginTop: "2px" }}>
              {data.storeAddress}
            </div>
          )}
          {data.storePhone && (
            <div style={{ fontSize: "10px" }}>SĐT: {data.storePhone}</div>
          )}
        </div>

        <div className="line" />

        <div className="center">
          <div className="invoice-code bold">{data.invoiceCode}</div>
          <div style={{ fontSize: "10px" }}>{data.date}</div>
        </div>

        <div className="line" />

        <div className="row">
          <span>Khach hang:</span>
          <span>{data.customerName}</span>
        </div>
        {data.cashierName && (
          <div className="row">
            <span>Thu ngan:</span>
            <span>{data.cashierName}</span>
          </div>
        )}

        <div className="line" />

        {/* Items */}
        {data.items.map((item, i) => (
          <div key={i}>
            <div className="item-name">{item.name}</div>
            <div className="item-detail row">
              <span>
                {item.quantity} x {formatCurrency(item.unitPrice)}
              </span>
              <span>{formatCurrency(item.total)}</span>
            </div>
            {item.discount > 0 && (
              <div className="item-detail row">
                <span>Giam gia</span>
                <span>-{formatCurrency(item.discount)}</span>
              </div>
            )}
          </div>
        ))}

        <div className="line" />

        <div className="row">
          <span>Tong tien hang</span>
          <span>{formatCurrency(data.subtotal)}</span>
        </div>
        {data.discountAmount > 0 && (
          <div className="row">
            <span>Giam gia</span>
            <span>-{formatCurrency(data.discountAmount)}</span>
          </div>
        )}
        <div className="row total-row">
          <span>TONG CONG</span>
          <span>{formatCurrency(data.total)}</span>
        </div>

        <div className="line" />

        <div className="row">
          <span>Phuong thuc:</span>
          <span>{paymentLabel}</span>
        </div>
        <div className="row">
          <span>Khach dua:</span>
          <span>{formatCurrency(data.paid)}</span>
        </div>
        {data.change > 0 && (
          <div className="row">
            <span>Tien thua:</span>
            <span>{formatCurrency(data.change)}</span>
          </div>
        )}

        {data.note && (
          <>
            <div className="line" />
            <div style={{ fontSize: "10px" }}>Ghi chu: {data.note}</div>
          </>
        )}

        <div className="line" />

        <div className="center footer">
          <div>Cam on quy khach!</div>
          <div>Hen gap lai</div>
        </div>
      </div>

      {/* Print button trigger */}
      <button
        onClick={handlePrint}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-surface-container-lowest hover:bg-surface-container-low transition-colors"
      >
        In hoa don
      </button>
    </>
  );
}

/**
 * Utility: print receipt from data without rendering a component
 */
export function printReceiptDirect(data: ReceiptData, width: "58mm" | "80mm" = "80mm") {
  const widthPx = width === "58mm" ? "220px" : "302px";
  const paymentLabel =
    data.paymentMethod === "cash"
      ? "Tien mat"
      : data.paymentMethod === "transfer"
        ? "Chuyen khoan"
        : "The";

  const itemsHtml = data.items
    .map(
      (item) => `
      <div class="item-name">${item.name}</div>
      <div class="item-detail row">
        <span>${item.quantity} x ${formatCurrency(item.unitPrice)}</span>
        <span>${formatCurrency(item.total)}</span>
      </div>
      ${item.discount > 0 ? `<div class="item-detail row"><span>Giam gia</span><span>-${formatCurrency(item.discount)}</span></div>` : ""}
    `
    )
    .join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${data.invoiceCode}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:12px;width:${widthPx};margin:0 auto;padding:8px}
.center{text-align:center}.bold{font-weight:bold}
.line{border-top:1px dashed #000;margin:6px 0}
.row{display:flex;justify-content:space-between;padding:1px 0}
.item-name{font-size:11px}.item-detail{font-size:11px;padding-left:12px;color:#555}
.total-row{font-size:14px;font-weight:bold}
.store-name{font-size:16px;font-weight:bold}
.footer{font-size:10px;color:#666;margin-top:8px}
@media print{body{width:${widthPx}}@page{size:${width} auto;margin:0}}
</style></head><body>
<div class="center">
${data.storeName ? `<div class="store-name">${data.storeName}</div>` : ""}
${data.storeAddress ? `<div style="font-size:10px;margin-top:2px">${data.storeAddress}</div>` : ""}
${data.storePhone ? `<div style="font-size:10px">SDT: ${data.storePhone}</div>` : ""}
</div>
<div class="line"></div>
<div class="center"><div class="bold" style="font-size:13px">${data.invoiceCode}</div><div style="font-size:10px">${data.date}</div>${data.isOffline ? `<div class="bold" style="font-size:11px;color:#b45309;margin-top:2px;border:1px dashed #b45309;padding:2px 6px;display:inline-block">⚠ CHO DONG BO</div>` : ""}</div>
<div class="line"></div>
<div class="row"><span>Khach hang:</span><span>${data.customerName}</span></div>
${data.cashierName ? `<div class="row"><span>Thu ngan:</span><span>${data.cashierName}</span></div>` : ""}
<div class="line"></div>
${itemsHtml}
<div class="line"></div>
<div class="row"><span>Tong tien hang</span><span>${formatCurrency(data.subtotal)}</span></div>
${data.discountAmount > 0 ? `<div class="row"><span>Giam gia</span><span>-${formatCurrency(data.discountAmount)}</span></div>` : ""}
<div class="row total-row"><span>TONG CONG</span><span>${formatCurrency(data.total)}</span></div>
<div class="line"></div>
<div class="row"><span>Phuong thuc:</span><span>${paymentLabel}</span></div>
<div class="row"><span>Khach dua:</span><span>${formatCurrency(data.paid)}</span></div>
${data.change > 0 ? `<div class="row"><span>Tien thua:</span><span>${formatCurrency(data.change)}</span></div>` : ""}
${data.note ? `<div class="line"></div><div style="font-size:10px">Ghi chu: ${data.note}</div>` : ""}
<div class="line"></div>
<div class="center footer"><div>Cam on quy khach!</div><div>Hen gap lai</div></div>
<script>window.onload=function(){window.print();window.close()}<\/script>
</body></html>`;

  const printWindow = window.open("", "_blank", "width=400,height=600");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}
