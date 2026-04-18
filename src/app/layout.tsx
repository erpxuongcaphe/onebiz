import type { Metadata } from "next";
import { Be_Vietnam_Pro, Inter } from "next/font/google";
import { Providers } from "./providers";
import { PwaHead } from "@/components/shared/pwa-head";
import "./globals.css";

// Stitch design spec dùng 2 font:
//   - Inter cho body + label (clean, hiện đại, geometric sans)
//   - Be Vietnam Pro cho headline (hỗ trợ tiếng Việt dấu mảnh, dùng cho heading lớn)
// Trước đây codebase dùng Be Vietnam Pro cho cả 2 → body tiếng Việt glyph
// nhìn "có chân"/dày. Stitch mockup (stitch_onebiz_ux_ui_optimization/**/code.html)
// luôn set fontFamily.body = ["Inter"], fontFamily.headline = ["Be Vietnam Pro"].
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-heading",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OneBiz ERP",
  description: "Hệ thống quản lý doanh nghiệp",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${inter.variable} ${beVietnamPro.variable} h-full antialiased`}
    >
      <head>
        <PwaHead />
        {/* Material Symbols Outlined — icon system cho Stitch UI.
            Axes wght 100-700, FILL 0-1, opsz 20-48 cho phép tweak nét/fill
            qua inline font-variation-settings ở component <Icon />. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
