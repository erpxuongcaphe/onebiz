import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Xoá mềm gói việc (kênh triển khai) + xoá mềm luôn task/kế hoạch bên trong.
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { id } = await context.params;

  return callMktRpc(supabase, "mkt_delete_work_package", {
    p_work_package_id: id,
    p_reason: null,
  });
}
