/**
 * Service Worker for OneBiz Manager / ERP Web PWA (Day 6 16/05/2026)
 *
 * Strategy:
 *   - Cache-first cho static assets (_next/static, icons, manifest)
 *   - Network-first cho API + data routes (Supabase, /api/*)
 *   - Stale-while-revalidate cho HTML page shells
 *   - Bypass auth routes
 *
 * Khác sw-fnb.js: KHÔNG pre-cache POS routes (manager dùng full ERP web,
 * không nhất thiết offline-first).
 */

const CACHE_NAME = "onebiz-manager-v1";
const STATIC_ASSETS = [
  "/",
  "/manager",
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
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
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
    url.pathname.includes("/dang-nhap") ||
    url.pathname.includes("/dang-ky")
  ) {
    return;
  }

  // Bỏ qua /api/* (network-first cho API tự nhiên)
  if (url.pathname.startsWith("/api/")) return;

  // Static assets: cache-first
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".json")
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((resp) => {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return resp;
          }),
      ),
    );
    return;
  }

  // HTML pages: stale-while-revalidate (cache cũ trả ngay, fetch mới ngầm)
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkPromise = fetch(event.request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || networkPromise;
      }),
    );
    return;
  }
});

// Day 11 16/05: Push event listener đã gỡ — anh CEO quyết bỏ Web Push
// vì quy trình đã có chain of command (cashier → quản lý qua điện thoại).
// Notifications vẫn chạy in-app qua bell badge + bảng `notifications`.
