"use client";

import { useEffect } from "react";
import { useSettings } from "@/lib/contexts/settings-context";

/**
 * Áp cài đặt Giao diện (Cài đặt → Giao diện) lên <html> của khu back-office.
 *
 * Trước 29/07/2026 bốn ô đó lưu vào settings.appearance rồi báo "Đã lưu"
 * nhưng KHÔNG dòng nào đọc ra — bấm xong không đổi gì. Component này là chỗ
 * đọc ra.
 *
 * Đặt ở <html> chứ không phải div con vì dialog/toast/dropdown render qua
 * portal ra <body>: gắn ở div con thì chúng nằm ngoài và không nhận được.
 *
 * Chỉ mount trong (main). POS/MKT/SOP giữ nguyên: thu ngân bấm tablet, thu
 * nhỏ chữ làm nút chạm tụt xuống dưới ngưỡng bấm thoải mái; POS lại có bảng
 * màu tối riêng nên chế độ tối chung không áp lên đó. Rời khu → unmount →
 * mọi thứ tự gỡ.
 */

/** Màu chủ đạo — oklch để đồng bộ với bảng màu trong globals.css. */
const ACCENTS: Record<string, { primary: string; fg: string }> = {
  blue: { primary: "oklch(0.43 0.19 263)", fg: "oklch(1 0 0)" }, // mặc định
  indigo: { primary: "oklch(0.45 0.20 285)", fg: "oklch(1 0 0)" },
  purple: { primary: "oklch(0.48 0.22 305)", fg: "oklch(1 0 0)" },
  pink: { primary: "oklch(0.58 0.22 355)", fg: "oklch(1 0 0)" },
  red: { primary: "oklch(0.53 0.21 27)", fg: "oklch(1 0 0)" },
  orange: { primary: "oklch(0.62 0.18 55)", fg: "oklch(1 0 0)" },
  green: { primary: "oklch(0.52 0.15 155)", fg: "oklch(1 0 0)" },
  teal: { primary: "oklch(0.55 0.12 195)", fg: "oklch(1 0 0)" },
};

const SCALE: Record<string, string> = {
  small: "ui-scale-sm",
  medium: "ui-scale-md",
  large: "ui-scale-lg",
};

const RADIUS: Record<string, string> = {
  none: "0rem",
  sm: "0.25rem",
  md: "0.5rem", // mặc định hiện tại
  lg: "0.875rem",
};

export function Appearance() {
  const { settings } = useSettings();
  const { theme, accentColor, fontSize, borderRadius } = settings.appearance;

  // ── Chủ đề sáng / tối / theo máy ──
  useEffect(() => {
    const el = document.documentElement;
    const apply = (toi: boolean) => el.classList.toggle("dark", toi);

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const onChange = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener("change", onChange);
      return () => {
        mq.removeEventListener("change", onChange);
        el.classList.remove("dark");
      };
    }

    apply(theme === "dark");
    return () => el.classList.remove("dark");
  }, [theme]);

  // ── Cỡ chữ ──
  useEffect(() => {
    const el = document.documentElement;
    const cls = SCALE[fontSize] ?? SCALE.small;
    el.classList.add(cls);
    return () => el.classList.remove(cls);
  }, [fontSize]);

  // ── Màu chủ đạo ──
  useEffect(() => {
    const el = document.documentElement;
    const mau = ACCENTS[accentColor];
    if (!mau) return;
    el.style.setProperty("--primary", mau.primary);
    el.style.setProperty("--primary-foreground", mau.fg);
    return () => {
      el.style.removeProperty("--primary");
      el.style.removeProperty("--primary-foreground");
    };
  }, [accentColor]);

  // ── Bo góc ── (mọi cỡ --radius-* đều tính từ --radius nên đặt 1 chỗ là đủ)
  useEffect(() => {
    const el = document.documentElement;
    const r = RADIUS[borderRadius];
    if (!r) return;
    el.style.setProperty("--radius", r);
    return () => {
      el.style.removeProperty("--radius");
    };
  }, [borderRadius]);

  return null;
}
