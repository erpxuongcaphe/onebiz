import { NextRequest, NextResponse } from "next/server";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
async function read(id: string | null) {
  const client = await createServerSupabaseClient();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user)
    return NextResponse.json(
      { error: "Vui lòng đăng nhập lại." },
      { status: 401 },
    );
  const result = await (
    client as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): PromiseLike<{ data: unknown; error: unknown }>;
    }
  ).rpc("ops_inbox", { p_read: id });
  if (result.error)
    return NextResponse.json(
      { error: "Không tải được thông báo." },
      { status: 503 },
    );
  return NextResponse.json(
    { rows: result.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function GET() {
  return read(null);
}
export async function POST(request: NextRequest) {
  if (!isOperationsSameOrigin(request))
    return NextResponse.json(
      { error: "Yêu cầu không hợp lệ." },
      { status: 403 },
    );
  const body = await request.json().catch(() => null);
  const parsed = z.object({ id: z.uuid() }).strict().safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Thông báo không hợp lệ." },
      { status: 400 },
    );
  return read(parsed.data.id);
}
