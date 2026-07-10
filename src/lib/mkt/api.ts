import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";

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
        { success: false, error: { code: "UNAUTHENTICATED", message: "Chua dang nhap" } },
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
) {
  const { data, error } = await getMktDatabaseClient(supabase).rpc(
    rpcName,
    args,
  );
  if (error) return mktErrorResponse(error);
  return NextResponse.json(data ?? { success: true });
}
