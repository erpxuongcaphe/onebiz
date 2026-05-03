import type { Metadata } from "next";
import { Be_Vietnam_Pro, Inter } from "next/font/google";
import { Providers } from "./providers";
import { PwaHead } from "@/components/shared/pwa-head";
import "./globals.css";

// Stitch design spec dùng 2 font:
//   - Inter cho body + label (clean, hiện đại, geometric sans)
//   - Be Vietnam Pro cho headline (hỗ trợ tiếng Việt dấu mảnh, dùng cho heading lớn)
// Tối ưu bandwidth: chỉ load weights thực sự dùng trong app
//   - Inter: 400 (body), 500 (medium labels), 600 (semibold emphasis), 700 (bold)
//   - Be Vietnam Pro: 600 (heading), 700 (strong heading), 800 (extrabold KPI/total)
// Dùng `preload: true` cho font chủ đạo (Inter) để giảm FOUT ở paint đầu tiên.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: true,
});

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-heading",
  subsets: ["latin", "vietnamese"],
  weight: ["600", "700", "800"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "ONEBIZ.",
    template: "%s · ONEBIZ.",
  },
  description: "ERP Suite — Quản lý doanh nghiệp tất cả trong một",
  applicationName: "ONEBIZ",
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
            qua inline font-variation-settings ở component <Icon />.

            FOUC fix: dùng display=block (3s invisible timeout) thay vì swap
            (hiển thị fallback font ngay → leak raw text "shopping_cart").
            Plus add class 'fonts-not-ready' trên <html> trước khi React mount,
            CSS hide .material-symbols-outlined cho đến khi document.fonts.ready
            remove class. Tạo 3 layer defense: zero raw text leak. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* PERF F16: rel=preload với as=style → browser ưu tiên fetch CSS
            cùng priority với inter/be_vietnam_pro để Material Symbols ready
            sớm hơn. Trước đây stylesheet-only fetch ở priority thấp, font
            request đến sau → 1-2s leak text. */}
        <link
          rel="preload"
          as="style"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
        {/* Inline script trước React render — set class fonts-not-ready ngay
            trên <html>, remove khi document.fonts ready. Đảm bảo CSS hide rule
            apply ngay từ first paint, không chờ React.

            PERF F16: BUG — `document.fonts.ready` resolve khi Inter/BeVietnam
            (next/font self-host) ready, KHÔNG chờ Material Symbols (CDN
            Google Fonts). Sau 3s timeout fallback → class removed → icon
            text leak xấu xí (CEO báo "icon hiện tên chữ").
            Fix: poll `document.fonts.check("14px 'Material Symbols Outlined'")`
            cụ thể. Hard fallback 10s để không stuck nếu CDN chết. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  var d=document.documentElement;
  d.classList.add('fonts-not-ready');
  var done=false;
  function ready(){if(done)return;done=true;d.classList.remove('fonts-not-ready');}
  if('fonts' in document){
    var poll=function(){
      if(done)return;
      try{
        if(document.fonts.check("14px 'Material Symbols Outlined'"))return ready();
      }catch(e){}
      setTimeout(poll,80);
    };
    document.fonts.ready.then(poll);
    poll();
    // Hard fallback: nếu font CDN chết hoàn toàn, sau 10s vẫn show UI
    // (icon sẽ hiện text — chấp nhận được vs trắng vô hạn).
    setTimeout(ready,10000);
  } else {
    setTimeout(ready,500);
  }
})();
            `.trim(),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
