import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AddSubplanBody = { title?: string; channelType?: string };

// 00215: người ĐƯỢC GIAO mảng (owner nút cấp 2/3) tự thêm Kế hoạch phụ vào
// mảng của mình — hàm tạo luôn plan (owner = họ) để soạn ngay.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ nodeId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { nodeId } = await context.params;
  const body = await readJsonBody<AddSubplanBody>(request);
  const invalid = requireFields(body, ["title"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_owner_add_subplan", {
    p_campaign_plan_id: nodeId,
    p_title: body.title,
    p_channel_type: body.channelType || "other",
  });
}
