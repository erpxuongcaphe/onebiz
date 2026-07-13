import { NextResponse, type NextRequest, after } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { processPendingOutbox } from "@/lib/mkt/outbox";

export const MKT_ERROR_STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  NOT_ASSIGNEE: 403,
  INSUFFICIENT_ROLE: 403,
  READINESS_NOT_READY: 403,
  NOT_FOUND: 404,
  ALREADY_PROCESSED: 409,
  INVALID_STATE: 400,
  MISSING_REASON: 400,
  DEPENDENCY_BLOCKED: 400,
  CONTENT_NOT_APPROVED: 400,
  REVIEW_TASK_REQUIRES_REVIEW_API: 400,
  MISSING_SOURCE_ID: 400,
  INVALID_SOURCE_REFERENCE: 400,
  INVALID_CONTENT_LINK: 400,
  INVALID_CONTENT_URL: 400,
  STALE_CONTENT_VERSION: 409,
  CROSS_TENANT_REFERENCE: 403,
  PLAN_VERSION_CONFLICT: 409,
  PLAN_VALIDATION_FAILED: 400,
};

export type MktSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export async function requireMktSession() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      supabase,
      user: null,
      response: NextResponse.json(
        { success: false, error: { code: "UNAUTHENTICATED", message: "Chưa đăng nhập" } },
        { status: 401 },
      ),
    };
  }

  return { supabase, user, response: null };
}

export async function readJsonBody<T extends object>(
  request: NextRequest,
): Promise<Partial<T>> {
  return (await request.json().catch(() => ({}))) as Partial<T>;
}

/**
 * Kiểm tra các field bắt buộc trong body. Trả về NextResponse 400 (message
 * tiếng Việt có dấu) nếu thiếu — đỡ 1 vòng gọi DB; trả null nếu đủ.
 */
export function requireFields(
  body: Record<string, unknown>,
  fields: readonly string[],
): NextResponse | null {
  const missing = fields.filter((f) => {
    const v = body[f];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (missing.length === 0) return null;
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "INVALID_STATE",
        message: `Thiếu thông tin bắt buộc: ${missing.join(", ")}`,
      },
    },
    { status: 400 },
  );
}

export function mktErrorResponse(error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "UNKNOWN")
      : String(error ?? "UNKNOWN");

  const code =
    Object.keys(MKT_ERROR_STATUS).find((candidate) =>
      message.toUpperCase().includes(candidate),
    ) ?? "INVALID_STATE";

  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: MKT_ERROR_STATUS[code] ?? 400 },
  );
}

export async function callMktRpc(
  supabase: MktSupabaseClient,
  rpcName: string,
  args: Record<string, unknown>,
  opts?: { notifyAfter?: boolean },
) {
  const { data, error } = await getMktDatabaseClient(supabase).rpc(
    rpcName,
    args,
  );
  if (error) return mktErrorResponse(error);

  // Gửi Telegram tức thời SAU khi trả response (không chặn user). Cron sweeper
  // vẫn là lưới an toàn nếu after() không chạy (môi trường không hỗ trợ).
  if (opts?.notifyAfter) {
    after(() => processPendingOutbox(5).catch(() => {}));
  }

  return NextResponse.json(data ?? { success: true });
}
