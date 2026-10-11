import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { evidenceMime, MAX_EVIDENCE_BYTES } from "@/lib/operations/evidence";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = { id: string; path: string; file_name: string; created_at: string };
function failed(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
async function context() {
  const client = await createServerSupabaseClient();
  const user = await client.auth.getUser();
  return {
    client,
    valid: !user.error && !!user.data.user,
    rpc: client as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): PromiseLike<{ data: unknown; error: unknown }>;
    },
  };
}
export async function POST(request: NextRequest) {
  if (!isOperationsSameOrigin(request))
    return failed("Yêu cầu không hợp lệ.", 403);
  if (
    Number(request.headers.get("content-length") ?? 0) >
    MAX_EVIDENCE_BYTES + 16384
  )
    return failed("Tệp vượt quá 5 MB.");
  const { client, rpc, valid } = await context();
  if (!valid) return failed("Vui lòng đăng nhập lại.", 401);
  let form: FormData;
  try {
    const reader = request.body?.getReader();
    if (!reader) return failed("Không đọc được tệp.");
    const chunks: BlobPart[] = [];
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_EVIDENCE_BYTES + 16384) {
        await reader.cancel();
        return failed("Tệp vượt quá 5 MB.");
      }
      chunks.push(chunk.value as Uint8Array<ArrayBuffer>);
    }
    form = await new Response(new Blob(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return failed("Không đọc được tệp.");
  }
  const file = form.get("file");
  const entity = form.get("entity");
  const kind = form.get("kind");
  if (
    !(file instanceof File) ||
    !z.uuid().safeParse(entity).success ||
    !["run", "todo"].includes(String(kind)) ||
    file.size < 1 ||
    file.size > MAX_EVIDENCE_BYTES ||
    file.name.length > 160
  )
    return failed("Chọn ảnh JPG, PNG, WebP hoặc PDF, tối đa 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = evidenceMime(bytes);
  if (!mime || mime !== file.type)
    return failed("Nội dung tệp không khớp định dạng ảnh hoặc PDF.");
  const reserved = await rpc.rpc("ops_evidence_reserve", {
    p_kind: kind,
    p_entity: entity,
    p_name: file.name,
    p_mime: mime,
    p_size: file.size,
  });
  if (reserved.error || !reserved.data)
    return failed(
      "Chưa được phép tải minh chứng cho công việc này hoặc vùng lưu trữ chưa được kích hoạt.",
      403,
    );
  const row = reserved.data as Row;
  const upload = await client.storage
    .from("operations-evidence")
    .upload(row.path, bytes, { contentType: mime, upsert: false });
  if (upload.error)
    return failed(
      "Không tải được tệp. Chưa ghi nhận minh chứng; vui lòng thử lại chủ động.",
      503,
    );
  const finished = await rpc.rpc("ops_evidence_finish", { p_id: row.id });
  if (finished.error)
    return failed(
      "Tệp đã tải nhưng chưa xác nhận được minh chứng. Vui lòng liên hệ người quản trị.",
      503,
    );
  return NextResponse.json(
    { result: finished.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function GET(request: NextRequest) {
  const entity = request.nextUrl.searchParams.get("entity");
  const id = request.nextUrl.searchParams.get("id");
  if (
    !z.uuid().safeParse(entity).success ||
    (id && !z.uuid().safeParse(id).success)
  )
    return failed("Công việc không hợp lệ.");
  const { client, rpc, valid } = await context();
  if (!valid) return failed("Vui lòng đăng nhập lại.", 401);
  const result = await rpc.rpc("ops_evidence_read", { p_entity: entity });
  if (result.error) return failed("Không đọc được danh sách minh chứng.", 503);
  const rows = result.data as Row[];
  if (!id)
    return NextResponse.json(
      {
        rows: rows.map(({ id: fileId, file_name, created_at }) => ({
          id: fileId,
          file_name,
          created_at,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  const file = rows.find((row) => row.id === id);
  if (!file)
    return failed("Không tìm thấy minh chứng hoặc bạn chưa có quyền xem.", 404);
  const signed = await client.storage
    .from("operations-evidence")
    .createSignedUrl(file.path, 60, { download: file.file_name });
  if (signed.error || !signed.data)
    return failed("Không tạo được đường dẫn tải minh chứng.", 503);
  return NextResponse.json(
    { url: signed.data.signedUrl },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
