import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

// Inter font - professional, web-friendly alternative to Calibri
const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: "--font-inter",
  display: 'swap',
});

// Keep Geist Mono for code/monospace elements
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Xưởng Cà Phê - Hệ thống ERP",
  description: "Hệ thống quản trị doanh nghiệp Xưởng Cà Phê",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          <AuthProvider>
            <BranchProvider>
              {children}
            </BranchProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

