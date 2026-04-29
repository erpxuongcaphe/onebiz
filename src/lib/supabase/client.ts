import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "./types";

/**
 * Supabase client cho browser (Client Components).
 *
 * SINGLETON - gọi bao nhiêu lần cũng trả cùng 1 instance.
 *
 * Bug history: trước đây hàm này tạo NEW instance mỗi call dù comment ghi
 * "Singleton". Hệ quả: auth-context.tsx tạo 1 client, mỗi service tạo 1
 * client → N+ client cùng acquire GoTrue auth-token lock → race condition,
 * console spam "Lock auth-token was released because another request stole it",
 * UI treo khi save tier.
 *
 * Fix: cache module-level. Tất cả caller (auth-context, base.ts getClient,
 * pages/components, services) chia sẻ 1 client → 1 lock instance → không
 * race nữa.
 *
 * Type của createBrowserClient bao gồm `cookies` option default — không
 * cần custom unless SSR. Browser-only context dùng default cookie storage.
 */
type Client = ReturnType<typeof createBrowserClient<Database>>;
let cachedClient: Client | null = null;

export function createClient(): Client {
  if (cachedClient) return cachedClient;
  cachedClient = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cachedClient;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _CookieOptionsUnused = CookieOptions;
