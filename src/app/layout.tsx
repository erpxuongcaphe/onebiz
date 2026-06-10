import type { Metadata } from "next";
import { Be_Vietnam_Pro, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import NextTopLoader from "nextjs-toploader";
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
      // Inline script ở <head> add class `fonts-not-ready` lên <html> TRƯỚC
      // khi React hydrate → SSR vs client mismatch (intentional). Dùng
      // suppressHydrationWarning để React skip warning cho element này
      // (không skip children — chỉ skip attribute của <html>).
      // CEO 04/05/2026: Sentry catch hydration warning trên prod → fix.
      suppressHydrationWarning
    >
      <head>
        {/* CEO 09/06/2026 — FIX DỨT ĐIỂM bug "phải clear cache mới login được".
            Inline script chạy NGAY trong <head>, TRƯỚC React mount, TRƯỚC
            SDK Supabase init → đảm bảo cookie/localStorage cũ bị clear
            TRƯỚC khi loop refresh_token xảy ra.

            Tại sao fix trước (commit 0c67cd9, ff74776) chưa đủ:
            - useEffect trong /dang-nhap chỉ chạy SAU khi React mount + page render
            - SDK Supabase init NGAY khi page load → race với useEffect
            - Mobile Safari + Chrome desktop trải qua loop 400 trước khi clear

            Fix này:
            1. Nếu URL = /dang-nhap → clear localStorage + sessionStorage + cookie sb-*
               TRƯỚC khi SDK đọc storage cũ → SDK init fresh.
            2. Monkey-patch fetch global: detect 3 lần POST /auth/v1/token 400
               → auto clear all + redirect /dang-nhap.
            Đảm bảo chạy trên MỌI trang, KHÔNG cần user clear cache thủ công.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  try {
    var isLoginPage = location.pathname.indexOf('/dang-nhap') === 0;

    // 1. Nếu vào /dang-nhap → clear ngay localStorage + sessionStorage + cookie sb-*
    if (isLoginPage) {
      var lsKeys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('sb-') === 0) lsKeys.push(k);
      }
      for (var j = 0; j < lsKeys.length; j++) localStorage.removeItem(lsKeys[j]);

      var ssKeys = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf('sb-') === 0) ssKeys.push(k);
      }
      for (var j = 0; j < ssKeys.length; j++) sessionStorage.removeItem(ssKeys[j]);

      // Clear cookie sb-* (chỉ non-httpOnly visible từ JS — đủ cho refresh_token cache)
      var rootDomain = location.hostname.indexOf('.') > -1
        ? '.' + location.hostname.split('.').slice(-3).join('.')
        : location.hostname;
      var cookies = document.cookie.split('; ');
      for (var i = 0; i < cookies.length; i++) {
        var name = cookies[i].split('=')[0];
        if (name && name.indexOf('sb-') === 0) {
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + rootDomain;
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        }
      }
    }

    // 2. Monkey-patch fetch GLOBAL — detect 3 lần POST /auth/v1/token 400
    var origFetch = window.fetch;
    var failCount = 0;
    var THRESHOLD = 3;
    window.fetch = function(input, init) {
      return origFetch.apply(this, arguments).then(function(response) {
        try {
          var url = typeof input === 'string' ? input
            : (input && input.url) ? input.url
            : String(input);
          if (response.status === 400 && url.indexOf('/auth/v1/token') !== -1) {
            failCount++;
            if (failCount >= THRESHOLD) {
              failCount = 0;
              // Clear all sb-* storage
              var keys = [];
              for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('sb-') === 0) keys.push(k);
              }
              for (var j = 0; j < keys.length; j++) localStorage.removeItem(keys[j]);
              // Redirect login (KHÔNG reload nếu đã ở /dang-nhap để tránh loop)
              if (location.pathname.indexOf('/dang-nhap') !== 0) {
                location.replace('/dang-nhap?redirect=' + encodeURIComponent(location.pathname));
              }
            }
          } else if (response.ok && url.indexOf('/auth/v1/token') !== -1) {
            failCount = 0;
          }
        } catch(e) {}
        return response;
      });
    };
  } catch(e) {}
})();
            `.trim(),
          }}
        />
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
        {/* Sprint UX-1 Stage 1 (CEO 04/05/2026): top progress bar khi nav.
            Trước đây click menu page đứng yên không indicator → user tưởng
            web treo. Giờ có thanh xanh trên đầu hiện ngay khi link click.
            Color match brand primary (navy). */}
        <NextTopLoader
          color="#1E3A8A"
          height={3}
          showSpinner={false}
          shadow="0 0 8px #1E3A8A,0 0 4px #1E3A8A"
        />
        <Providers>{children}</Providers>
        {/* Vercel Analytics — Web Vitals + page views.
            Sprint LT-2 (CEO 04/05/2026). Free tier 2.5k events/tháng.
            Anh đã enable trong Vercel Dashboard → Project → Analytics. */}
        <Analytics />
      </body>
    </html>
  );
}
