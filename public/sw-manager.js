/**
 * Service Worker for OneBiz Manager / ERP Web PWA
 *
 * Sprint LT-5 (CEO 25/05/2026): Improve để handle DNS PA Vietnam slow case.
 * Trước đây HTML pages chỉ stale-while-revalidate → khi cache rỗng + network
 * fail, fall through cho Edge show ERR_FAILED. Giờ:
 *   - Pre-cache HTML shells của TOP routes (trang chủ, hang-hoa, pos, so-quy,
 *     dang-nhap, /he-thong/users, /don-hang/*) → user vào trang nào cũng có
 *     cached shell sẵn.
 *   - Catch fetch failure → fall back tới /offline.html (page đẹp + auto-reload
 *     khi mạng quay lại) thay vì Edge native error.
 *   - Bump cache name v1 → v2 để force refresh cũ.
 *
 * Strategy:
 *   - Cache-first cho static assets (_next/static, icons, manifest)
 *   - Stale-while-revalidate cho HTML page shells + offline fallback
 *   - Bypass: auth routes, Supabase, /api/*, /monitoring (Sentry tunnel)
 */

const CACHE_NAME = "onebiz-manager-v2";

// Pre-cache top routes — đảm bảo user vào lần đầu các trang này
// cũng có shell sẵn sau khi SW activated.
const STATIC_ASSETS = [
  "/",
  "/manager",
  "/dang-nhap",
  "/offline.html",
  "/manifest.json",
  "/manifest-manager.json",
  "/icons/erp-192.png",
  "/icons/erp-512.png",
];

// Route shells để warm cache khi nhận thông báo PRECACHE_ROUTES từ client.
const ROUTE_SHELLS = [
  "/",
  "/hang-hoa",
  "/hang-hoa/nhom",
  "/hang-hoa/lo-san-xuat",
  "/hang-hoa/san-xuat",
  "/pos",
  "/so-quy",
  "/don-hang/dat-hang",
  "/don-hang/hoa-don",
  "/khach-hang",
  "/he-thong/users",
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
    Promise.all([
      // Clean caches cũ
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      ),
      // Warm cache cho top routes — fetch background sau activation
      caches.open(CACHE_NAME).then((cache) =>
        Promise.all(
          ROUTE_SHELLS.map((path) =>
            fetch(path, { credentials: "same-origin" })
              .then((resp) => {
                if (resp && resp.status === 200) {
                  return cache.put(path, resp);
                }
              })
              .catch(() => {
                // Bỏ qua nếu fetch fail
              }),
          ),
        ),
      ),
    ]),
  );
  self.clients.claim();
});

// Khi client message "PRECACHE_ROUTES" → warm thêm routes user thường vào.
// Có thể trigger từ client side khi user idle.
self.addEventListener("message", (event) => {
  if (event.data?.type === "PRECACHE_ROUTES" && Array.isArray(event.data.routes)) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) =>
        Promise.all(
          event.data.routes.map((path) =>
            fetch(path, { credentials: "same-origin" })
              .then((resp) => resp.status === 200 && cache.put(path, resp))
              .catch(() => {}),
          ),
        ),
      ),
    );
  }
});

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

  // HTML pages: stale-while-revalidate + offline fallback
  // CEO 25/05/2026: thêm fallback tới /offline.html nếu KHÔNG có cache
  // và network fail (DNS PA Vietnam chậm) → user thấy page "Đang kết nối
  // lại…" auto-reload thay vì Edge error.
  if (
    event.request.mode === "navigate" ||
    event.request.destination === "document"
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkPromise = fetch(event.request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const clone = resp.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(event.request, clone));
            }
            return resp;
          })
          .catch(() => null);

        // Stale-while-revalidate: cached → fast paint, network → update bg
        if (cached) {
          // Background update (không block response)
          networkPromise.catch(() => {});
          return cached;
        }

        // Không có cache cho exact URL → thử match shell '/' (cùng route group)
        // hoặc cuối cùng fall back offline.html
        return networkPromise.then((resp) => {
          if (resp) return resp;
          // Cố gắng serve shell '/' (đa số trang share layout chung)
          return caches.match("/").then((rootCached) => {
            if (rootCached) return rootCached;
            // Cuối cùng: offline page
            return caches.match("/offline.html").then(
              (offline) =>
                offline ||
                new Response("Offline", { status: 503, statusText: "Offline" }),
            );
          });
        });
      }),
    );
    return;
  }
});

// Day 11 16/05: Push event listener đã gỡ — CEO quyết bỏ Web Push
// vì quy trình đã có chain of command (cashier → quản lý qua điện thoại).
// Notifications vẫn chạy in-app qua bell badge + bảng `notifications`.
