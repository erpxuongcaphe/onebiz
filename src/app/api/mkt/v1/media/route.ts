import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterMediaBody = {
  fileName?: string;
  sourceType?: string; // upload | drive | youtube | tiktok | other
  storagePath?: string;
  externalUrl?: string;
  externalId?: string;
  mimeType?: string;
  sizeBytes?: number;
  kind?: string;
  campaignId?: string;
  contentItemId?: string;
};

// Ghi record media: sau upload Storage (sourceType=upload) HOẶC thêm từ link
// ngoài (Drive/YouTube/TikTok — file thật nằm bên đó, web chỉ giữ metadata).
export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<RegisterMediaBody>(request);
  const invalid = requireFields(body, ["fileName"]);
  if (invalid) return invalid;

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
  });
}
