import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "./types";
import { getSharedCookieDomain } from "./cookie-domain";

/**
 * Supabase client cho Server Components / Route Handlers / Server Actions.
 * Phải tạo mới mỗi request (không singleton).
 *
 * Sprint LT-6 (CEO 27/05/2026): Thêm cookie domain override để consistent
 * với middleware. Trước đây middleware.ts set cookie với domain=.onebiz.com.vn
 * (cross-subdomain share) nhưng server.ts setAll() chỉ truyền options gốc
 * (không có domain) → cookie set host-only `onebiz.com.vn`. Browser store
 * 2 cookies song song → host-only thắng theo RFC 6265 → cookie .onebiz.com.vn
 * bị stale → user nhảy giữa onebiz/fnb subdomain mang token cũ → 401 → đá.
 * Fix: lấy host từ headers(), pass domain option giống middleware.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const headersList = await headers();
  const cookieDomain = getSharedCookieDomain(headersList.get("host"));

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                // Đồng nhất domain với middleware để tránh 2 cookies song song.
                // onebiz.com.vn / fnb.onebiz.com.vn cùng share cookie
                // `.onebiz.com.vn`. localhost → undefined → browser default.
                ...(cookieDomain ? { domain: cookieDomain } : {}),
              })
            );
          } catch {
            // setAll có thể fail trong Server Components (read-only)
            // Chỉ hoạt động trong Route Handlers / Server Actions
          }
        },
      },
    }
  );
}
