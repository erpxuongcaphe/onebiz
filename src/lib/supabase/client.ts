import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import { processLock } from "@supabase/auth-js";
import type { Database } from "./types";
import { getSharedCookieDomain } from "./cookie-domain";

/**
 * Supabase client cho browser (Client Components).
 *
 * SINGLETON - gọi bao nhiêu lần cũng trả cùng 1 instance.
 *
 * Bug history:
 * - V1: hàm này tạo NEW instance mỗi call dù comment ghi "Singleton". Hệ
 *   quả: auth-context.tsx tạo 1 client, mỗi service tạo 1 client → N+
 *   client cùng acquire GoTrue auth-token lock. Fix: cache module-level.
 * - V2 (PERF F15): default `navigatorLock` qua Navigator.Locks API có
 *   contention nghiêm trọng khi nhiều fetch song song. Console spam
 *   "Lock 'lock:sb-...auth-token' was not released within 5000ms.
 *   Forcefully acquiring the lock to recover." 6+ warnings/page mount.
 *   Mỗi forceful re-acquire trigger refresh_token query → 23-32 token
 *   refresh trên dashboard mount = ~6s overhead.
 *   Fix: dùng `processLock` (in-memory single-process). Trade-off: nếu
 *   user mở 2 tab cùng app, mỗi tab refresh token độc lập (acceptable
 *   cho ERP single-cashier-per-device).
 *
 * Type của createBrowserClient bao gồm `cookies` option default — không
 * cần custom unless SSR. Browser-only context dùng default cookie storage.
 */
type Client = ReturnType<typeof createBrowserClient<Database>>;
let cachedClient: Client | null = null;

export function createClient(): Client {
  if (cachedClient) return cachedClient;

  // CEO 06/06/2026 — QC POS FnB phát hiện AuthApiError "Invalid Refresh
  // Token" trên fnb.onebiz.com.vn. Server.ts/middleware.ts đã set cookie
  // với domain `.onebiz.com.vn` (Sprint LT-6) nhưng client-side
  // createBrowserClient KHÔNG có cookieOptions → khi browser set cookie
  // mới (vd sau refresh token), default = host-only → race với cookie
  // shared. Fix: pass cookieOptions.domain để client tự set đúng domain
  // ngay từ browser-side, không phụ thuộc server response.
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "";
  const sharedCookieDomain = getSharedCookieDomain(hostname);

  const cookieOptions: CookieOptions | undefined = sharedCookieDomain
    ? {
        domain: sharedCookieDomain,
        path: "/",
        sameSite: "lax",
        secure: typeof window !== "undefined" && window.location.protocol === "https:",
      }
    : undefined;

  cachedClient = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // PERF F15: processLock thay vì navigatorLock default. Tránh lock
        // contention khi N service fire song song trên page mount.
        lock: processLock,
      },
      // Cross-subdomain cookie sharing: onebiz.com.vn ↔ fnb.onebiz.com.vn
      // cùng đọc 1 cookie `.onebiz.com.vn`. localhost → undefined → default.
      ...(cookieOptions ? { cookieOptions } : {}),
    },
  );
  return cachedClient;
}
