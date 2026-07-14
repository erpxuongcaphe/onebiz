/**
 * Parse link tài liệu (xlsx/docx/pdf…) và dựng URL nhúng xem trực tiếp.
 *
 * Trả lời câu hỏi cốt lõi "gắn link có xem thẳng được không":
 * - Google Drive / Docs / Sheets / Slides → iframe `/preview`: Google tự render
 *   MỌI định dạng (pdf/xlsx/docx/ppt) ngay trong web, không tốn kho.
 * - PDF trực tiếp (.pdf) → trình duyệt tự xem trong iframe.
 * - File Office công khai (.xlsx/.docx/.pptx) → bọc Office Online viewer của
 *   Microsoft (miễn phí). CHỈ chạy khi link công khai (server MS phải tải được).
 * - Còn lại → không xem thẳng, chỉ mở tab ngoài.
 *
 * File Drive phải bật chia sẻ "Bất kỳ ai có link — Người xem" thì người khác
 * mới xem được.
 */

export type DocSourceType =
  | "drive"
  | "gdoc"
  | "gsheet"
  | "gslide"
  | "onedrive"
  | "pdf"
  | "office_link"
  | "other";

export type ParsedDocumentLink = {
  sourceType: DocSourceType;
  externalId: string | null;
  /** URL nhúng iframe xem trực tiếp; null nếu chỉ mở tab ngoài */
  embedUrl: string | null;
  /** URL ảnh thumbnail cho lưới; null nếu dùng icon */
  thumbnailUrl: string | null;
  /** Xem trực tiếp trong web được không (quyết định nhãn xanh/vàng ở form) */
  canPreview: boolean;
};

const OFFICE_EXT = /\.(xlsx?|docx?|pptx?)(?:[?#].*)?$/i;
const PDF_EXT = /\.pdf(?:[?#].*)?$/i;

const OFFICE_VIEWER = "https://view.officeapps.live.com/op/view.aspx?src=";

/** Bọc file Office công khai qua Office Online viewer để xem trực tiếp. */
function officeViewer(url: string): string {
  return OFFICE_VIEWER + encodeURIComponent(url);
}

export function parseDocumentLink(rawUrl: string): ParsedDocumentLink {
  let url = rawUrl.trim();

  // Người dùng dán nguyên mã nhúng <iframe src="..."> → rút URL trong src.
  const iframeSrc = url.match(/src\s*=\s*["']([^"']+)["']/i);
  if (iframeSrc) url = iframeSrc[1];

  // Google Docs / Sheets / Slides: docs.google.com/<loại>/d/<ID>/...
  const gdocMatch = url.match(
    /docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/,
  );
  if (gdocMatch) {
    const kind = gdocMatch[1];
    const id = gdocMatch[2];
    const path =
      kind === "spreadsheets" ? "spreadsheets" : kind === "presentation" ? "presentation" : "document";
    const sourceType: DocSourceType =
      kind === "spreadsheets" ? "gsheet" : kind === "presentation" ? "gslide" : "gdoc";
    return {
      sourceType,
      externalId: id,
      embedUrl: `https://docs.google.com/${path}/d/${id}/preview`,
      thumbnailUrl: null,
      canPreview: true,
    };
  }

  // Google Drive file: /file/d/<ID>/..., open?id=<ID>, uc?id=<ID>
  const driveMatch =
    url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ??
    url.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([a-zA-Z0-9_-]+)/);
  if (driveMatch) {
    const id = driveMatch[1];
    return {
      sourceType: "drive",
      externalId: id,
      embedUrl: `https://drive.google.com/file/d/${id}/preview`,
      thumbnailUrl: `https://drive.google.com/thumbnail?id=${id}&sz=w400`,
      canPreview: true,
    };
  }

  // OneDrive: chỉ link NHÚNG (onedrive.live.com/embed?...) xem trực tiếp được.
  if (/onedrive\.live\.com\/embed\?/i.test(url)) {
    return { sourceType: "onedrive", externalId: null, embedUrl: url, thumbnailUrl: null, canPreview: true };
  }
  if (/1drv\.ms\/|onedrive\.live\.com\/|sharepoint\.com\//i.test(url)) {
    return { sourceType: "onedrive", externalId: null, embedUrl: null, thumbnailUrl: null, canPreview: false };
  }

  // PDF trực tiếp: trình duyệt tự render trong iframe.
  if (PDF_EXT.test(url)) {
    return { sourceType: "pdf", externalId: null, embedUrl: url, thumbnailUrl: null, canPreview: true };
  }

  // File Office công khai (.xlsx/.docx/.pptx): bọc Office Online viewer.
  if (OFFICE_EXT.test(url)) {
    return { sourceType: "office_link", externalId: null, embedUrl: officeViewer(url), thumbnailUrl: null, canPreview: true };
  }

  return { sourceType: "other", externalId: null, embedUrl: null, thumbnailUrl: null, canPreview: false };
}

/** Dựng lại embed/thumbnail từ dữ liệu đã lưu (source_type + external_id/url). */
export function buildDocumentUrls(
  sourceType: string,
  externalId: string | null,
  externalUrl: string | null,
): { embedUrl: string | null; thumbnailUrl: string | null } {
  if (sourceType === "drive" && externalId) {
    return {
      embedUrl: `https://drive.google.com/file/d/${externalId}/preview`,
      thumbnailUrl: `https://drive.google.com/thumbnail?id=${externalId}&sz=w400`,
    };
  }
  if (sourceType === "gdoc" && externalId) {
    return { embedUrl: `https://docs.google.com/document/d/${externalId}/preview`, thumbnailUrl: null };
  }
  if (sourceType === "gsheet" && externalId) {
    return { embedUrl: `https://docs.google.com/spreadsheets/d/${externalId}/preview`, thumbnailUrl: null };
  }
  if (sourceType === "gslide" && externalId) {
    return { embedUrl: `https://docs.google.com/presentation/d/${externalId}/preview`, thumbnailUrl: null };
  }
  if (sourceType === "pdf" && externalUrl) {
    return { embedUrl: externalUrl, thumbnailUrl: null };
  }
  if (sourceType === "office_link" && externalUrl) {
    // Bọc lại Office viewer từ URL gốc (không lưu URL đã bọc → sạch, dựng lại được).
    return { embedUrl: officeViewer(externalUrl), thumbnailUrl: null };
  }
  if (sourceType === "onedrive" && externalUrl) {
    const embeddable = /onedrive\.live\.com\/embed\?/i.test(externalUrl);
    return { embedUrl: embeddable ? externalUrl : null, thumbnailUrl: null };
  }
  return { embedUrl: null, thumbnailUrl: null };
}
