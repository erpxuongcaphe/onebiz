import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterMediaBody = {
  fileName?: string;
  sourceType?: string; // upload | drive | onedrive | youtube | tiktok | image | video | other
  storagePath?: string;
  externalUrl?: string;
  externalId?: string;
  mimeType?: string;
  sizeBytes?: number;
  kind?: string;
  campaignId?: string;
  contentItemId?: string;
  thumbnailUrl?: string;
};

// TikTok không có URL thumbnail suy ra được từ ID (khác YouTube). oEmbed là
// endpoint công khai của TikTok trả về ảnh đại diện — gọi phía server để né
// CORS, có timeout + nuốt lỗi (thất bại thì lưới chỉ hiện icon, không chặn thêm).
async function fetchTikTokThumbnail(videoUrl: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { thumbnail_url?: unknown };
    return typeof data.thumbnail_url === "string" ? data.thumbnail_url : null;
  } catch {
    return null;
  }
}

// Ghi record media: sau upload Storage (sourceType=upload) HOẶC thêm từ link
// ngoài (Drive/YouTube/TikTok — file thật nằm bên đó, web chỉ giữ metadata).
export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<RegisterMediaBody>(request);
  const invalid = requireFields(body, ["fileName"]);
  if (invalid) return invalid;

  // TikTok: lấy ảnh đại diện lúc thêm link để lưới hiện xem trước (không chỉ icon).
  let thumbnailUrl = body.thumbnailUrl ?? null;
  if (!thumbnailUrl && body.sourceType === "tiktok" && body.externalUrl) {
    thumbnailUrl = await fetchTikTokThumbnail(body.externalUrl);
  }

  return callMktRpc(supabase, "mkt_media_register", {
    p_file_name: body.fileName,
    p_source_type: body.sourceType ?? "upload",
    p_storage_path: body.storagePath ?? null,
    p_external_url: body.externalUrl ?? null,
    p_external_id: body.externalId ?? null,
    p_mime_type: body.mimeType ?? null,
    p_size_bytes: body.sizeBytes ?? null,
    p_kind: body.kind ?? "image",
    p_campaign_id: body.campaignId || null,
    p_content_item_id: body.contentItemId || null,
    p_thumbnail_url: thumbnailUrl,
  });
}
