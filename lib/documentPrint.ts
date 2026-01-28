import { formatCurrency } from '../constants';
import type { DocumentTemplate, PaperSize, TemplateLayout } from './documentTemplates';

export type DocumentLine = {
  sku?: string | null;
  name: string;
  quantity?: number | null;
  unit_price?: number | null;
  total: number;
  note?: string | null;
};

export type DocumentPayload = {
  title: string;
  doc_no: string;
  doc_date: string;
  branch_name?: string | null;
  from_name?: string | null;
  to_name?: string | null;
  customer_name?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  company: {
    name?: string;
    tax_code?: string;
    address?: string;
    phone?: string;
    logo_url?: string | null;
  };
  lines: DocumentLine[];
  subtotal: number;
  vat_rate?: number | null;
  vat_amount?: number | null;
  total: number;
};

type RenderOptions = {
  paperSize: PaperSize;
  layout: TemplateLayout;
  settings: DocumentTemplate['settings'];
};

const numberCell = (value?: number | null) => (value === null || value === undefined ? '' : formatCurrency(value));

const formatDate = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const renderTableHeader = (columns: TemplateLayout['columns']) =>
  columns
    .map((c) => `<th style="text-align:${c.align ?? 'left'}">${c.label}</th>`)
    .join('');

const renderTableRow = (columns: TemplateLayout['columns'], line: DocumentLine) => {
  return columns
    .map((c) => {
      let value = '';
      if (c.key === 'sku') value = line.sku ?? '';
      if (c.key === 'name') value = line.name ?? '';
      if (c.key === 'quantity') value = line.quantity?.toString() ?? '';
      if (c.key === 'unit_price') value = numberCell(line.unit_price ?? null);
      if (c.key === 'total') value = numberCell(line.total ?? 0);
      if (c.key === 'note') value = line.note ?? '';
      return `<td style="text-align:${c.align ?? 'left'}">${value}</td>`;
    })
    .join('');
};

const paperStyles = (paperSize: PaperSize) => {
  if (paperSize === '80mm') {
    return `
      @page { size: 80mm auto; margin: 6mm; }
      body { width: 72mm; }
    `;
  }
  if (paperSize === 'A5') {
    return `@page { size: A5; margin: 12mm; }`;
  }
  return `@page { size: A4; margin: 14mm; }`;
};

export function renderDocumentHtml(payload: DocumentPayload, options: RenderOptions): string {
  const { layout, settings, paperSize } = options;
  const showVat = Boolean(settings.show_vat);
  const showSignature = Boolean(layout.show_signature ?? settings.show_signature);
  const columns = layout.columns;
  const headerText = settings.header_text ? `<div class="note">${settings.header_text}</div>` : '';
  const footerText = settings.footer_text ? `<div class="note">${settings.footer_text}</div>` : '';
  const logo = settings.logo_url ? `<img class="logo" src="${settings.logo_url}" alt="logo" />` : '';

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          ${paperStyles(paperSize)}
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #111827; }
          .wrap { width: 100%; }
          .header { display: flex; align-items: flex-start; gap: 12px; }
          .logo { width: 56px; height: 56px; object-fit: contain; }
          h1 { font-size: ${paperSize === '80mm' ? '16px' : '18px'}; margin: 0; }
          .meta { margin-top: 4px; font-size: 12px; color: #374151; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 4px; font-size: 12px; }
          th { text-transform: uppercase; font-size: 11px; color: #6b7280; }
          .totals { margin-top: 8px; font-size: 12px; }
          .totals .row { display: flex; justify-content: space-between; margin-top: 4px; }
          .signature { margin-top: 18px; display: flex; justify-content: space-between; font-size: 12px; }
          .signature .box { text-align: center; min-width: 120px; }
          .note { margin-top: 8px; font-size: 12px; color: #374151; }
          .title { margin-top: 10px; font-weight: 700; text-align: center; }
          .subtle { color: #6b7280; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="header">
            ${logo}
            <div>
              <div><strong>${payload.company.name ?? ''}</strong></div>
              <div class="subtle">${payload.company.tax_code ?? ''}</div>
              <div class="subtle">${payload.company.address ?? ''}</div>
              <div class="subtle">${payload.company.phone ?? ''}</div>
            </div>
          </div>
          ${headerText}
          <div class="title">${payload.title}</div>
          <div class="meta">Số: ${payload.doc_no} | Ngày: ${formatDate(payload.doc_date)}</div>
          ${payload.branch_name ? `<div class="meta">Chi nhánh: ${payload.branch_name}</div>` : ''}
          ${payload.from_name ? `<div class="meta">Từ: ${payload.from_name}</div>` : ''}
          ${payload.to_name ? `<div class="meta">Đến: ${payload.to_name}</div>` : ''}
          ${payload.customer_name ? `<div class="meta">Khách hàng: ${payload.customer_name}</div>` : ''}
          ${payload.payment_method ? `<div class="meta">Thanh toán: ${payload.payment_method}</div>` : ''}
          <table>
            <thead>
              <tr>${renderTableHeader(columns)}</tr>
            </thead>
            <tbody>
              ${payload.lines.map((l) => `<tr>${renderTableRow(columns, l)}</tr>`).join('')}
            </tbody>
          </table>
          ${layout.show_totals !== false ? `
            <div class="totals">
              <div class="row"><span>Tạm tính</span><strong>${formatCurrency(payload.subtotal)}</strong></div>
              ${showVat ? `<div class="row"><span>VAT (${payload.vat_rate ?? 0}%)</span><strong>${formatCurrency(payload.vat_amount ?? 0)}</strong></div>` : ''}
              <div class="row"><span>Tổng cộng</span><strong>${formatCurrency(payload.total)}</strong></div>
            </div>
          ` : ''}
          ${payload.notes ? `<div class="note">${layout.note_label ?? 'Ghi chú'}: ${payload.notes}</div>` : ''}
          ${footerText}
          ${showSignature ? `
            <div class="signature">
              <div class="box">Người lập</div>
              <div class="box">Người nhận</div>
            </div>
          ` : ''}
        </div>
      </body>
    </html>
  `;
}

export function openPrintWindow(html: string, title: string) {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  win.focus();
  setTimeout(() => win.print(), 250);
}

export async function downloadPdf(html: string, fileName: string, paperSize: PaperSize) {
  const mod: any = await import('html2pdf.js');
  const html2pdf = mod?.default ?? mod;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const opt = {
    margin: 0,
    filename: fileName,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2 },
    jsPDF: {
      unit: 'mm',
      format: paperSize === 'A5' ? 'a5' : paperSize === 'A4' ? 'a4' : [80, 200],
      orientation: 'portrait',
    },
  };
  await html2pdf().from(wrapper).set(opt).save();
}

export async function exportToExcel(payload: DocumentPayload, fileName: string) {
  const mod: any = await import('xlsx');
  const XLSX = mod?.default ?? mod;

  const rows: Array<Array<string | number>> = [];
  rows.push([payload.company.name ?? '']);
  if (payload.company.tax_code) rows.push([payload.company.tax_code]);
  if (payload.company.address) rows.push([payload.company.address]);
  if (payload.company.phone) rows.push([payload.company.phone]);
  rows.push([]);
  rows.push([payload.title]);
  rows.push([`Số: ${payload.doc_no}`, `Ngày: ${formatDate(payload.doc_date)}`]);
  if (payload.branch_name) rows.push([`Chi nhánh: ${payload.branch_name}`]);
  if (payload.customer_name) rows.push([`Khách hàng: ${payload.customer_name}`]);
  if (payload.payment_method) rows.push([`Thanh toán: ${payload.payment_method}`]);
  rows.push([]);

  rows.push(['Mã', 'Tên hàng', 'SL', 'Đơn giá', 'Thành tiền', 'Ghi chú']);
  payload.lines.forEach((l) => {
    rows.push([
      l.sku ?? '',
      l.name ?? '',
      l.quantity ?? '',
      l.unit_price ?? '',
      l.total ?? '',
      l.note ?? '',
    ]);
  });

  rows.push([]);
  rows.push(['Tạm tính', '', '', '', payload.subtotal, '']);
  if (payload.vat_amount && payload.vat_rate !== null && payload.vat_rate !== undefined) {
    rows.push([`VAT (${payload.vat_rate}%)`, '', '', '', payload.vat_amount, '']);
  }
  rows.push(['Tổng cộng', '', '', '', payload.total, '']);
  if (payload.notes) rows.push(['Ghi chú', payload.notes]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ChungTu');
  XLSX.writeFile(wb, fileName);
}
