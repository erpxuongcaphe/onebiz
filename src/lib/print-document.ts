/**
 * Generic document printer — opens a new window with an A4 HTML template
 * and triggers the browser's print dialog.
 */

import { formatCurrency, formatDate, formatShortDate } from "@/lib/format";

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

  // Tenant business info (in trên đầu hóa đơn — bắt buộc cho VAT).
  // Sprint HT-2: load từ tenants.settings.business_info qua hook
  // useTenantBusinessInfo() trong page rồi truyền vào builder.
  businessName?: string;
  businessTaxCode?: string;
  businessAddress?: string;
  businessPhone?: string;
  businessLogoUrl?: string;
  businessFooter?: string;

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
  /** Ẩn khối chữ ký (Người lập / Người duyệt) khi = false. Mặc định hiện. */
  showSignature?: boolean;

  /**
   * Cỡ chữ bảng mặt hàng (chỉ ảnh hưởng bảng items):
   * - "sm" ≈ 11px, "lg" ≈ 14px (đè cứng), "md" = GIỮ NGUYÊN cỡ hiện tại theo khổ giấy.
   * - undefined → KHÔNG đổi gì (dùng nguyên cỡ hiện tại) — bắt buộc zero-regression.
   */
  itemFontSize?: "sm" | "md" | "lg";
  /** URL ảnh QR thanh toán (VietQR). Có giá trị → render khối QR gần summary/footer. */
  qrImageUrl?: string;
  /** Chú thích nhỏ căn giữa dưới ảnh QR (optional). */
  qrLabel?: string;
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
  const ps = getPageStyles(paperSize);
  const isThermal = paperSize === "80mm" || paperSize === "58mm";
  const isA5 = paperSize === "A5";
  const money = (n: number) => `${fmtVnd(n)} đ`;

  // Cỡ chữ bảng mặt hàng: mặc định = cỡ hiện tại theo khổ giấy (ps.itemsFontSize).
  // "md" cũng giữ nguyên cỡ hiện tại. CHỈ "sm"/"lg" đè cứng. undefined → byte-identical.
  const itemsFontSize =
    d.itemFontSize === "sm"
      ? "11px"
      : d.itemFontSize === "lg"
        ? "14px"
        : ps.itemsFontSize;

  // Khối QR thanh toán: chỉ render khi có qrImageUrl. undefined → chuỗi rỗng (0 thay đổi).
  // Khổ nhiệt (58/80mm) QR nhỏ hơn cho vừa giấy.
  const qrSize = isThermal ? 100 : 128;
  const qrBlock = d.qrImageUrl
    ? `<div class="qr-pay"><img src="${esc(d.qrImageUrl)}" alt="QR thanh toán" style="width:${qrSize}px;height:${qrSize}px;object-fit:contain" />${d.qrLabel ? `<div class="qr-label">${esc(d.qrLabel)}</div>` : ""}</div>`
    : "";

  // Khối khách hàng / thông tin (key-value) — escape an toàn.
  const headerFieldsHtml = (d.headerFields ?? [])
    .map(
      (f) =>
        `<tr><td class="label">${esc(f.label)}:</td><td>${esc(f.value)}</td></tr>`,
    )
    .join("");

  // Bảng tổng — value đã format sẵn (kèm " đ") ở builder.
  const summaryHtml = (d.summaryRows ?? [])
    .map(
      (r) =>
        `<tr class="${r.bold ? "bold" : ""}"><td>${esc(r.label)}</td><td class="right tnum">${esc(r.value)}</td></tr>`,
    )
    .join("");

  const colHeaders = d.itemColumns ?? [
    "Mã hàng",
    "Tên hàng",
    "SL",
    "Đơn giá",
    "Thành tiền",
  ];
  const hasCode = colHeaders.includes("Mã hàng");
  const NUMERIC = ["SL", "Số lượng", "Đơn giá", "Giảm", "Giảm giá", "Thành tiền"];

  // Dòng hàng — thermal: 2 dòng/món (như bill); A4/A5: bảng sổ cái có cột.
  let itemsBlock = "";
  if (d.items && d.items.length) {
    if (isThermal) {
      const rows = d.items
        .map(
          (it) => `<div class="t-item">
        <div class="t-name">${esc(it.name)}</div>
        <div class="t-line"><span>${it.quantity}${it.unit ? ` ${esc(it.unit)}` : ""} × ${money(it.unitPrice ?? 0)}</span><span class="t-total tnum">${money(it.total)}</span></div>
      </div>`,
        )
        .join("");
      itemsBlock = `<div class="t-items">${rows}</div>`;
    } else {
      const colgroup =
        `<col class="c-stt" />` +
        colHeaders
          .map((h) =>
            h === "Tên hàng"
              ? `<col />`
              : h === "Mã hàng"
                ? `<col class="c-code" />`
                : `<col class="c-num" />`,
          )
          .join("");
      const ths = colHeaders
        .map(
          (h) =>
            `<th class="${NUMERIC.includes(h) ? "right" : ""}">${esc(h)}</th>`,
        )
        .join("");
      const trs = d.items
        .map(
          (it, i) => `<tr>
        <td class="center">${i + 1}</td>
        ${hasCode ? `<td>${esc(it.code ?? "")}</td>` : ""}
        <td>${esc(it.name)}</td>
        <td class="right tnum">${it.quantity}${it.unit ? `<span class="unit"> ${esc(it.unit)}</span>` : ""}</td>
        ${it.unitPrice !== undefined ? `<td class="right tnum">${money(it.unitPrice)}</td>` : ""}
        ${it.discount !== undefined && it.discount > 0 ? `<td class="right tnum">${money(it.discount)}</td>` : ""}
        <td class="right tnum">${money(it.total)}</td>
      </tr>`,
        )
        .join("");
      itemsBlock = `<table class="items">
      <colgroup>${colgroup}</colgroup>
      <thead><tr><th class="center">STT</th>${ths}</tr></thead>
      <tbody>${trs}</tbody>
    </table>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>${esc(d.documentCode)}</title>
<style>
  @page { size: ${ps.pageSize}; margin: ${ps.margin}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI','Helvetica Neue',Roboto,'Noto Sans',Arial,sans-serif; font-size: ${ps.bodyFontSize}; color: #1a1a1a; padding: ${ps.bodyPadding}; line-height: ${isThermal ? "1.3" : "1.45"}; -webkit-font-smoothing: antialiased; }
  .tnum { font-variant-numeric: tabular-nums lining-nums; font-feature-settings: 'tnum' 1,'lnum' 1; }

  /* Header — thermal: căn giữa; A4/A5: masthead trái-phải */
  .head-c { text-align: center; margin-bottom: 8px; }
  .head-c .store { font-size: 12px; font-weight: 700; line-height: 1.25; }
  .head-c .line { font-size: 9px; color: #000; }
  .head-c .doc-type { font-size: ${ps.headerDocFontSize}; font-weight: 700; margin-top: 6px; }
  .head-c .doc-code { font-size: 10px; color: #000; }
  .masthead { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #222; padding-bottom: 10px; margin-bottom: 14px; }
  .masthead .seller { text-align: left; }
  .masthead .store { font-size: ${isA5 ? "13px" : "16px"}; font-weight: 700; line-height: 1.25; }
  .masthead .line { font-size: ${ps.bodyFontSize}; color: #555; }
  .masthead .docmeta { text-align: right; min-width: 36%; }
  .masthead .doc-type { font-size: ${ps.headerDocFontSize}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; }
  .masthead .doc-line { font-size: ${ps.bodyFontSize}; color: #444; margin-top: 3px; }
  .logo { max-height: ${isThermal ? "32px" : "56px"}; margin-bottom: 6px; }

  .meta { margin: ${isThermal ? "6px 0" : "12px 0"}; }
  .meta table { width: 100%; border-collapse: collapse; }
  .meta td { padding: 2px 0; }
  .meta td.label { width: ${isThermal ? "62px" : "150px"}; font-weight: 600; color: ${isThermal ? "#000" : "#555"}; }

  .items { width: 100%; border-collapse: collapse; margin: ${isThermal ? "8px 0" : "16px 0"}; table-layout: fixed; }
  .items col.c-stt { width: 34px; }
  .items col.c-code { width: 13%; }
  .items col.c-num { width: 15%; }
  .items th { border: none; border-bottom: 2px solid #333; padding: ${isA5 ? "5px 7px" : "7px 10px"}; text-align: left; font-size: ${itemsFontSize}; font-weight: 700; line-height: 1.35; }
  .items td { border: none; border-bottom: 1px solid #eee; padding: ${isA5 ? "5px 7px" : "7px 10px"}; font-size: ${itemsFontSize}; line-height: 1.35; vertical-align: top; word-wrap: break-word; }
  .items th.right, .items td.right { text-align: right; }
  .items th.center, .items td.center { text-align: center; }
  .items tbody tr:nth-child(even) td { background: #fafafa; }
  .items tbody tr:last-child td { border-bottom: none; }
  .items td .unit { color: #888; font-weight: 400; }

  /* Thermal items — 2 dòng/món */
  .t-items { margin: 8px 0; }
  .t-item { margin-bottom: 5px; }
  .t-name { font-weight: 600; }
  .t-line { display: flex; justify-content: space-between; gap: 8px; }
  .t-total { font-weight: 600; }
  .sep { border: none; border-top: 1px dashed #000; margin: 6px 0; }${
    // CHỈ phát CSS khi itemFontSize được set (sm/lg) — undefined/md → không phát gì
    // (giữ byte-identical). Thermal dùng .t-name/.t-line, không dùng bảng .items.
    isThermal && (d.itemFontSize === "sm" || d.itemFontSize === "lg")
      ? `\n  .t-name, .t-line { font-size: ${itemsFontSize}; }`
      : ""
  }${
    // QR CSS chỉ phát khi có ảnh QR — không có QR → không phát gì (byte-identical).
    d.qrImageUrl
      ? `\n  .qr-pay { text-align: center; margin-top: ${isThermal ? "10px" : "16px"}; }\n  .qr-pay .qr-label { font-size: ${isThermal ? "9px" : "11px"}; color: ${isThermal ? "#000" : "#555"}; margin-top: 4px; }`
      : ""
  }

  .summary { width: ${isThermal ? "100%" : "55%"}; margin-left: auto; margin-top: 10px; border-collapse: collapse; }
  .summary td { padding: 4px ${isThermal ? "0" : "10px"}; font-size: ${ps.summaryFontSize}; }
  .summary td.right { text-align: right; }
  .summary .bold td { font-weight: 700; ${isThermal ? "border-top: 1px dashed #000; font-size: 13px; padding-top: 5px;" : `border-top: 2px solid #222; background: #f5f5f5; font-size: ${isA5 ? "14px" : "16px"}; padding-top: 7px;`} }
  .summary .bold td.right { font-weight: 800; }

  .note { margin-top: ${isThermal ? "8px" : "16px"}; font-size: ${isThermal ? "9px" : "12px"}; color: ${isThermal ? "#000" : "#555"}; }

  .footer { margin-top: 32px; display: ${isThermal || d.showSignature === false ? "none" : "flex"}; justify-content: space-around; }
  .footer .col { text-align: center; width: 42%; }
  .footer .col .title { font-weight: 700; }
  .footer .col .cap { font-size: 10px; font-style: italic; color: #888; margin-bottom: 50px; }

  .bizfooter { margin-top: ${isThermal ? "10px" : "26px"}; text-align: center; font-size: ${isThermal ? "9px" : "11px"}; color: ${isThermal ? "#222" : "#555"}; border-top: ${isThermal ? "1px dashed #000" : "1px solid #ddd"}; padding-top: 8px; }

  @media print {
    body { padding: ${isThermal ? ps.bodyPadding : "0"}; }
    thead { display: table-header-group; }
    .items tr, .summary tr, .footer, .t-item { break-inside: avoid; page-break-inside: avoid; }
  }
</style></head><body>

${
  isThermal
    ? `<div class="head-c">
  ${d.businessLogoUrl ? `<img class="logo" src="${esc(d.businessLogoUrl)}" alt="logo" />` : ""}
  ${d.businessName ? `<div class="store">${esc(d.businessName)}</div>` : d.storeName ? `<div class="store">${esc(d.storeName)}</div>` : ""}
  ${d.businessTaxCode ? `<div class="line">MST: ${esc(d.businessTaxCode)}</div>` : ""}
  ${d.businessAddress ? `<div class="line">${esc(d.businessAddress)}</div>` : ""}
  ${d.businessPhone ? `<div class="line">ĐT: ${esc(d.businessPhone)}</div>` : ""}
  ${d.branchName ? `<div class="line" style="font-style:italic;">Chi nhánh: ${esc(d.branchName)}</div>` : ""}
  <div class="doc-type">${esc(d.documentType)}</div>
  <div class="doc-code">${esc(d.documentCode)} — ${formatDate(d.date)}</div>
</div>`
    : `<div class="masthead">
  <div class="seller">
    ${d.businessLogoUrl ? `<img class="logo" src="${esc(d.businessLogoUrl)}" alt="logo" />` : ""}
    ${d.businessName ? `<div class="store">${esc(d.businessName)}</div>` : d.storeName ? `<div class="store">${esc(d.storeName)}</div>` : ""}
    ${d.businessTaxCode ? `<div class="line">MST: ${esc(d.businessTaxCode)}</div>` : ""}
    ${d.businessAddress ? `<div class="line">${esc(d.businessAddress)}</div>` : ""}
    ${d.businessPhone ? `<div class="line">ĐT: ${esc(d.businessPhone)}</div>` : ""}
    ${d.branchName ? `<div class="line" style="font-style:italic;">Chi nhánh: ${esc(d.branchName)}</div>` : ""}
  </div>
  <div class="docmeta">
    <div class="doc-type">${esc(d.documentType)}</div>
    <div class="doc-line">Số: <b>${esc(d.documentCode)}</b></div>
    <div class="doc-line">Ngày: ${formatShortDate(d.date)}</div>
  </div>
</div>`
}

${headerFieldsHtml ? `<div class="meta"><table>${headerFieldsHtml}</table></div>` : ""}
${isThermal && itemsBlock ? `<hr class="sep" />` : ""}
${itemsBlock}
${isThermal && summaryHtml ? `<hr class="sep" />` : ""}
${summaryHtml ? `<table class="summary">${summaryHtml}</table>` : ""}
${d.note ? `<div class="note"><strong>Ghi chú:</strong> ${esc(d.note)}</div>` : ""}${qrBlock}

<div class="footer">
  <div class="col">
    <div class="title">Người lập phiếu</div>
    <div class="cap">(Ký, ghi rõ họ tên)</div>
    <div>${esc(d.createdBy ?? "")}</div>
  </div>
  <div class="col">
    <div class="title">Người duyệt</div>
    <div class="cap">(Ký, ghi rõ họ tên)</div>
    <div></div>
  </div>
</div>

${
  d.businessFooter
    ? `<div class="bizfooter">${esc(d.businessFooter)}</div>`
    : isThermal
      ? `<div class="bizfooter">Cảm ơn Quý khách!</div>`
      : ""
}

</body></html>`;
}

/** Escape ký tự HTML để tên SP/ghi chú chứa &lt; &amp; " không phá layout phiếu in. */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtVnd(n: number): string {
  return formatCurrency(n);
}
