import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { Providers } from "./providers";
import { PwaHead } from "@/components/shared/pwa-head";
import "./globals.css";

// Stitch dùng Be Vietnam Pro — match 1-1 với plan.
// Mở rộng weight 200-900 để hỗ trợ uppercase tracking-wider labels (200/300),
// headlines displayLarge (700/800/900) per Material Design 3.
const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-sans",
  subsets: ["latin", "vietnamese"],
  weight: ["200", "300", "400", "500", "600", "700", "800", "900"],
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
    <html lang="vi" className={`${beVietnamPro.variable} h-full antialiased`}>
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
