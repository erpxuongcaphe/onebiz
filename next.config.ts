import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sprint POS Rev 3 (08/04/2026): /pos-si đã được rename thành /pos.
  // Redirect rules cũ đã xóa — /pos hiện là route trực tiếp.
  async redirects() {
    return [
      // Legacy safety net: lỡ có bookmark / link cũ tới /pos-si → về /pos
      { source: "/pos-si", destination: "/pos", permanent: true },
      { source: "/pos-si/:path*", destination: "/pos", permanent: true },
    ];
  },
};

export default nextConfig;
