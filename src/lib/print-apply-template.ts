/**
 * Print Template Engine V3 — cầu nối giữa mẫu in (print_templates) và luồng in
 * thật (printDocument). P6a: map field SẠCH, zero-regression.
 *
 * NGUYÊN TẮC: khi resolvePrintTemplate trả null (tenant chưa có mẫu) →
 * printDocumentWithTemplate gọi printDocument(base, fallbackPaperSize) Y HỆT cũ.
 * Chỉ khi CÓ mẫu mới áp config. Lỗi resolve (mạng…) cũng fallback in cũ —
 * không để mẫu chặn in.
 */

import type { DocumentPrintData, DocumentLineItem, PaperSize } from "./print-document";
import { printDocument } from "./print-document";
import { resolvePrintTemplate } from "./services";
import type { PrintChannel, PrintDocType, ResolvedPrint } from "./services";

/** Ngữ cảnh thay token cho tiêu đề / customText. */
interface TokenContext {
  businessName?: string;
  branchName?: string;
  taxCode?: string;
  address?: string;
  phone?: string;
  documentCode?: string;
  date?: string;
  createdBy?: string;
}

/**
 * Thay token dạng `{ten_token}` trong chuỗi (không phân biệt hoa/thường).
 * Token không có giá trị → thay bằng chuỗi rỗng.
 */
export function applyTokens(text: string, ctx: TokenContext): string {
  if (!text) return text;
  const map: Record<string, string | undefined> = {
    ten_doanh_nghiep: ctx.businessName,
    ten_chi_nhanh: ctx.branchName,
    ma_so_thue: ctx.taxCode,
    dia_chi: ctx.address,
    hotline: ctx.phone,
    ma_don: ctx.documentCode,
    ngay_in: ctx.date,
    nhan_vien: ctx.createdBy,
  };
  return text.replace(/\{([a-zA-Z_]+)\}/g, (full, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (key in map) return map[key] ?? "";
    return full; // token lạ → giữ nguyên (không nuốt text người dùng)
  });
}

/**
 * Áp config của 1 mẫu đã resolve lên DocumentPrintData base.
 * CHỈ đụng field nào config có set; field config bỏ trống → GIỮ NGUYÊN base.
 * Brand (resolved.brand) đã merge tenant←branch ở service.
 */
export function applyTemplateToDocData(
  base: DocumentPrintData,
  resolved: ResolvedPrint,
): DocumentPrintData {
  // Clone nông + clone mảng items (sẽ chỉnh field từng item).
  const data: DocumentPrintData = {
    ...base,
    items: base.items ? base.items.map((it) => ({ ...it })) : base.items,
  };

  const brand = resolved.brand ?? {};
  const config = resolved.config ?? {};

  // Ngữ cảnh token: ưu tiên brand đã resolve, fallback giá trị base.
  const ctx: TokenContext = {
    businessName: brand.businessName ?? base.businessName,
    branchName: base.branchName,
    taxCode: brand.taxCode ?? base.businessTaxCode,
    address: brand.address ?? base.businessAddress,
    phone: brand.phone ?? base.businessPhone,
    documentCode: base.documentCode,
    date: base.date,
    createdBy: base.createdBy,
  };

  // ── Brand: chỉ override khi field brand CÓ giá trị ──────────
  if (brand.businessName !== undefined && brand.businessName !== null && brand.businessName !== "")
    data.businessName = brand.businessName;
  if (brand.taxCode !== undefined && brand.taxCode !== null && brand.taxCode !== "")
    data.businessTaxCode = brand.taxCode;
  if (brand.address !== undefined && brand.address !== null && brand.address !== "")
    data.businessAddress = brand.address;
  if (brand.phone !== undefined && brand.phone !== null && brand.phone !== "")
    data.businessPhone = brand.phone;
  if (brand.logoUrl !== undefined && brand.logoUrl !== null && brand.logoUrl !== "")
    data.businessLogoUrl = brand.logoUrl;
  if (brand.footer !== undefined && brand.footer !== null && brand.footer !== "")
    data.businessFooter = brand.footer;

  // ── Tiêu đề (cho phép token) ────────────────────────────────
  if (config.title !== undefined && config.title !== "") {
    data.documentType = applyTokens(config.title, ctx);
  }

  // ── Header toggles (chỉ ẩn khi === false; true/undefined → giữ) ──
  const h = config.header;
  if (h) {
    if (h.logo === false) data.businessLogoUrl = undefined;
    if (h.businessName === false) data.businessName = undefined;
    if (h.taxCode === false) data.businessTaxCode = undefined;
    if (h.address === false) data.businessAddress = undefined;
    if (h.phone === false) data.businessPhone = undefined;
    if (h.branch === false) data.branchName = undefined;
  }

  // ── Footer ──────────────────────────────────────────────────
  const f = config.footer;
  if (f) {
    if (f.signature === false) data.showSignature = false;
    if (f.thankYou === false) data.businessFooter = undefined;
    if (f.customText !== undefined && f.customText !== "") {
      const extra = applyTokens(f.customText, ctx);
      data.note = data.note ? `${data.note}\n${extra}` : extra;
    }
  }

  // ── Items: toggle cột (phần AN TOÀN — chỉ ẩn field item) ─────
  // CHỈ làm khi config.items.columns được truyền. Bỏ trống → giữ nguyên.
  const cols = config.items?.columns;
  if (Array.isArray(cols) && data.items && data.items.length) {
    const lower = cols.map((c) => String(c).toLowerCase());
    const hasPrice = lower.includes("price") || lower.includes("unitprice");
    const hasDiscount = lower.includes("discount");
    const hasCode = lower.includes("code");

    for (const it of data.items as DocumentLineItem[]) {
      if (!hasPrice) it.unitPrice = undefined;
      if (!hasDiscount) it.discount = undefined;
      if (!hasCode) it.code = undefined;
      // name / quantity / total LUÔN giữ.
    }

    // Build lại header itemColumns cho khớp cột còn lại.
    // Giữ nhãn giá theo base (mua = "Đơn giá nhập", bán = "Đơn giá").
    const baseCols = base.itemColumns ?? [];
    const priceLabel = baseCols.includes("Đơn giá nhập") ? "Đơn giá nhập" : "Đơn giá";
    const headers: string[] = [];
    if (hasCode) headers.push("Mã hàng");
    headers.push("Tên hàng");
    headers.push("SL");
    if (hasPrice) headers.push(priceLabel);
    if (hasDiscount) headers.push("Giảm giá");
    headers.push("Thành tiền");
    data.itemColumns = headers;
  }

  // KHÔNG đụng: config.items.fontSize, config.payment.*, config.customer.*
  // (để P6b — pipeline chưa có field tương ứng).

  return data;
}

export interface PrintWithTemplateOptions {
  channel: PrintChannel;
  docType: PrintDocType;
  branchId?: string | null;
  base: DocumentPrintData;
  fallbackPaperSize?: PaperSize;
}

/**
 * In 1 chứng từ qua engine mẫu in.
 * - Có mẫu → áp config + dùng paperSize của mẫu.
 * - Không có mẫu (null) hoặc resolve LỖI → in Y HỆT cũ:
 *   printDocument(base, { paperSize: fallbackPaperSize }).
 */
export async function printDocumentWithTemplate(
  opts: PrintWithTemplateOptions,
): Promise<void> {
  let resolved: ResolvedPrint | null = null;
  try {
    resolved = await resolvePrintTemplate(
      opts.channel,
      opts.docType,
      opts.branchId ?? null,
    );
  } catch {
    // Lỗi resolve (mạng/RLS…) → fallback in cũ, không chặn in.
    resolved = null;
  }

  if (!resolved) {
    printDocument(opts.base, { paperSize: opts.fallbackPaperSize });
    return;
  }

  const data = applyTemplateToDocData(opts.base, resolved);
  printDocument(data, { paperSize: resolved.paperSize });
}
