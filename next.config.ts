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
  // - app.onebiz.com.vn     → ERP full (main app)
  // - fnb.onebiz.com.vn     → FnB POS only (via middleware rewrite → /pos/fnb)
  // Subdomain routing handled in src/lib/supabase/middleware.ts
  // Cross-domain auth: Supabase cookie set on .onebiz.com.vn domain
  // PWA: manifest-fnb.json + sw-fnb.js for FnB subdomain
};

export default nextConfig;
