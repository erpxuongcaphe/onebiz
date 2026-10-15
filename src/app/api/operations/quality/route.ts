import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
import {
  qualityCommandSchema,
  qualityReadSchema,
} from "@/lib/operations/quality-contracts";

export const dynamic = "force-dynamic";
const messages: Record<string, string> = {
  OPS_UNAUTHENTICATED: "Vui lòng đăng nhập lại OneBiz.",
  OPS_FORBIDDEN:
    "Bạn chưa có quyền hoặc không được phân công trong phạm vi này.",
  OPS_STALE:
    "Có người vừa cập nhật. Tải lại trước khi lưu, nội dung đang nhập vẫn được giữ.",
  OPS_REQUEST_CONFLICT:
    "Yêu cầu đã được sử dụng cho nội dung khác. Kiểm tra lại trước khi gửi.",
  OPS_PERIOD_LOCKED: "Kỳ đã chốt; không được ghi đè kết quả cũ.",
  OPS_PAST_EFFECTIVE: "Ngày hiệu lực không được ở quá khứ.",
  OPS_Q_ISSUE_REQUIRED:
    "Kết quả Không đạt cần tạo hoặc liên kết ít nhất một To-do.",
  OPS_Q_INVALID_LINK:
    "To-do không còn mở hoặc không thuộc đúng chi nhánh/hạng mục.",
  OPS_Q_MISSING_RESULT: "Chưa đủ kết quả hoặc bằng chứng bắt buộc.",
  OPS_Q_RECHECK_REQUIRED:
    "Quản lý chịu trách nhiệm cần kiểm tra lại để tiếp tục hoặc đóng việc.",
  OPS_Q_RESOLUTION_REQUIRED:
    "Ghi rõ kết quả khắc phục trước khi gửi quản lý kiểm tra lại.",
  OPS_Q_POLICY_INCOMPLETE:
    "Chính sách điểm chưa được cấu hình và duyệt đầy đủ. Vẫn có thể lưu QC nháp.",
  OPS_Q_POLICY_CHANGED:
    "Kỳ này đã có chính sách chấm điểm. Không đổi chính sách giữa kỳ.",
  OPS_Q_REWARD_INCOMPLETE: "Chưa đủ điểm, quỹ hoặc phân bổ để chốt thưởng.",
  OPS_Q_CATALOG_REQUIRED: "Chưa có danh mục tiêu chuẩn QC có hiệu lực.",
  OPS_Q_ACCOUNTING_CHOICE_REQUIRED: "Tải mẫu Excel mới và chọn Có hoặc Không tại cột Cần xác nhận kế toán cho từng dòng.",
  OPS_Q_EVIDENCE_REQUIRED: "Mục cộng điểm cần minh chứng cụ thể.",
  OPS_Q_ACCOUNTING_REQUIRED:
    "Chọn số liệu kế toán đã xác nhận đúng chi nhánh và kỳ QC.",
  OPS_Q_LOCKED: "Hồ sơ đã đóng; dùng hồ sơ tái phát hoặc điều chỉnh có lý do.",
  OPS_Q_USE_WORKFLOW:
    "Hồ sơ này dùng luồng kiểm tra và xác nhận mới trong Hub.",
  OPS_REASON_REQUIRED: "Cần ghi rõ lý do và minh chứng.",
  OPS_DEFINITION_MISMATCH:
    "Chưa đủ nguồn doanh thu đã duyệt, chỉ tiêu và chính sách thưởng kinh doanh phù hợp.",
  OPS_PERIOD_NOT_ENDED: "Chỉ chốt sau khi kỳ kết thúc.",
  OPS_INVALID_ASSIGNEE:
    "Chọn quản lý đang được phân công và có quyền làm việc tại chi nhánh.",
};
function failure(error: { message: string; code?: string }) {
  if (["PGRST202", "42883", "42P01"].includes(error.code ?? ""))
    return NextResponse.json(
      {
        error:
          "Phần QC mới chưa được kích hoạt. Không có dữ liệu nào được ghi.",
        setupRequired: true,
      },
      { status: 503 },
    );
  const code = Object.keys(messages).find((k) => error.message.includes(k));
  return NextResponse.json(
    {
      error: code
        ? messages[code]
        : "Chưa lưu được. Kiểm tra trường bắt buộc và định dạng dữ liệu; nội dung đang nhập vẫn được giữ.",
    },
    {
      status:
        code === "OPS_UNAUTHENTICATED"
          ? 401
          : code === "OPS_FORBIDDEN"
            ? 403
            : code === "OPS_STALE"
              ? 409
              : 400,
    },
  );
}
async function context() {
  const client = await createServerSupabaseClient();
  const user = await client.auth.getUser();
  return {
    valid: !user.error && !!user.data.user,
    rpc: client as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): PromiseLike<{
        data: unknown;
        error: { message: string; code?: string } | null;
      }>;
    },
  };
}
export async function GET(request: NextRequest) {
  const parsed = qualityReadSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Bộ lọc, chi nhánh hoặc khoảng ngày chưa hợp lệ." },
      { status: 400 },
    );
  const { valid, rpc } = await context();
  if (!valid) return failure({ message: "OPS_UNAUTHENTICATED" });
  const { branch, period, kind, ...filters } = parsed.data;
  const result = await rpc.rpc("ops_quality_read", {
    p_branch: branch,
    p_period: period,
    p_kind: kind,
    p_filters: filters,
  });
  return result.error
    ? failure(result.error)
    : NextResponse.json(result.data, {
        headers: { "Cache-Control": "private, no-store" },
      });
}
export async function POST(request: NextRequest) {
  if (!isOperationsSameOrigin(request))
    return failure({ message: "OPS_FORBIDDEN" });
  const max = 200000;
  if (Number(request.headers.get("content-length") ?? 0) > max)
    return NextResponse.json({ error: "Nội dung quá lớn." }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader)
    return NextResponse.json({ error: "Không có nội dung." }, { status: 400 });
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > max) {
      await reader.cancel();
      return NextResponse.json({ error: "Nội dung quá lớn." }, { status: 413 });
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text + decoder.decode());
  } catch {
    return NextResponse.json(
      { error: "Nội dung không hợp lệ." },
      { status: 400 },
    );
  }
  const parsed = qualityCommandSchema.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Kiểm tra thao tác, chi nhánh và mã yêu cầu." },
      { status: 400 },
    );
  const { valid, rpc } = await context();
  if (!valid) return failure({ message: "OPS_UNAUTHENTICATED" });
  const result = await rpc.rpc("ops_quality_execute", {
    p_action: parsed.data.action,
    p_payload: parsed.data.payload,
    p_request_id: parsed.data.requestId,
  });
  return result.error
    ? failure(result.error)
    : NextResponse.json(
        { result: result.data },
        { headers: { "Cache-Control": "private, no-store" } },
      );
}
