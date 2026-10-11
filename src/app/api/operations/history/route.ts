import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const schema = z
  .object({
    branch: z.uuid(),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    kind: z.enum(["audit", "todos"]),
    cursorAt: z.string().datetime({ offset: true }).nullable(),
    cursorId: z.uuid().nullable(),
  })
  .refine((v) => !!v.cursorAt === !!v.cursorId);

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const parsed = schema.safeParse({
    branch: query.get("branch"),
    period: query.get("period"),
    kind: query.get("kind") ?? "audit",
    cursorAt: query.get("cursorAt"),
    cursorId: query.get("cursorId"),
  });
  if (!parsed.success)
    return NextResponse.json(
      { error: "Bộ lọc lịch sử không hợp lệ." },
      { status: 400 },
    );
  const client = await createServerSupabaseClient();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user)
    return NextResponse.json(
      { error: "Vui lòng đăng nhập lại." },
      { status: 401 },
    );
  const rpc = client as unknown as {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{
      data: unknown;
      error: { code?: string; message: string } | null;
    }>;
  };
  const result = await rpc.rpc("ops_history", {
    p_branch: parsed.data.branch,
    p_period: parsed.data.period,
    p_kind: parsed.data.kind,
    p_cursor_at: parsed.data.cursorAt,
    p_cursor_id: parsed.data.cursorId,
  });
  if (result.error)
    return NextResponse.json(
      {
        error: result.error.message.includes("OPS_FORBIDDEN")
          ? "Bạn chưa có quyền xem lịch sử chi nhánh này."
          : "Không tải được lịch sử. Vui lòng tải lại chủ động.",
      },
      { status: result.error.message.includes("OPS_FORBIDDEN") ? 403 : 503 },
    );
  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
