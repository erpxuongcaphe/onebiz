import { NextResponse } from "next/server";
import { requireMktSession } from "@/lib/mkt/api";
import { getMktDashboardData } from "@/lib/mkt/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const data = await getMktDashboardData(supabase);
  return NextResponse.json({ success: true, data });
}
