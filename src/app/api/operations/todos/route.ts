import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const schema = z
  .object({
    branch: z.uuid().nullable(),
    search: z.string().max(200),
    mine: z.enum(["true", "false"]),
    closed: z.enum(["true", "false"]).nullable(),
    due: z.string().datetime({ offset: true }).nullable(),
    id: z.uuid().nullable(),
  })
  .refine(
    (v) =>
      [v.closed, v.due, v.id].filter((value) => value !== null).length % 3 ===
      0,
  );

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const parsed = schema.safeParse({
    branch: q.get("branch"),
    search: q.get("search") ?? "",
    mine: q.get("mine") ?? "false",
    closed: q.get("closed"),
    due: q.get("due"),
    id: q.get("id"),
  });
  if (!parsed.success)
    return NextResponse.json(
      { error: "Bộ lọc To-do không hợp lệ." },
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
    ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const v = parsed.data;
  const result = await rpc.rpc("ops_todo_page", {
    p_branch: v.branch,
    p_search: v.search,
    p_only_mine: v.mine === "true",
    p_cursor_closed: v.closed === null ? null : v.closed === "true",
    p_cursor_due: v.due,
    p_cursor_id: v.id,
  });
  if (result.error)
    return NextResponse.json(
      {
        error: result.error.message.includes("OPS_FORBIDDEN")
          ? "Bạn chưa có quyền xem To-do này."
          : "Không tải được To-do. Vui lòng tải lại chủ động.",
      },
      { status: result.error.message.includes("OPS_FORBIDDEN") ? 403 : 503 },
    );
  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
