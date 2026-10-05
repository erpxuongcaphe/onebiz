import { sendPrintJob, getPrintSettings } from "@/lib/printer/print-job";
/**
 * In báo cáo ca X/Z trên máy in nhiệt.
 *
 * X report = ảnh snapshot ca đang mở (không đóng) — cho cashier kiểm tra giữa ca.
 * Z report = báo cáo đóng ca cuối cùng — in sau khi closeShift() thành công.
 *
 * Tái sử dụng dispatch printerService (USB/browser) giống hoá đơn bán hàng.
 */

import { formatCurrency, formatDate } from "@/lib/format";

export interface ShiftReportData {
  /** X: báo cáo tạm thời giữa ca. Z: báo cáo cuối khi đóng ca. */
  type: "X" | "Z";
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  branchName?: string;
  cashierName?: string;
  openedAt: string;
  closedAt?: string | null;
  startingCash: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  actualCash: number;
  cashDifference: number;
  totalSales: number;
  totalOrders: number;
  /** { cash: 1200000, transfer: 800000, card: 400000 } */
  salesByMethod: Record<string, number>;
  note?: string | null;
  paperSize?: "58mm" | "80mm";
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Tien mat",
  transfer: "Chuyen khoan",
  card: "The",
  mixed: "Hon hop",
};

function formatDateVi(iso?: string | null): string {
  return formatDate(iso);
}

function buildShiftReportHtml(data: ShiftReportData): string {
  const widthPx = (data.paperSize ?? "80mm") === "58mm" ? "220px" : "302px";
  const paperSize = data.paperSize ?? "80mm";
  const methods = Object.entries(data.salesByMethod)
    .filter(([, amt]) => (amt ?? 0) > 0)
    .map(([m, amt]) => `<div class="row"><span>  ${METHOD_LABELS[m] ?? m}</span><span>${formatCurrency(amt)}</span></div>`)
    .join("");

  const diffLabel = data.cashDifference === 0
    ? "KHOP"
    : data.cashDifference > 0
      ? `THUA ${formatCurrency(data.cashDifference)}`
      : `THIEU ${formatCurrency(Math.abs(data.cashDifference))}`;
  const diffColor = data.cashDifference === 0
    ? "#16a34a"
    : data.cashDifference > 0
      ? "#2563eb"
      : "#dc2626";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Bao cao ca ${data.type}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:12px;width:${widthPx};margin:0 auto;padding:8px}
.center{text-align:center}.bold{font-weight:bold}
.line{border-top:1px dashed #000;margin:6px 0}
.row{display:flex;justify-content:space-between;padding:1px 0}
.store-name{font-size:16px;font-weight:bold}
.title{font-size:14px;font-weight:bold;margin-top:4px}
.section-title{font-weight:bold;margin-top:4px;margin-bottom:2px}
.diff{font-size:15px;font-weight:bold;color:${diffColor}}
@media print{body{width:${widthPx}}@page{size:${paperSize} auto;margin:0}}
</style></head><body>
<div class="center">
${data.storeName ? `<div class="store-name">${data.storeName}</div>` : ""}
${data.storeAddress ? `<div style="font-size:10px;margin-top:2px">${data.storeAddress}</div>` : ""}
${data.storePhone ? `<div style="font-size:10px">SDT: ${data.storePhone}</div>` : ""}
<div class="title">${data.type === "Z" ? "BAO CAO DONG CA (Z)" : "BAO CAO GIUA CA (X)"}</div>
</div>
<div class="line"></div>
${data.branchName ? `<div>Chi nhanh: ${data.branchName}</div>` : ""}
${data.cashierName ? `<div>Thu ngan: ${data.cashierName}</div>` : ""}
<div>Mo ca:  ${formatDateVi(data.openedAt)}</div>
<div>${data.type === "Z" ? "Dong ca" : "Chot"}: ${formatDateVi(data.closedAt ?? new Date().toISOString())}</div>
<div class="line"></div>
<div class="section-title">DOANH THU</div>
<div class="row"><span>So don:</span><span>${data.totalOrders}</span></div>
<div class="row"><span>Tong doanh thu:</span><span>${formatCurrency(data.totalSales)}</span></div>
${methods ? `<div style="margin-top:4px">Theo phuong thuc:</div>${methods}` : ""}
<div class="line"></div>
<div class="section-title">TIEN MAT NGAN KEO</div>
<div class="row"><span>Du dau ca:</span><span>${formatCurrency(data.startingCash)}</span></div>
<div class="row"><span>Thu trong ca:</span><span>${formatCurrency(data.cashIn)}</span></div>
<div class="row"><span>Chi trong ca:</span><span>-${formatCurrency(data.cashOut)}</span></div>
<div class="row bold"><span>Ky vong:</span><span>${formatCurrency(data.expectedCash)}</span></div>
${data.type === "Z" ? `
<div class="row"><span>Thuc te dem:</span><span>${formatCurrency(data.actualCash)}</span></div>
<div class="row diff"><span>Chenh lech:</span><span>${diffLabel}</span></div>
` : ""}
${data.note ? `<div class="line"></div><div>Ghi chu:</div><div>${data.note}</div>` : ""}
<div class="line"></div>
<div class="center" style="margin-top:4px">--- HET ---</div>
<script>window.onload=function(){window.print();window.close()}<\/script>
</body></html>`;
}

/**
 * In báo cáo ca — dispatch qua printerService theo backend đã cấu hình.
 */
export function printShiftReport(data: ShiftReportData) {
  void sendPrintJob({ html: buildShiftReportHtml(data), paperSize: data.paperSize ?? "80mm", role: "cashier", openCashDrawer: data.type === "Z" && getPrintSettings().openCashDrawer });
}
