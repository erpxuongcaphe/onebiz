/**
 * Service Worker for OneBiz FnB PWA
 * Strategy: Cache-first for static assets, network-first for HTML/API.
 *
 * CEO 06/06/2026: BUMP v2→v3 + BỎ pre-cache HTML routes (`/`, `/pos/fnb`).
 *
 * BUG: nhiều user (CEO Saturday trên ĐT + nhân viên Trang) bấm "Đăng nhập"
 * vẫn ở trang login, không qua được. Root cause: SW v2 cũ pre-cache HTML
 * `/` và `/pos/fnb` lần đầu visit (KHÔNG có cookie). Sau khi user login,
 * SW có thể serve cached HTML cũ (no cookie) cho navigate request → reload
 * page nhưng middleware không thấy cookie → kick lại login. SW v2 cũ cũng
 * KHÔNG có skip cho /auth + /dang-nhap (added line 51 sau commit nào đó).
 *
 * Fix:
 *   - Bump CACHE_NAME → v3: activate handler tự clear v1/v2 caches cũ
 *     (line 27-38) → force kick SW cũ cho mọi user.
 *   - Bỏ pre-cache HTML `/` và `/pos/fnb`. Chỉ pre-cache manifest + icons.
 *     HTML giờ luôn đi qua network → middleware refresh cookie OK.
 *   - skipWaiting + clients.claim đã có sẵn → bump version apply ngay.
 */

const CACHE_NAME = "onebiz-fnb-v3";
const STATIC_ASSETS = [
  // BỎ pre-cache HTML `/` + `/pos/fnb` — chúng cần middleware chạy
  // để refresh Supabase cookie. Pre-cache làm cache đầy HTML không cookie.
  "/manifest-fnb.json",
  "/icons/fnb-192.svg",
  "/icons/fnb-512.svg",
];

// Install: pre-cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for static, network-first for API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip Supabase API calls (always network)
  if (url.hostname.includes("supabase")) return;

  // Skip auth-related requests
  if (url.pathname.includes("auth") || url.pathname.includes("dang-nhap")) return;

  // Static assets: cache-first
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".json")
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Pages: network-first with cache fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
});
