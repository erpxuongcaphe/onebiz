/**
 * In-memory rate limiter cho API routes (CEO 13/05).
 *
 * Mục đích: chặn brute-force PIN POS qua API endpoint.
 *   - RPC verify_pos_pin đã track failed_attempts + lock 15 phút sau 10 sai.
 *   - Nhưng attacker có thể spawn nhiều tab/IP để tăng tốc thử PIN trước
 *     khi RPC lock kick in. API-layer rate limit chặn cấp request.
 *
 * Algorithm: sliding window đơn giản với Map<key, { count, resetAt }>.
 *   - Mỗi key có quota tối đa N request trong window W ms.
 *   - Hit quota → return false (caller trả 429).
 *   - Sau khi window expire, counter tự reset.
 *
 * ⚠️ Limit: in-memory chỉ hoạt động trên SINGLE INSTANCE. Multi-server
 * Vercel/AWS cần Redis. Hiện hệ thống single-instance → OK cho giờ.
 *
 * Cleanup: định kỳ xoá entry đã expire để không leak memory.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries mỗi 5 phút (lazy — chỉ chạy khi có request).
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60_000;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export interface RateLimitOptions {
  /** Số request tối đa trong window. */
  limit: number;
  /** Window (ms). Vd 60_000 = 1 phút. */
  windowMs: number;
}

export interface RateLimitResult {
  /** true = OK (chưa hit quota). false = block (return 429). */
  allowed: boolean;
  /** Số request đã dùng trong window hiện tại. */
  used: number;
  /** Số request còn lại. */
  remaining: number;
  /** Timestamp (ms) khi window reset. */
  resetAt: number;
}

/**
 * Check + increment rate limit cho key.
 *
 * @param key Định danh unique (vd "pin-switch:1.2.3.4:user-xyz")
 * @param opts limit + windowMs
 * @returns { allowed, used, remaining, resetAt }
 */
export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    // Window mới: reset counter
    store.set(key, { count: 1, resetAt: now + opts.windowMs });
    return {
      allowed: true,
      used: 1,
      remaining: opts.limit - 1,
      resetAt: now + opts.windowMs,
    };
  }

  if (entry.count >= opts.limit) {
    return {
      allowed: false,
      used: entry.count,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    used: entry.count,
    remaining: opts.limit - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Helper extract IP từ Next.js Request.
 * Priority: x-forwarded-for (Vercel) > x-real-ip (nginx) > "unknown".
 */
export function getClientIp(req: Request | { headers: Headers }): string {
  const headers = "headers" in req ? req.headers : new Headers();
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // x-forwarded-for có thể là chuỗi nhiều IP (proxy chain), lấy IP đầu
    return xff.split(",")[0]!.trim();
  }
  return headers.get("x-real-ip") ?? "unknown";
}
