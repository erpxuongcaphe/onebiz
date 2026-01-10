import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
    subsets: ['latin', 'vietnamese'],
    variable: "--font-inter",
    display: 'swap',
});

export const metadata: Metadata = {
    title: "OneBiz POS - Hệ thống bán hàng",
    description: "Point of Sale System - OneBiz",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="vi" suppressHydrationWarning>
            <body className={`${inter.variable} font-sans antialiased`}>
                {children}
            </body>
        </html>
    );
}
