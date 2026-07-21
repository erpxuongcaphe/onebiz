import { type NextRequest, NextResponse } from "next/server";
import { requireMktSession } from "@/lib/mkt/api";
import { getPlanActivity } from "@/lib/mkt/read-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nhật ký thay đổi của một kế hoạch (00222). Đọc audit_log qua RLS tenant.
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ planId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { planId } = await context.params;
  try {
    const entries = await getPlanActivity(supabase, planId);
    return NextResponse.json({ success: true, entries });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "ACTIVITY_READ_FAILED",
          message: e instanceof Error ? e.message : "Không đọc được nhật ký",
        },
      },
      { status: 500 },
    );
  }
}
