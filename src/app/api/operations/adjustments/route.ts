import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
export const dynamic = "force-dynamic";
const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("propose"),
      periodId: z.uuid(),
      baseRevision: z.number().int().nonnegative(),
      revenueCents: amount,
      targetCents: amount.min(1),
      reason: z.string().trim().min(5).max(2000),
      evidence: z.string().trim().min(3).max(2000),
      requestId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("propose_result"),
      periodId: z.uuid(),
      baseRevision: z.number().int().nonnegative(),
      changes: z
        .array(
          z
            .object({
              runId: z.uuid(),
              observations: z
                .array(z.record(z.string(), z.unknown()))
                .max(2500),
              criteria: z
                .array(z.record(z.string(), z.unknown()))
                .min(1)
                .max(50)
                .optional(),
            })
            .strict(),
        )
        .min(1)
        .max(20),
      reason: z.string().trim().min(5).max(2000),
      evidence: z.string().trim().min(3).max(2000),
      requestId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      id: z.uuid(),
      note: z.string().trim().min(5).max(2000),
    })
    .strict(),
]);
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
        name: string,
        args: Record<string, unknown>,
      ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    }
  ).rpc(name, args);
  if (result.error) {
    const message = result.error.message;
    return NextResponse.json(
      {
        error: message.includes("OPS_FORBIDDEN")
          ? "Chưa được phép điều chỉnh hoặc duyệt kỳ này."
          : message.includes("OPS_STALE")
            ? "Kỳ đã có phiên bản mới. Tải lại trước khi đề nghị hoặc duyệt."
            : "Không lưu được điều chỉnh. Kiểm tra số tiền, lý do và minh chứng.",
      },
      { status: message.includes("OPS_FORBIDDEN") ? 403 : 400 },
    );
  }
  return NextResponse.json(
    { result: result.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("periodId");
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: "Kỳ không hợp lệ." }, { status: 400 });
  return execute("ops_adjustments", { p_period: id });
}
export async function POST(request: NextRequest) {
  if (!isOperationsSameOrigin(request))
    return NextResponse.json(
      { error: "Yêu cầu không hợp lệ." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 200000)
    return NextResponse.json({ error: "Nội dung quá dài." }, { status: 400 });
  const raw = await request.text();
  if (raw.length > 200000)
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
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Điền đủ số tiền, lý do và minh chứng hợp lệ." },
      { status: 400 },
    );
  const v = parsed.data;
  if (v.action === "propose_result")
    return execute("ops_propose_result_adjustment", {
      p_period: v.periodId,
      p_base: v.baseRevision,
      p_changes: v.changes,
      p_reason: v.reason,
      p_evidence: v.evidence,
      p_request: v.requestId,
    });
  return v.action === "approve"
    ? execute("ops_approve_adjustment", { p_id: v.id, p_note: v.note })
    : execute("ops_propose_adjustment", {
        p_period: v.periodId,
        p_base: v.baseRevision,
        p_revenue: v.revenueCents,
        p_target: v.targetCents,
        p_reason: v.reason,
        p_evidence: v.evidence,
        p_request: v.requestId,
      });
}
