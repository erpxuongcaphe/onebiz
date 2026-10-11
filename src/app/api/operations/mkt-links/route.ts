import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
export const dynamic = "force-dynamic";
async function execute(name: string, args: Record<string, unknown>) {
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
  ).rpc(name, args);
  if (result.error)
    return NextResponse.json(
      {
        error:
          "Không đọc hoặc liên kết được. Cần quyền đối với cả To-do và công việc MKT.",
      },
      { status: result.error.message.includes("OPS_FORBIDDEN") ? 403 : 400 },
    );
  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function GET(request: NextRequest) {
  const parsed = z
    .object({
      todoId: z.uuid().optional(),
      taskId: z.uuid().optional(),
      search: z.string().max(200).default(""),
    })
    .strict()
    .refine((v) => !!v.todoId !== !!v.taskId)
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Chọn công việc hợp lệ." },
      { status: 400 },
    );
  return execute("ops_mkt_links_read", {
    p_todo: parsed.data.todoId ?? null,
    p_task: parsed.data.taskId ?? null,
    p_search: parsed.data.search,
  });
}
export async function POST(request: NextRequest) {
  if (!isOperationsSameOrigin(request))
    return NextResponse.json(
      { error: "Yêu cầu không hợp lệ." },
      { status: 403 },
    );
  const raw = await request.text();
  if (raw.length > 2000)
    return NextResponse.json({ error: "Nội dung quá dài." }, { status: 400 });
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "Nội dung không hợp lệ." },
      { status: 400 },
    );
  }
  const parsed = z
    .object({ todoId: z.uuid(), taskId: z.uuid() })
    .strict()
    .safeParse(value);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Chọn công việc hợp lệ." },
      { status: 400 },
    );
  return execute("ops_mkt_link", {
    p_todo: parsed.data.todoId,
    p_task: parsed.data.taskId,
  });
}
