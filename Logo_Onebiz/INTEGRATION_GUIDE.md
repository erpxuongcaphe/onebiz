# ONEBIZ Brand Assets — Hướng dẫn sử dụng

Tất cả file logo + icon cho OneBiz ERP Suite. Đã optimize cho Next.js App Router.

## File list

```
onebiz-logo.svg              Wordmark chính — navy + period blue
onebiz-logo-white.svg        Wordmark trắng — cho dark background
onebiz-logo-mono.svg         Wordmark một tông navy — cho in ấn đen trắng
onebiz-icon.svg              App icon vector — dùng cho favicon hiện đại
onebiz-icon-16.png           Favicon 16×16
onebiz-icon-32.png           Favicon 32×32
onebiz-icon-48.png           Favicon 48×48 / Windows tile
onebiz-icon-180.png          apple-touch-icon (iOS home screen)
onebiz-icon-192.png          PWA Android home screen
onebiz-icon-512.png          PWA splash / app store
favicon.ico                  Multi-size ICO cho browser cũ
```

## Brand tokens

Copy vào `tailwind.config.ts` hoặc `globals.css` để dùng xuyên suốt project:

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#1E3A8A',      // Wordmark chính
          blue: '#2563EB',      // Period accent, primary action
          'blue-light': '#60A5FA', // Period on dark bg
        },
      },
    },
  },
}
```

```css
/* Hoặc globals.css nếu không dùng Tailwind */
:root {
  --brand-navy: #1E3A8A;
  --brand-blue: #2563EB;
  --brand-blue-light: #60A5FA;
}
```

## Bước 1 — Setup favicon và metadata (Next.js App Router)

### Copy file vào `app/` folder

Next.js App Router tự động detect file theo tên quy ước:

```bash
# Từ folder outputs, copy vào project:
cp favicon.ico              app/favicon.ico
cp onebiz-icon.svg          app/icon.svg
cp onebiz-icon-180.png      app/apple-icon.png
```

Chỉ cần 3 file trên. Next.js auto-generate `<link>` tags. **Không cần viết thêm gì trong `<head>`.**

### Update metadata trong `app/layout.tsx`

```tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'ONEBIZ.',
    template: '%s · ONEBIZ.',
  },
  description: 'ERP Suite — Quản lý doanh nghiệp tất cả trong một',
  applicationName: 'ONEBIZ',
  themeColor: '#1E3A8A',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  )
}
```

Template `'%s · ONEBIZ.'` làm browser tab title mỗi page thành ví dụ `Dashboard · ONEBIZ.`, `Bán hàng · ONEBIZ.` — consistent brand signature.

## Bước 2 — Setup PWA (cho mobile install)

### Copy PNG vào `public/`

```bash
cp onebiz-icon-192.png public/icons/icon-192.png
cp onebiz-icon-512.png public/icons/icon-512.png
```

### Tạo `app/manifest.ts`

```ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ONEBIZ ERP Suite',
    short_name: 'ONEBIZ',
    description: 'Quản lý doanh nghiệp tất cả trong một',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#1E3A8A',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
```

Next.js tự generate `manifest.webmanifest` endpoint. User mobile sẽ có option "Add to Home Screen" → mở app đầy đủ.

## Bước 3 — Logo component cho sidebar

### Copy wordmark SVG vào `public/brand/`

```bash
cp onebiz-logo.svg       public/brand/wordmark.svg
cp onebiz-logo-white.svg public/brand/wordmark-white.svg
```

### Tạo `components/brand/Logo.tsx`

```tsx
import Image from 'next/image'

interface LogoProps {
  variant?: 'default' | 'white'
  width?: number
  className?: string
}

export function Logo({ variant = 'default', width = 140, className }: LogoProps) {
  const src = variant === 'white'
    ? '/brand/wordmark-white.svg'
    : '/brand/wordmark.svg'

  // SVG viewBox ratio: 268.02 : 48 ≈ 5.58 : 1
  const height = Math.round(width / 5.58)

  return (
    <Image
      src={src}
      alt="ONEBIZ"
      width={width}
      height={height}
      className={className}
      priority
    />
  )
}
```

### Dùng trong sidebar

```tsx
// components/layout/Sidebar.tsx
import { Logo } from '@/components/brand/Logo'

export function Sidebar() {
  return (
    <aside className="w-64 border-r">
      <div className="p-4">
        <Logo width={130} />
      </div>
      {/* menu items */}
    </aside>
  )
}
```

Thay thế chỗ `<div className="rounded-full bg-black">O</div>` + text "OneBiz / ERP SUITE" hiện tại.

## Bước 4 — (Optional) Inline SVG cho performance tốt nhất

Nếu muốn tránh thêm HTTP request cho logo, inline SVG trực tiếp trong component. Tốt cho above-the-fold render:

```tsx
export function LogoInline({ className = 'h-6' }: { className?: string }) {
  return (
    <svg
      viewBox="-11.40 -4.00 268.02 48.00"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="ONEBIZ"
    >
      {/* Copy content từ onebiz-logo.svg vào đây */}
    </svg>
  )
}
```

Mở file `onebiz-logo.svg` bằng editor, copy phần bên trong `<svg>...</svg>` paste vào. Trade-off: bundle JS tăng ~1.5KB nhưng bỏ được 1 request.

## Bước 5 — Login / hero page

Nếu có trang login hoặc landing:

```tsx
export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Logo width={200} />
          <p className="mt-2 text-sm text-slate-500">
            ERP Suite — Quản lý doanh nghiệp
          </p>
        </div>
        {/* login form */}
      </div>
    </div>
  )
}
```

## Checklist deploy

Sau khi push lên Vercel, kiểm tra:

- [ ] Browser tab hiện icon OneBiz (mở incognito để bypass cache)
- [ ] Browser tab title có signature `· ONEBIZ.`
- [ ] Trên mobile Safari → Share → Add to Home Screen → icon hiện đúng
- [ ] Chrome DevTools → Application → Manifest: hiển thị đủ metadata
- [ ] Social share test: `https://www.opengraph.xyz/url/https%3A%2F%2Fonebiz.com.vn`

## Về fonts UI

Logo đã convert text → path, không phụ thuộc font. Nhưng nếu muốn UI của web khớp aesthetic với logo (sans-serif clean modern), cân nhắc dùng **Inter** làm body font:

```tsx
// app/layout.tsx
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin', 'vietnamese'], display: 'swap' })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={inter.className}>
      <body>{children}</body>
    </html>
  )
}
```

Inter render tiếng Việt rất tốt (có subset `vietnamese`), free, được Stripe/GitHub/Linear dùng.

---

## Troubleshooting

**Q: Favicon không update sau khi deploy?**
Browser cache aggressive với favicon. Hard refresh (Ctrl+Shift+R) hoặc mở incognito. Trên production, favicon sẽ auto-update sau ~1-7 ngày.

**Q: Icon bị mờ ở Retina display?**
Next.js tự handle `sizes` nhưng nếu vẫn mờ, dùng PNG 512×512 thay vì 192×192 cho apple-icon.

**Q: Muốn đổi thành 1biz sau này?**
Chỉ cần re-run script build (file `build_wordmark.py` + `build_icon.py`), đổi biến `TEXT = "1BIZ"`. Mọi thứ khác giữ nguyên.
