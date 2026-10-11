import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const parsed = z
    .object({
      runId: z.uuid(),
      criterion: z.string().min(1).max(100),
      slot: z
        .string()
        .regex(/^[1-9][0-9]*$/)
        .max(2),
    })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Lần quan sát không hợp lệ." },
      { status: 400 },
    );
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
        n: string,
        a: Record<string, unknown>,
      ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    }
  ).rpc("ops_measurements_for", {
    p_run: parsed.data.runId,
    p_criterion: parsed.data.criterion,
    p_slot: parsed.data.slot,
  });
  if (result.error)
    return NextResponse.json(
      {
        error:
          "Không tải được quan sát phù hợp. Kiểm tra quyền hoặc tạo quan sát mới.",
      },
      { status: result.error.message.includes("OPS_FORBIDDEN") ? 403 : 400 },
    );
  return NextResponse.json(
    { rows: result.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
