import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { commandSchema } from "@/lib/operations/contracts";
import { z } from "zod";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";

export const dynamic = "force-dynamic";
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
}
const errors: Record<string, string> = {
  OPS_WORKBOOK_APPROVAL_REQUIRED: "Công việc thuộc bộ nhập Excel. Duyệt cả bộ trong màn hình nhập để công việc và QC được áp dụng cùng nhau.",
  OPS_Q_USE_WORKFLOW: "Hồ sơ này dùng luồng mới. Về Công việc hoặc To-do trong Hub mới để ghi kết quả và kiểm tra lại.",
  OPS_FORBIDDEN: "Bạn chưa có quyền thực hiện ở chi nhánh này.",
  OPS_PROPOSAL_SCOPE: "Chỉ đề xuất việc riêng hoặc phiên bản của việc riêng trong chi nhánh được giao.",
  OPS_INVALID_PROPOSAL: "Kiểm tra tên công việc, lịch, ngày áp dụng và tiêu chí của đề xuất.",
  OPS_UNAUTHENTICATED: "Vui lòng đăng nhập lại.",
  OPS_STALE: "Có người đã cập nhật công việc. Hãy tải lại trước khi lưu.",
  OPS_PERIOD_LOCKED: "Kỳ đã chốt. Không được sửa kết quả kỳ này.",
  OPS_SOURCE_UNMET:
    "Công việc gốc chưa đạt. Cần bổ sung kết quả Standard Working trước khi hoàn thành To-do.",
  OPS_VERIFICATION_REQUIRED: "Cần đủ kết quả và xác minh trước khi chốt.",
  OPS_DEFINITION_MISMATCH:
    "Thiếu chỉ tiêu, nguồn đã duyệt hoặc chính sách; định nghĩa doanh thu phải khớp chỉ tiêu.",
  OPS_REPLACE_REASON_REQUIRED: "Cần lý do thay thế nguồn doanh thu đã duyệt.",
  OPS_REASON_REQUIRED: "Cần ghi rõ lý do.",
  OPS_PERIOD_NOT_ENDED: "Chỉ chốt sau khi kỳ kết thúc.",
  OPS_PAST_EFFECTIVE: "Ngày áp dụng phải từ hôm nay, không hồi tố.",
  OPS_INVALID_ASSIGNEE:
    "Người phụ trách cần quyền xem/làm việc Hub và được phân công quản lý tại chi nhánh.",
  OPS_RESULT_LOCKED:
    "Kết quả đã hoàn thành. Người xác minh phải ghi nhận điều chỉnh có lý do.",
  OPS_INVALID_CRITERIA:
    "Kiểm tra tiêu chí: ngưỡng hợp lệ, 1–50 lần kiểm tra; các giờ theo HH:mm phải không trùng và bằng số lần kiểm tra.",
  OPS_DUPLICATE_CRITERION:
    "Hai tiêu chí đang dùng cùng mã. Chọn tiêu chí khác hoặc tự thiết lập.",
  OPS_INVALID_RATIO:
    "Tỷ lệ cần tử số không âm, mẫu số lớn hơn 0 và tử số không vượt mẫu số.",
  OPS_WAITING_REQUIRED: "Khi chờ phối hợp, cần ghi lý do và ngày theo dõi lại.",
  OPS_CATCHUP_RANGE:
    "Lịch thiếu quá 366 ngày. Cần kiểm tra ngày hiệu lực trước khi tạo lịch.",
  OPS_REQUEST_CONFLICT:
    "Yêu cầu lưu đã được dùng cho nội dung khác. Tải lại và kiểm tra trước khi gửi.",
  OPS_INVALID_MEASUREMENT:
    "Quan sát không phù hợp ngày, phạm vi hoặc lần đo. Chọn lại hoặc ghi quan sát mới.",
  OPS_INVALID_RANGE: "Chọn chi nhánh và kỳ báo cáo hợp lệ.",
};
function failure(message: string) {
  const code = Object.keys(errors).find((key) => message.includes(key));
  return NextResponse.json(
    {
      error: code
        ? errors[code]
        : "Không lưu được. Kiểm tra thông tin bắt buộc hoặc liên hệ người quản trị.",
    },
    {
      status:
        code === "OPS_UNAUTHENTICATED"
          ? 401
          : code === "OPS_FORBIDDEN"
            ? 403
            : 400,
    },
  );
}
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return failure("OPS_UNAUTHENTICATED");
  const period = request.nextUrl.searchParams.get("period");
  const branch = request.nextUrl.searchParams.get("branch");
  if (
    !z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .safeParse(period).success ||
    (branch && !z.uuid().safeParse(branch).success)
  )
    return failure("OPS_INVALID_RANGE");
  const access = await (supabase as unknown as RpcClient).rpc("ops_access_context", {});
  if (access.error) return NextResponse.json({ error: "Chưa kiểm tra được quyền Hub. Vui lòng tải lại chủ động.", setupRequired: ["PGRST202", "42883"].includes(access.error.code ?? "") }, { status: 503 });
  if (!(access.data as { allowed?: boolean } | null)?.allowed) return failure("OPS_FORBIDDEN");
  const result = await (supabase as unknown as RpcClient).rpc("ops_workspace", {
    p_branch: branch || null,
    p_period: period,
  });
  if (result.error) {
    if (["PGRST202", "42883"].includes(result.error.code ?? ""))
      return NextResponse.json(
        {
          error:
            "Nền Vận hành chưa được kích hoạt trên database. Chưa có dữ liệu nào được ghi.",
          setupRequired: true,
        },
        { status: 503 },
      );
    return failure(result.error.message);
  }
  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function POST(request: NextRequest) {
  if (!isOperationsSameOrigin(request)) return failure("OPS_FORBIDDEN");
  if (Number(request.headers.get("content-length") ?? 0) > 200000)
    return failure("OPS_INVALID_RESULT");
  const raw = await request.text();
  if (raw.length > 200000) return failure("OPS_INVALID_RESULT");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return failure("OPS_INVALID_RESULT");
  }
  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) return failure("OPS_INVALID_RESULT");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return failure("OPS_UNAUTHENTICATED");
  const result = await (supabase as unknown as RpcClient).rpc("ops_execute", {
    p_action: parsed.data.action,
    p_payload: parsed.data.payload,
    p_request_id: parsed.data.requestId,
  });
  return result.error
    ? failure(result.error.message)
    : NextResponse.json({ result: result.data });
}
