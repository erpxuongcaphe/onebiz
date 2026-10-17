import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
import { libraryCommandSchema } from "@/lib/operations/working-library";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Rpc = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };
const failure = (error: string, status = 400) => NextResponse.json({ error }, { status, headers });
export async function GET() {
  const client = await createServerSupabaseClient();
  const session = await client.auth.getUser();
  if (session.error || !session.data.user) return failure("Vui lòng đăng nhập lại.", 401);
  const result = await (client as unknown as Rpc).rpc("ops_working_library_read", {});
  if (result.error) return failure("Chưa đọc được bộ tiêu chí chung hoặc bạn chưa có quyền thiết lập.", result.error.code === "42501" ? 403 : 503);
  return NextResponse.json(result.data, { headers });
}
export async function POST(request: NextRequest) {
  if (!isOperationsSameOrigin(request)) return failure("Nguồn yêu cầu không hợp lệ.", 403);
  if (Number(request.headers.get("content-length") ?? 0) > 250000) return failure("Nội dung quá lớn.", 413);
  const text = await request.text();
  if (text.length > 250000) return failure("Nội dung quá lớn.", 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return failure("Nội dung không hợp lệ."); }
  const parsed = libraryCommandSchema.safeParse(body);
  if (!parsed.success) return failure("Kiểm tra nội dung tiêu chí hoặc cấu hình từng chi nhánh. Chưa ghi dữ liệu.");
  const client = await createServerSupabaseClient();
  const session = await client.auth.getUser();
  if (session.error || !session.data.user) return failure("Vui lòng đăng nhập lại.", 401);
  const { action, requestId, ...payload } = parsed.data;
  const result = await (client as unknown as Rpc).rpc("ops_working_library_execute", { p_action: action, p_payload: payload, p_request_id: requestId });
  if (result.error) {
    const message = result.error.message;
    if (message.includes("OPS_FORBIDDEN")) return failure("Bạn chưa có quyền thiết lập bộ chung hoặc áp dụng tại chi nhánh đã chọn.", 403);
    if (message.includes("OPS_INVALID_ASSIGNEE")) return failure("Người phụ trách không còn đủ quyền tại chi nhánh. Chọn lại người phù hợp.", 409);
    if (message.includes("OPS_LIBRARY_STALE")) return failure("Bộ tiêu chí vừa được cập nhật. Tải lại và kiểm tra trước khi lưu hoặc áp dụng.", 409);
    if (message.includes("OPS_LIBRARY_EXISTS")) return failure("Bộ tiêu chí CEO đã được lưu. Mở bộ hiện có để chỉnh, không tạo thêm bản trùng.", 409);
    if (message.includes("OPS_LIBRARY_APPLIED")) return failure("Một chi nhánh đã áp dụng bộ này. Không ghi đè; chỉnh công việc tại chi nhánh bằng phiên bản mới.", 409);
    if (message.includes("OPS_WORKBOOK_DUPLICATE")) return failure("Chi nhánh có mã công việc trùng với bộ đã nhập trước. Chưa áp dụng thay thế dữ liệu cũ.", 409);
    if (message.includes("OPS_REQUEST_CONFLICT")) return failure("Yêu cầu đã thay đổi. Kiểm tra nội dung rồi thực hiện lại.", 409);
    if (message.includes("OPS_INVALID_SCHEDULE")) return failure("Kiểm tra ngày bắt đầu từ hôm nay, giờ hạn và ngày hằng tuần ở từng chi nhánh.");
    return failure("Chưa hoàn tất thao tác. Không có phần nào của lần ghi này được áp dụng.", ["PGRST202", "42883"].includes(result.error.code ?? "") ? 503 : 400);
  }
  return NextResponse.json({ result: result.data }, { headers });
}
