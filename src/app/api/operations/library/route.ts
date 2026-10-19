import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
import { libraryCommandSchema, libraryRowsSchema, type WorkingLibrary } from "@/lib/operations/working-library";
import { missingWorkSchedules } from "@/lib/operations/work-schedule";

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
  if(action==='apply'){
    const current=await (client as unknown as Rpc).rpc('ops_working_library_read',{});
    if(current.error) return failure('Chưa đọc được bộ tiêu chí hoặc bạn không còn quyền áp dụng. Chưa ghi dữ liệu.',current.error.code==='42501'?403:503);
    const library=(current.data as {libraries?:WorkingLibrary[]}|null)?.libraries?.find(l=>l.id===payload.id);
    if(!library||library.archived||library.version!==payload.version) return failure('Bộ tiêu chí vừa thay đổi. Tải lại và kiểm tra trước khi áp dụng.',409);
    const rows=libraryRowsSchema.safeParse(library.rows);
    if(!rows.success) return failure('Bộ tiêu chí có nội dung hoặc lịch chưa hợp lệ. Mở Sửa nội dung để kiểm tra; chưa ghi dữ liệu.',409);
    const incomplete=missingWorkSchedules(rows.data);
    if(incomplete.length) return failure(`Chọn lịch riêng cho ${incomplete.map(r=>`mục ${r.number}: ${r.title}`).join('; ')} trong bộ tiêu chí chung trước khi áp dụng. Chưa ghi dữ liệu.`,409);
  }
  const needsRecurrence = action === 'save' && 'rows' in payload && payload.rows.some(row=>!['daily','weekly'].includes(row.frequency)||row.dayNumber!==undefined||row.monthNumber!==undefined)
    || action==='apply'&&'assignments' in payload&&payload.assignments.some(a=>a.effectiveUntil);
  if(needsRecurrence){
    const capabilities=await (client as unknown as Rpc).rpc('ops_working_library_read',{});
    if(capabilities.error||Number((capabilities.data as {recurrenceVersion?:number}|null)?.recurrenceVersion??0)<1)
      return failure('Lịch mở rộng đang chờ cập nhật hệ thống. Nội dung được giữ nguyên, chưa có dữ liệu được ghi.',503);
  }
  const result = await (client as unknown as Rpc).rpc(action === "apply" ? "ops_working_library_execute_v2" : "ops_working_library_execute", { p_action: action, p_payload: payload, p_request_id: requestId });
  if (result.error) {
    const message = result.error.message;
    if (message.includes("OPS_FORBIDDEN")) return failure("Bạn chưa có quyền thiết lập bộ chung hoặc áp dụng tại chi nhánh đã chọn.", 403);
    if (message.includes("OPS_INVALID_ASSIGNEE")) return failure("Một quản lý đã chọn không còn đủ quyền tại chi nhánh. Kiểm tra quyền Xem Hub, Ghi kết quả và phân công Quản lý Hub; chưa lưu bất kỳ chi nhánh nào.", 409);
    if (["PGRST202", "42883"].includes(result.error.code ?? "")) return failure("Chức năng phân công đang chờ cập nhật hệ thống. Nội dung đang nhập được giữ nguyên; chưa áp dụng dữ liệu.", 503);
    if (message.includes("OPS_LIBRARY_STALE")) return failure("Bộ tiêu chí vừa được cập nhật. Tải lại và kiểm tra trước khi lưu hoặc áp dụng.", 409);
    if (message.includes("OPS_LIBRARY_EXISTS")) return failure("Bộ tiêu chí CEO đã được lưu. Mở bộ hiện có để chỉnh, không tạo thêm bản trùng.", 409);
    if (message.includes("OPS_LIBRARY_APPLIED")) return failure("Một chi nhánh đã áp dụng bộ này. Không ghi đè; chỉnh công việc tại chi nhánh bằng phiên bản mới.", 409);
    if (message.includes("OPS_WORKBOOK_DUPLICATE")) return failure("Chi nhánh có mã công việc trùng với bộ đã nhập trước. Chưa áp dụng thay thế dữ liệu cũ.", 409);
    if (message.includes("OPS_REQUEST_CONFLICT")) return failure("Yêu cầu đã thay đổi. Kiểm tra nội dung rồi thực hiện lại.", 409);
    if (message.includes("OPS_INVALID_SCHEDULE")) return failure("Kiểm tra chu kỳ, ngày thực hiện, giờ hạn và ngày kết thúc của lịch.");
    return failure("Chưa hoàn tất thao tác. Không có phần nào của lần ghi này được áp dụng.", ["PGRST202", "42883"].includes(result.error.code ?? "") ? 503 : 400);
  }
  return NextResponse.json({ result: result.data }, { headers });
}
