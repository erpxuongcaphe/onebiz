import { NextResponse } from "next/server";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import { getMktDashboardData } from "@/lib/mkt/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Phải truyền identity: getMktDashboardData chỉ nạp hàng đợi Leader khi
  // identity.isLead = true. Gọi thiếu tham số → leaderQueue luôn rỗng dù là Lead.
  const { supabase, signedIn, userId, ctx } = await getMktRequestContext();
  if (!signedIn) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Chưa đăng nhập" } },
      { status: 401 },
    );
  }

  const data = await getMktDashboardData(supabase, {
    userId,
    tenantId: ctx.tenantId,
    isLead: Boolean(ctx.isLead),
  });
  return NextResponse.json({ success: true, data });
}
