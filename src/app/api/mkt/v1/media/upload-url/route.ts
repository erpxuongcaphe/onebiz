import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { getMktContext } from "@/lib/mkt/read-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "mkt-media";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);


function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Chưa đăng nhập" } },
      { status: 401 },
    );
  }

  const mktContext = await getMktContext(supabase);
  if (!mktContext.canManageAssets) {
    return NextResponse.json(
      { success: false, error: { code: "INSUFFICIENT_ROLE", message: "Chưa được cấp quyền MKT Hub" } },
      { status: 403 },
    );
  }

  const db = getMktDatabaseClient(supabase);
  const { data: profile } = await db
    .from<{ tenant_id: string | null }>("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.tenant_id) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Không tìm thấy hồ sơ người dùng" } },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  };
  const fileName = safeName(body.fileName?.trim() ?? "");
  const mimeType = body.mimeType?.toLowerCase() ?? "";
  const sizeBytes = Number(body.sizeBytes);
  if (
    !fileName ||
    !ALLOWED_MIME_TYPES.has(mimeType) ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > MAX_UPLOAD_BYTES
  ) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_MEDIA_UPLOAD", message: "File kh\u00f4ng h\u1ee3p l\u1ec7 ho\u1eb7c v\u01b0\u1ee3t qu\u00e1 25 MB" } },
      { status: 400 },
    );
  }
  const path = `${profile.tenant_id}/${randomUUID()}-${fileName}`;

  const admin = getAdminClient();
  const { data, error: signErr } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signErr || !data) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_STATE", message: signErr?.message ?? "Không tạo được URL tải lên" } },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true, path: data.path, token: data.token });
}
