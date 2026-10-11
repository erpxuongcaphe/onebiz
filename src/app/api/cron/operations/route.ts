import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (
    !secret ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = getAdminClient() as unknown as {
    rpc(name: string): PromiseLike<{ data: unknown; error: unknown }>;
  };
  const result = await client.rpc("ops_tick");
  if (result.error)
    return NextResponse.json(
      { error: "Không chạy được lịch Vận hành." },
      { status: 503 },
    );
  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "no-store" },
  });
}
