"use client";

import { useRef, useCallback } from "react";
import { formatCurrency } from "@/lib/format";
import { printerService, type PrintReceiptPayload } from "@/lib/printer";

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
  /** R9: Pre-bill / tạm tính — KHÔNG phải hoá đơn chính thức. Header in chữ to "TẠM TÍNH". */
  isPreBill?: boolean;
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

        {data.isPreBill && (
          <div className="center" style={{ padding: "4px 0", border: "2px dashed #000", margin: "4px 0" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>=== TẠM TÍNH ===</div>
            <div style={{ fontSize: "10px" }}>(Không phải hoá đơn chính thức)</div>
          </div>
        )}

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
 * Utility: print receipt from data without rendering a component.
 *
 * Dispatch qua PrinterService:
 *   - backend=browser: dùng HTML xịn (hiện tại) qua window.print()
 *   - backend=escpos-usb: build ESC/POS bytes + gửi qua WebUSB
 *                         (tự fallback browser nếu USB lỗi)
 *
 * Đọc backend từ localStorage `onebiz_settings.print.backend`.
 */
export function printReceiptDirect(data: ReceiptData, width: "58mm" | "80mm" = "80mm") {
  // Build HTML "xịn" (hiện tại) cho browser backend
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

  const rawHtml = `<!DOCTYPE html>
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
${data.isPreBill ? `<div class="center" style="padding:4px;border:2px dashed #000;margin:4px 0"><div style="font-size:18px;font-weight:bold">=== TAM TINH ===</div><div style="font-size:10px">(Khong phai hoa don chinh thuc)</div></div>` : ""}
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

  // Build payload cho ESC/POS backend
  const payload: PrintReceiptPayload = {
    invoiceCode: data.invoiceCode,
    storeName: data.storeName,
    storeAddress: data.storeAddress,
    storePhone: data.storePhone,
    customerName: data.customerName,
    cashierName: data.cashierName,
    createdAt: data.date,
    items: data.items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      total: it.total,
    })),
    subtotal: data.subtotal,
    discountAmount: data.discountAmount,
    total: data.total,
    paid: data.paid,
    change: data.change,
    paymentMethod: data.paymentMethod,
    paperSize: width,
    orderType: "retail",
  };

  // Đọc backend + openCashDrawer từ settings
  let backend: "browser" | "escpos-usb" = "browser";
  let openCashDrawer = false;
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("onebiz_settings") : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      backend = parsed?.print?.backend === "escpos-usb" ? "escpos-usb" : "browser";
      openCashDrawer = parsed?.print?.openCashDrawer === true;
    }
  } catch {
    /* keep defaults */
  }

  printerService.setBackend(backend);
  void printerService.printReceipt(payload, { rawHtml, openCashDrawer });
}
