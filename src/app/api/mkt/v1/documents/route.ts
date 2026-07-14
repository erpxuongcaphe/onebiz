import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterDocumentBody = {
  title?: string;
  sourceType?: string; // drive | gdoc | gsheet | gslide | onedrive | pdf | office_link | other
  externalUrl?: string;
  externalId?: string;
  category?: string; // brief | brand | price | contract | report | other
  description?: string;
  mimeType?: string;
  thumbnailUrl?: string;
  campaignId?: string;
};

// Ghi record tài liệu từ link ngoài (Drive/Docs/PDF/Office). File thật nằm bên
// đó, web chỉ giữ metadata + link — xem trực tiếp qua iframe.
export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<RegisterDocumentBody>(request);
  const invalid = requireFields(body, ["title"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_document_register", {
    p_title: body.title,
    p_source_type: body.sourceType ?? "drive",
    p_external_url: body.externalUrl ?? null,
    p_external_id: body.externalId ?? null,
    p_category: body.category ?? "other",
    p_description: body.description ?? null,
    p_mime_type: body.mimeType ?? null,
    p_thumbnail_url: body.thumbnailUrl ?? null,
    p_storage_path: null,
    p_size_bytes: null,
    p_campaign_id: body.campaignId || null,
  });
}
