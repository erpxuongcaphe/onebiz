import { NextResponse } from "next/server";
import { readHubAccess } from "@/lib/operations/access";
export const dynamic = "force-dynamic";
export async function GET() {
  const result = await readHubAccess();
  return NextResponse.json(result, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
}
