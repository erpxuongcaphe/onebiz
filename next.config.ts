import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sprint POS Rev 3 (08/04/2026): /pos-si đã được rename thành /pos.
  async redirects() {
    return [
      // Legacy safety net: lỡ có bookmark / link cũ tới /pos-si → về /pos
      { source: "/pos-si", destination: "/pos", permanent: true },
      { source: "/pos-si/:path*", destination: "/pos", permanent: true },
    ];
  },

  // CEO 27/05/2026: HOÀN TOÀN REMOVE Cache-Control override.
  //
  // Lịch sử:
  //   - 23/05 commit 14862f9: Thêm `Cache-Control: no-store, must-revalidate`
  //     để fix bug "F5 không hiện data mới sau khi tạo SP/đơn".
  //   - 24/05 trở đi: CEO báo flash ERR_FAILED "Hmmm... can't reach this page"
  //     khi click navigation + F5 trong web. Web Vercel khác KHÔNG bị.
  //   - 26/05 commit 8082a8e: Thay `no-store` → `max-age=0, must-revalidate
  //     + stale-if-error=86400`. Giảm một phần nhưng vẫn bị navigation flash.
  //
  // ROOT CAUSE: `max-age=0, must-revalidate` ép browser hit network mỗi
  // navigation để revalidate HTML. Network hiccup ngắn (DNS PA Vietnam chậm,
  // edge cold start) → Edge show ERR_FAILED page. Vercel default cache cho
  // HTML aggressive hơn → click navigate dùng cache instant → KHÔNG bị.
  //
  // Trade-off accept: F5 stale data có thể quay lại trên 1 số trang chưa
  // áp dụng `useRevalidateOnFocus`. Hook đã apply cho 6 trang chính. Các
  // trang khác F5 vẫn re-fetch qua React useEffect (mount = fresh data).
  // Back/forward navigation có thể dùng bfcache (stale) nhưng acceptable.
  //
  // KHÔNG override Cache-Control nữa → Vercel default (cho Next.js dynamic
  // pages thường là `private, no-cache`) sẽ apply.

  // PERF F7: Tree-shake các barrel re-export nặng để initial bundle gọn.
  // Next.js sẽ rewrite `import { X } from "pkg"` thành deep-import
  // `import X from "pkg/X"` ở build time → chỉ bundle module thật sự dùng,
  // không kéo cả gói. Áp dụng cho recharts (chia 10+ chunk), lucide-react,
  // @base-ui/react. Tự handle ở @next/eslint-plugin-next.
  experimental: {
    optimizePackageImports: [
      "recharts",
      "lucide-react",
      "@base-ui/react",
      "@tanstack/react-table",
      "@tanstack/react-virtual",
      "date-fns",
    ],
  },

  // Phase 3 (2026-04-15): Multi-domain setup
  // - onebiz.com.vn         → ERP full (trang chính, mọi settings + manage)
  // - fnb.onebiz.com.vn     → FnB POS only (via middleware rewrite → /pos/fnb)
  // Subdomain routing handled in src/lib/supabase/middleware.ts
  // Cross-domain auth: Supabase cookie set on .onebiz.com.vn domain (share session)
  // PWA: manifest-fnb.json + sw-fnb.js for FnB subdomain
};

export default nextConfig;
