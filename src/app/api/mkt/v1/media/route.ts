import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterMediaBody = {
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  kind?: string;
  campaignId?: string;
  contentItemId?: string;
};

// Ghi record media sau khi client đã upload file lên Storage qua signed URL.
export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<RegisterMediaBody>(request);
  const invalid = requireFields(body, ["storagePath", "fileName"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_media_register", {
    p_storage_path: body.storagePath,
    p_file_name: body.fileName,
    p_mime_type: body.mimeType ?? null,
    p_size_bytes: body.sizeBytes ?? null,
    p_kind: body.kind ?? "image",
    p_campaign_id: body.campaignId || null,
    p_content_item_id: body.contentItemId || null,
  });
}
