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

/**
 * Cỡ giấy được hỗ trợ bởi printDocument.
 * - A4 / A5: in tài liệu chuẩn (mặc định A4)
 * - 80mm / 58mm: in máy in nhiệt (receipt) cho các tài liệu gọn
 */
export type PaperSize = "A4" | "A5" | "80mm" | "58mm";

export interface PrintOptions {
  /** Cỡ giấy in. Mặc định A4. */
  paperSize?: PaperSize;
}

export function printDocument(
  data: DocumentPrintData,
  options: PrintOptions = {}
): void {
  const paperSize = options.paperSize ?? "A4";
  const html = generateDocumentHtml(data, paperSize);
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

/** Lấy margin + base font-size phù hợp với cỡ giấy. */
function getPageStyles(paperSize: PaperSize): {
  pageSize: string;
  margin: string;
  bodyFontSize: string;
  bodyPadding: string;
  headerDocFontSize: string;
  itemsFontSize: string;
  summaryFontSize: string;
} {
  switch (paperSize) {
    case "A5":
      // A5 = 148 × 210mm — nhỏ hơn A4, thu margin và font cho vừa
      return {
        pageSize: "A5",
        margin: "10mm",
        bodyFontSize: "11px",
        bodyPadding: "12px",
        headerDocFontSize: "15px",
        itemsFontSize: "10px",
        summaryFontSize: "11px",
      };
    case "80mm":
      // Receipt 80mm — body-width 72mm (margin 4mm mỗi bên)
      return {
        pageSize: "80mm auto",
        margin: "0",
        bodyFontSize: "10px",
        bodyPadding: "4mm",
        headerDocFontSize: "12px",
        itemsFontSize: "9px",
        summaryFontSize: "10px",
      };
    case "58mm":
      // Receipt 58mm — body-width 54mm
      return {
        pageSize: "58mm auto",
        margin: "0",
        bodyFontSize: "9px",
        bodyPadding: "2mm",
        headerDocFontSize: "11px",
        itemsFontSize: "8px",
        summaryFontSize: "9px",
      };
    case "A4":
    default:
      return {
        pageSize: "A4",
        margin: "15mm",
        bodyFontSize: "13px",
        bodyPadding: "20px",
        headerDocFontSize: "18px",
        itemsFontSize: "12px",
        summaryFontSize: "13px",
      };
  }
}

function generateDocumentHtml(d: DocumentPrintData, paperSize: PaperSize): string {
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

  const ps = getPageStyles(paperSize);
  const isThermal = paperSize === "80mm" || paperSize === "58mm";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${d.documentCode}</title>
<style>
  @page { size: ${ps.pageSize}; margin: ${ps.margin}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: ${ps.bodyFontSize}; color: #333; padding: ${ps.bodyPadding}; }
  .header { text-align: center; margin-bottom: ${isThermal ? "8px" : "16px"}; }
  .header .store { font-size: ${isThermal ? "12px" : "16px"}; font-weight: bold; }
  .header .branch { font-size: ${isThermal ? "9px" : "12px"}; color: #666; }
  .header .doc-type { font-size: ${ps.headerDocFontSize}; font-weight: bold; margin-top: ${isThermal ? "6px" : "12px"}; }
  .header .doc-code { font-size: ${isThermal ? "10px" : "14px"}; color: #555; }
  .meta { margin: ${isThermal ? "6px 0" : "12px 0"}; }
  .meta table { width: 100%; }
  .meta td.label { width: ${isThermal ? "60px" : "140px"}; font-weight: 600; color: #555; padding: 2px 0; }
  .items { width: 100%; border-collapse: collapse; margin: ${isThermal ? "8px 0" : "16px 0"}; }
  .items th { background: ${isThermal ? "transparent" : "#f5f5f5"}; border: ${isThermal ? "none" : "1px solid #ddd"}; border-bottom: 1px solid #000; padding: ${isThermal ? "2px 1px" : "6px 8px"}; text-align: left; font-size: ${ps.itemsFontSize}; }
  .items td { border: ${isThermal ? "none" : "1px solid #ddd"}; padding: ${isThermal ? "2px 1px" : "5px 8px"}; font-size: ${ps.itemsFontSize}; }
  .items .right { text-align: right; }
  .items .center { text-align: center; }
  .summary { width: ${isThermal ? "100%" : "50%"}; margin-left: auto; margin-top: 8px; }
  .summary td { padding: 3px 8px; font-size: ${ps.summaryFontSize}; }
  .summary .bold td { font-weight: bold; font-size: ${isThermal ? ps.summaryFontSize : "14px"}; }
  .summary .right { text-align: right; }
  .note { margin-top: ${isThermal ? "8px" : "16px"}; font-size: ${isThermal ? "9px" : "12px"}; color: #666; }
  .footer { margin-top: ${isThermal ? "12px" : "32px"}; display: ${isThermal ? "none" : "flex"}; justify-content: space-between; }
  .footer .col { text-align: center; width: 45%; }
  .footer .col .title { font-weight: bold; margin-bottom: 40px; }
  .bold { font-weight: bold; }
  @media print { body { padding: ${isThermal ? ps.bodyPadding : "0"}; } }
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
