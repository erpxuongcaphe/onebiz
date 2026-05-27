/**
 * Service Worker for OneBiz Manager / ERP Web PWA
 *
 * Sprint LT-6 (CEO 27/05/2026): REWRITE strategy HTML để fix bug user bị đá
 * khỏi tài khoản sau ~1h dùng web.
 *
 * BUG TRƯỚC ĐÂY (Sprint LT-5 25/05):
 *   - HTML pages stale-while-revalidate → SW serve cached HTML INSTANT,
 *     bỏ qua Next.js middleware (`src/lib/supabase/middleware.ts`).
 *   - Middleware là chỗ refresh Supabase auth token + rotate cookie.
 *   - User click navigation → SW serve cache → cookie KHÔNG được rotate.
 *   - Sau 1h (JWT default expiry) → Supabase API trả 401 → fire SIGNED_OUT
 *     → auth-context redirect /dang-nhap. User bị đá oan.
 *
 * FIX (Sprint LT-6 27/05):
 *   - HTML pages: NETWORK-FIRST (luôn fetch từ Vercel → middleware chạy →
 *     cookie refresh OK). Cache HTML chỉ để FALLBACK khi network die.
 *   - Bỏ pre-cache ROUTE_SHELLS — pre-cache làm cache đầy HTML không cookie,
 *     lợi ích perf nhỏ không xứng với risk auth.
 *   - Bump cache v2 → v3 để force clear cache HTML cũ.
 *
 * Strategy hiện tại:
 *   - Cache-first cho static assets (_next/static, icons, manifest)
 *   - NETWORK-FIRST cho HTML — middleware luôn chạy → cookie refresh đúng
 *   - Fallback /offline.html chỉ khi network thật sự die (offline mode)
 *   - Bypass: auth routes, Supabase, /api/*, /monitoring (Sentry tunnel)
 */

const CACHE_NAME = "onebiz-manager-v3";

// Pre-cache CHỈ static assets — KHÔNG pre-cache HTML routes nữa.
// Sprint LT-6 27/05: HTML phải đi qua network để middleware refresh cookie.
// Pre-cache HTML = user click → SW serve cached HTML → bỏ middleware → token
// không refresh → 1h sau bị đá. Fix bằng cách KHÔNG pre-cache HTML.
const STATIC_ASSETS = [
  "/offline.html",
  "/manifest.json",
  "/manifest-manager.json",
  "/icons/erp-192.png",
  "/icons/erp-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch(() => {
        // Bỏ qua nếu 1 asset fail — không block install
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Clean caches cũ (v1, v2) — buộc clear HTML đã cache sai trước đây.
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

// Sprint LT-6: BỎ handler "PRECACHE_ROUTES". Không pre-cache HTML nữa vì
// HTML cache làm cookie auth không refresh. Client side cũng đã bỏ message
// PRECACHE_ROUTES tương ứng.

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Bỏ qua non-GET
  if (event.request.method !== "GET") return;

  // Bỏ qua Supabase (luôn network)
  if (url.hostname.includes("supabase")) return;

  // Bỏ qua auth (đăng nhập / đăng xuất)
  if (
    url.pathname.includes("/api/auth") ||
    url.pathname.includes("/dang-ky") ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // Bỏ qua Sentry tunnel
  if (url.pathname === "/monitoring") return;

  // Static assets: cache-first
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".json")
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request)
            .then((resp) => {
              if (resp && resp.status === 200) {
                const clone = resp.clone();
                caches
                  .open(CACHE_NAME)
                  .then((cache) => cache.put(event.request, clone));
              }
              return resp;
            })
            .catch(
              () => new Response("", { status: 504, statusText: "Offline" }),
            ),
      ),
    );
    return;
  }

  // HTML pages: NETWORK-FIRST + offline.html fallback
  //
  // Sprint LT-6 27/05/2026: NETWORK-FIRST (KHÔNG dùng stale-while-revalidate).
  // Lý do: middleware Next.js (src/lib/supabase/middleware.ts) chạy ở edge
  // BẮT BUỘC cho mỗi HTML request để refresh Supabase auth token + rotate
  // cookie. Nếu SW serve cached HTML → bỏ qua middleware → token không refresh
  // → 1 tiếng sau Supabase API trả 401 → user bị đá khỏi tài khoản oan.
  //
  // Trade-off: page load lần navigate đầu chậm hơn ~100-200ms (phải đợi
  // network roundtrip thay vì serve cache instant). Acceptable vì:
  //   - Static assets vẫn cache-first (JS/CSS/font lớn nhất → vẫn nhanh)
  //   - HTML response nhỏ (< 50KB gzip) → load nhanh
  //   - Đổi lại: KHÔNG bao giờ bị đá tài khoản oan
  if (
    event.request.mode === "navigate" ||
    event.request.destination === "document"
  ) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          // Cache response thành công để fallback khi offline sau này.
          // KHÔNG dùng cached version cho request hiện tại — luôn return
          // fresh response từ network để middleware đã chạy (cookie refreshed).
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, clone))
              .catch(() => {});
          }
          return resp;
        })
        .catch(() =>
          // Network die thật sự (offline, DNS timeout) → fallback:
          // 1) Cached HTML của exact URL (nếu user đã visit trước đó)
          // 2) /offline.html (page "Đang kết nối lại…" auto-reload)
          caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return caches.match("/offline.html").then(
              (offline) =>
                offline ||
                new Response("Offline", { status: 503, statusText: "Offline" }),
            );
          }),
        ),
    );
    return;
  }
});

// Day 11 16/05: Push event listener đã gỡ — CEO quyết bỏ Web Push
// vì quy trình đã có chain of command (cashier → quản lý qua điện thoại).
// Notifications vẫn chạy in-app qua bell badge + bảng `notifications`.
