// Day 5 16/05/2026: Layout cho trang Quy trình tác nghiệp (SOP).
// In-browser → Bấm Ctrl+P → "Lưu thành PDF" → đưa cho nhân viên.
// Thuần Tiếng Việt tối đa theo yêu cầu CEO.

import type { ReactNode } from "react";

export const metadata = {
  title: "Quy trình tác nghiệp — OneBiz",
  description:
    "Sổ tay quy trình dành cho thu ngân / pha chế / bếp / quản lý quán cà phê OneBiz.",
};

export default function SopLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-white text-black antialiased">
        <div className="mx-auto max-w-[820px] p-8 print:p-0 print:max-w-none">
          {children}
        </div>
        <style>{`
          /* Pretty A4 layout cho in PDF.
             - Body chữ đen trên nền trắng (mực rẻ hơn so với gradient).
             - Page break tránh cắt giữa mục.
             - Ẩn link điều hướng khi in. */
          @media print {
            @page { margin: 18mm 16mm; size: A4; }
            body { background: white !important; }
            .no-print { display: none !important; }
            h1, h2, h3 { break-after: avoid; }
            section { break-inside: avoid; }
          }
          body { font-family: 'Inter', system-ui, sans-serif; }
          h1 { font-size: 22px; margin-bottom: 8px; }
          h2 { font-size: 16px; margin-top: 18px; margin-bottom: 6px; font-weight: 600; }
          h3 { font-size: 14px; margin-top: 12px; margin-bottom: 4px; font-weight: 600; }
          p, li { font-size: 13px; line-height: 1.55; }
          ol, ul { padding-left: 20px; }
          li { margin: 3px 0; }
          section { padding: 12px 14px; border: 1px solid #ddd; border-radius: 6px; margin-top: 10px; background: #fafafa; }
          section.warn { border-color: #f5c2c2; background: #fff5f5; }
          section.tip { border-color: #c4e0c4; background: #f3fbf3; }
          .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; background: #1e3a8a; color: white; font-size: 11px; font-weight: 600; margin-right: 4px; }
          .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 14px; }
          .header .role { font-size: 12px; color: #555; }
          .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 11px; color: #666; }
        `}</style>
      </body>
    </html>
  );
}
