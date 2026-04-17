import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Màn hình bếp — OneBiz FnB",
  description: "KDS Kitchen Display System — OneBiz",
};

/**
 * KDS luôn chạy dark mode (Stitch KDS mockup) — quán bar thường ánh sáng
 * yếu, ca đêm dùng KDS cần tone tối để không chói mắt bartender.
 *
 * Wrapper div.dark bật tất cả `.dark` CSS vars từ globals.css, giúp mọi
 * component con (buttons, inputs, dropdown) tự động chuyển sang dark palette.
 */
export default function KdsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="dark min-h-screen bg-background text-foreground">{children}</div>;
}
