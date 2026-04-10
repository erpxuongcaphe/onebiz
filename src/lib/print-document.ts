/**
 * Generic document printer — opens a new window with an A4 HTML template
 * and triggers the browser's print dialog.
 */

import { formatCurrency, formatDate } from "@/lib/format";

export interface DocumentLineItem {
  name: string;
  code?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  discount?: number;
  total: number;
}

export interface DocumentPrintData {
  documentType: string;      // e.g. "PHIẾU KIỂM KHO", "HOÁ ĐƠN BÁN HÀNG"
  documentCode: string;
  date: string;
  storeName?: string;
  branchName?: string;

  // Header fields (key-value pairs shown below title)
  headerFields?: { label: string; value: string }[];

  // Line items (optional — some documents don't have items)
  items?: DocumentLineItem[];
  itemColumns?: string[];     // e.g. ["Mã hàng", "Tên hàng", "SL", "Đơn giá", "Thành tiền"]

  // Summary rows at bottom
  summaryRows?: { label: string; value: string; bold?: boolean }[];

  // Footer note
  note?: string;
  createdBy?: string;
}

export function printDocument(data: DocumentPrintData): void {
  const html = generateDocumentHtml(data);
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) {
    alert("Không thể mở cửa sổ in. Vui lòng cho phép popup.");
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 300);
}

function generateDocumentHtml(d: DocumentPrintData): string {
  const headerFieldsHtml = (d.headerFields ?? [])
    .map((f) => `<tr><td class="label">${f.label}:</td><td>${f.value}</td></tr>`)
    .join("");

  const colHeaders = d.itemColumns ?? ["Mã hàng", "Tên hàng", "SL", "Đơn giá", "Thành tiền"];

  const itemsHtml = (d.items ?? [])
    .map(
      (it, i) => `
      <tr>
        <td class="center">${i + 1}</td>
        ${colHeaders.includes("Mã hàng") ? `<td>${it.code ?? ""}</td>` : ""}
        <td>${it.name}</td>
        <td class="right">${it.quantity}${it.unit ? ` ${it.unit}` : ""}</td>
        ${it.unitPrice !== undefined ? `<td class="right">${fmtVnd(it.unitPrice)}</td>` : ""}
        ${it.discount !== undefined && it.discount > 0 ? `<td class="right">${fmtVnd(it.discount)}</td>` : ""}
        <td class="right">${fmtVnd(it.total)}</td>
      </tr>`
    )
    .join("");

  const summaryHtml = (d.summaryRows ?? [])
    .map(
      (r) =>
        `<tr class="${r.bold ? "bold" : ""}"><td>${r.label}</td><td class="right">${r.value}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${d.documentCode}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #333; padding: 20px; }
  .header { text-align: center; margin-bottom: 16px; }
  .header .store { font-size: 16px; font-weight: bold; }
  .header .branch { font-size: 12px; color: #666; }
  .header .doc-type { font-size: 18px; font-weight: bold; margin-top: 12px; }
  .header .doc-code { font-size: 14px; color: #555; }
  .meta { margin: 12px 0; }
  .meta table { width: 100%; }
  .meta td.label { width: 140px; font-weight: 600; color: #555; padding: 2px 0; }
  .items { width: 100%; border-collapse: collapse; margin: 16px 0; }
  .items th { background: #f5f5f5; border: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 12px; }
  .items td { border: 1px solid #ddd; padding: 5px 8px; font-size: 12px; }
  .items .right { text-align: right; }
  .items .center { text-align: center; }
  .summary { width: 50%; margin-left: auto; margin-top: 8px; }
  .summary td { padding: 3px 8px; font-size: 13px; }
  .summary .bold td { font-weight: bold; font-size: 14px; }
  .summary .right { text-align: right; }
  .note { margin-top: 16px; font-size: 12px; color: #666; }
  .footer { margin-top: 32px; display: flex; justify-content: space-between; }
  .footer .col { text-align: center; width: 45%; }
  .footer .col .title { font-weight: bold; margin-bottom: 40px; }
  .bold { font-weight: bold; }
  @media print { body { padding: 0; } }
</style></head><body>

<div class="header">
  ${d.storeName ? `<div class="store">${d.storeName}</div>` : ""}
  ${d.branchName ? `<div class="branch">${d.branchName}</div>` : ""}
  <div class="doc-type">${d.documentType}</div>
  <div class="doc-code">${d.documentCode} — ${formatDate(d.date)}</div>
</div>

${
  headerFieldsHtml
    ? `<div class="meta"><table>${headerFieldsHtml}</table></div>`
    : ""
}

${
  d.items && d.items.length > 0
    ? `<table class="items">
  <thead><tr>
    <th class="center">STT</th>
    ${colHeaders.map((h) => `<th>${h}</th>`).join("")}
  </tr></thead>
  <tbody>${itemsHtml}</tbody>
</table>`
    : ""
}

${
  summaryHtml
    ? `<table class="summary">${summaryHtml}</table>`
    : ""
}

${d.note ? `<div class="note"><strong>Ghi chú:</strong> ${d.note}</div>` : ""}

<div class="footer">
  <div class="col">
    <div class="title">Người lập phiếu</div>
    <div>${d.createdBy ?? ""}</div>
  </div>
  <div class="col">
    <div class="title">Người duyệt</div>
    <div></div>
  </div>
</div>

</body></html>`;
}

function fmtVnd(n: number): string {
  return formatCurrency(n);
}
