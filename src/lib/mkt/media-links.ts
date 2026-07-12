/**
 * Parse link media từ nguồn ngoài (Google Drive / YouTube / TikTok) và dựng
 * URL nhúng xem trực tiếp + thumbnail — theo research 11/07:
 * - Drive: iframe /preview là endpoint Google chủ đích cho phép nhúng;
 *   thumbnail endpoint không chính thức nhưng vẫn chạy (lazy-load để né rate limit).
 * - YouTube: dùng youtube-nocookie; thumbnail i.ytimg không cần API.
 * - TikTok: player/v1 chính thức.
 * File phải bật chia sẻ "Anyone with the link" thì người khác mới xem được.
 */

export type ParsedMediaLink = {
  sourceType: "drive" | "onedrive" | "youtube" | "tiktok" | "image" | "video" | "other";
  externalId: string | null;
  /** URL nhúng iframe xem trực tiếp; null nếu không nhúng được (mở tab ngoài) */
  embedUrl: string | null;
  /** URL ảnh thumbnail cho lưới; null nếu không có */
  thumbnailUrl: string | null;
  /** Gợi ý loại media để form tự chọn đúng (ảnh/video) */
  kind?: "image" | "video";
};

// Đuôi file media trực tiếp (bỏ qua ?query hoặc #fragment phía sau)
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(?:[?#].*)?$/i;

export function parseMediaLink(rawUrl: string): ParsedMediaLink {
  let url = rawUrl.trim();

  // Người dùng dán nguyên mã nhúng <iframe src="..."> (OneDrive/Drive sinh ra)
  // → rút URL trong src rồi parse tiếp.
  const iframeSrc = url.match(/src\s*=\s*["']([^"']+)["']/i);
  if (iframeSrc) url = iframeSrc[1];

  // Google Drive: /file/d/<ID>/..., open?id=<ID>, uc?id=<ID>
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
    };
  }

  // YouTube: watch?v=, youtu.be/, /shorts/, /embed/
  const ytMatch =
    url.match(/youtube\.com\/watch\?[^#]*\bv=([a-zA-Z0-9_-]{6,})/) ??
    url.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/) ??
    url.match(/youtube\.com\/(?:shorts|embed)\/([a-zA-Z0-9_-]{6,})/);
  if (ytMatch) {
    const id = ytMatch[1];
    return {
      sourceType: "youtube",
      externalId: id,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    };
  }

  // TikTok: /@user/video/<ID>
  const ttMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (ttMatch) {
    const id = ttMatch[1];
    return {
      sourceType: "tiktok",
      externalId: id,
      embedUrl: `https://www.tiktok.com/player/v1/${id}`,
      thumbnailUrl: null,
    };
  }

  // OneDrive: chỉ link NHÚNG (onedrive.live.com/embed?...) xem trực tiếp được;
  // link chia sẻ thường (1drv.ms, sharepoint) → mở tab ngoài.
  if (/onedrive\.live\.com\/embed\?/i.test(url)) {
    return { sourceType: "onedrive", externalId: null, embedUrl: url, thumbnailUrl: null };
  }
  if (/1drv\.ms\/|onedrive\.live\.com\/|sharepoint\.com\//i.test(url)) {
    return { sourceType: "onedrive", externalId: null, embedUrl: null, thumbnailUrl: null };
  }

  // Link ẢNH trực tiếp (.jpg/.png…): dùng luôn URL làm thumbnail + xem trong popup.
  if (IMAGE_EXT.test(url)) {
    return { sourceType: "image", externalId: null, embedUrl: url, thumbnailUrl: url, kind: "image" };
  }
  // Link VIDEO trực tiếp (.mp4/.webm…): phát bằng thẻ <video> trong popup.
  // Không có ảnh tĩnh đại diện nên thumbnailUrl để null (lưới hiện icon phim).
  if (VIDEO_EXT.test(url)) {
    return { sourceType: "video", externalId: null, embedUrl: url, thumbnailUrl: null, kind: "video" };
  }

  return { sourceType: "other", externalId: null, embedUrl: null, thumbnailUrl: null };
}

/** Dựng lại embed/thumbnail từ dữ liệu đã lưu trong DB (source_type + external_id/url). */
export function buildMediaUrls(
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
  if (sourceType === "youtube" && externalId) {
    return {
      embedUrl: `https://www.youtube-nocookie.com/embed/${externalId}`,
      thumbnailUrl: `https://img.youtube.com/vi/${externalId}/hqdefault.jpg`,
    };
  }
  if (sourceType === "tiktok" && externalId) {
    // thumbnail TikTok không suy ra được từ ID — lấy qua oEmbed, lưu ở cột
    // thumbnail_url (ưu tiên ở tầng hiển thị), nên ở đây để null.
    return { embedUrl: `https://www.tiktok.com/player/v1/${externalId}`, thumbnailUrl: null };
  }
  if (sourceType === "image" && externalUrl) {
    // Ảnh trực tiếp: chính URL là cả thumbnail lẫn ảnh xem trong popup.
    return { embedUrl: externalUrl, thumbnailUrl: externalUrl };
  }
  if (sourceType === "video" && externalUrl) {
    // Video trực tiếp: phát bằng thẻ <video>; không có ảnh tĩnh đại diện.
    return { embedUrl: externalUrl, thumbnailUrl: null };
  }
  if (sourceType === "onedrive" && externalUrl) {
    // Chỉ link nhúng OneDrive mới hiển thị trong iframe được
    const embeddable = /onedrive\.live\.com\/embed\?/i.test(externalUrl);
    return { embedUrl: embeddable ? externalUrl : null, thumbnailUrl: null };
  }
  if (externalUrl) {
    // Nguồn khác: không nhúng, chỉ mở tab ngoài
    return { embedUrl: null, thumbnailUrl: null };
  }
  return { embedUrl: null, thumbnailUrl: null };
}
