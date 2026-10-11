import { createServerSupabaseClient } from "@/lib/supabase/server";
export async function readHubAccess() {
  const client = await createServerSupabaseClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return { allowed: false, status: 401, error: "Vui lòng đăng nhập OneBiz." };
  const result = await (client as unknown as { rpc(name: string): PromiseLike<{ data: { allowed: boolean; isCeo: boolean } | null; error: { message: string } | null }> }).rpc("ops_access_context");
  if (result.error || !result.data) return { allowed: false, status: 503, error: "Chưa kiểm tra được quyền Hub. Vui lòng tải lại chủ động." };
  return { allowed: result.data.allowed === true, isCeo: result.data.isCeo === true, status: result.data.allowed ? 200 : 403, error: result.data.allowed ? "" : "Bạn chưa có quyền và phân công hoặc công việc liên quan để vào Hub." };
}
