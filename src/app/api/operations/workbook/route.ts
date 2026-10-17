import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
import { workingImportSchema } from "@/lib/operations/workbook-import";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const activation = z.object({ requestId: z.uuid(), activate: z.literal(true) }).strict();
const discard = z.object({ requestId: z.uuid(), discard: z.literal(true), reason: z.string().trim().min(5).max(1000) }).strict();
type Rpc = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };
function failure(message: string, status = 400) { return NextResponse.json({ error: message }, { status, headers }); }
export async function GET() {
  const client = await createServerSupabaseClient();
  const session = await client.auth.getUser();
  if (session.error || !session.data.user) return failure("Vui lòng đăng nhập lại.", 401);
  const result = await (client as unknown as Rpc).rpc("ops_workbook_batches_read", {});
  if (result.error) return failure("Chưa đọc được các bộ đã nhập hoặc bạn chưa có quyền quản trị.", result.error.code === "42501" ? 403 : 503);
  return NextResponse.json({ batches: result.data }, { headers });
}
export async function POST(request: NextRequest) {
  if (!isOperationsSameOrigin(request)) return failure("Nguồn yêu cầu không hợp lệ.", 403);
  if (Number(request.headers.get("content-length") ?? 0) > 250000) return failure("Gói nhập quá lớn.", 413);
  const raw = await request.text(); if (raw.length > 250000) return failure("Gói nhập quá lớn.", 413);
  let body: unknown; try { body = JSON.parse(raw); } catch { return failure("Nội dung không hợp lệ."); }
  const parsed = z.union([activation, discard, workingImportSchema.strict()]).safeParse(body);
  if (!parsed.success) return failure("Kiểm tra từng công việc, chi nhánh, người phụ trách, giờ và ngày bắt đầu. Chưa có dữ liệu nào được ghi.");
  const client = await createServerSupabaseClient();
  const session = await client.auth.getUser();
  if (session.error || !session.data.user) return failure("Vui lòng đăng nhập lại.", 401);
  const activate = "activate" in parsed.data;
  const { requestId, ...payload } = parsed.data;
  if('rows' in payload && (payload.rows.some(row=>!['daily','weekly'].includes(row.frequency)||row.dayNumber!==undefined||row.monthNumber!==undefined)||payload.effectiveUntil)){
    const capabilities=await (client as unknown as Rpc).rpc('ops_access_context',{});
    if(capabilities.error||Number((capabilities.data as {recurrenceVersion?:number}|null)?.recurrenceVersion??0)<1)
      return failure('Lịch mở rộng đang chờ cập nhật hệ thống. Chưa ghi dữ liệu.',503);
  }
  const result = "discard" in parsed.data ? await (client as unknown as Rpc).rpc("ops_workbook_discard", {p_id:requestId,p_reason:parsed.data.reason}) : await (client as unknown as Rpc).rpc("ops_workbook_import_v2", { p_request_id: requestId, p_body: activate ? null : payload, p_activate: activate });
  if (result.error) {
    const error = result.error.message;
    if (error.includes("OPS_FORBIDDEN")) return failure("Bạn chưa đủ quyền cấu hình các chi nhánh trong gói nhập.", 403);
    if (error.includes("OPS_WORKBOOK_DUPLICATE")) return failure("Mã công việc đã được nhập tại một chi nhánh đã chọn. Kiểm tra bộ đã nhập; không nhập lặp.", 409);
    if (error.includes("OPS_INVALID_ASSIGNEE")) return failure("Người phụ trách không còn đủ quyền quản lý tại chi nhánh. Hãy chọn lại.");
    if (error.includes("OPS_PAST_EFFECTIVE")) return failure("Ngày áp dụng đã qua. Cần tạo lại cấu hình với ngày hiện tại hoặc tương lai.");
    return failure("Chưa lưu được gói. Không có phần nào của lần ghi này được áp dụng. Kiểm tra nền Hub và cấu hình trước khi thử lại.", ["PGRST202", "42883"].includes(result.error.code ?? "") ? 503 : 400);
  }
  return NextResponse.json({ batch: result.data }, { headers });
}
