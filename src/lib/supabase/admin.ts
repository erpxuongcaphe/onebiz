/**
 * Supabase Admin Client — service_role access cho server-only operations.
 *
 * Sprint USER-MGMT (CEO 06/05/2026): admin tự tạo user (email + password)
 * thay vì invite link. Cần service_role để gọi auth.admin.createUser().
 *
 * ⚠️ CHỈ DÙNG TRONG SERVER ACTIONS / ROUTE HANDLERS.
 * Service role key bypass RLS hoàn toàn — phải kiểm soát caller permission
 * (vd require role 'owner' hoặc permission 'system.create_user') TRƯỚC khi
 * gọi function này.
 *
 * ENV REQUIRED:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (KHÔNG public, chỉ server-side)
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let cachedAdminClient: ReturnType<typeof createClient<Database>> | null = null;

export function getAdminClient() {
  if (cachedAdminClient) return cachedAdminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    );
  }

  cachedAdminClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedAdminClient;
}
