"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useFnbSubdomain } from "@/lib/hooks/use-fnb-subdomain";
import { Icon } from "@/components/ui/icon";

// ---------------------------------------------------------------------------
// PwaInstallPrompt — banner gọi ý cài đặt PWA cho FnB.
// Hiện duy nhất trên subdomain FnB, và chỉ khi browser hỗ trợ `beforeinstallprompt`.
// Ẩn khi user đã dismiss hoặc đã cài.
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const APP_PROMPT = {
  fnb: {
    dismissKey: "onebiz-fnb-pwa-dismissed",
    title: "Cài ứng dụng FnB POS",
    description: "Bán hàng nhanh hơn, mở từ màn hình chính như app thật",
  },
  manager: {
    dismissKey: "onebiz-manager-pwa-dismissed",
    title: "Cài ứng dụng Manager",
    description: "Theo dõi doanh số, tồn kho và cảnh báo nhanh trên điện thoại",
  },
  // Day 6 16/05/2026: Toàn bộ ERP web (onebiz.com.vn) cũng installable.
  // Khác manager mode (start_url=/manager) — main app start_url=/ → full ERP.
  erp: {
    dismissKey: "onebiz-erp-pwa-dismissed",
    title: "Cài ứng dụng OneBiz",
    description: "Mở nhanh ERP từ màn hình chính, nhận thông báo push",
  },
} as const;

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function PwaInstallPrompt() {
  const { isFnb } = useFnbSubdomain();
  const pathname = usePathname();
  const isManagerApp = pathname.startsWith("/manager");
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  // Day 6 16/05/2026: bật prompt cho mọi đường dẫn (kể cả ERP main),
  // không chỉ /manager. Bỏ qua /dang-nhap để không ép user chưa login.
  const isAuthRoute =
    pathname.startsWith("/dang-nhap") || pathname.startsWith("/dang-ky");
  const promptConfig = isAuthRoute
    ? null
    : isFnb
      ? APP_PROMPT.fnb
      : isManagerApp
        ? APP_PROMPT.manager
        : APP_PROMPT.erp;

  useEffect(() => {
    if (!promptConfig) return;
    if (typeof window === "undefined") return;

    // Đã dismiss trong 14 ngày gần nhất → ẩn
    const dismissed = localStorage.getItem(promptConfig.dismissKey);
    if (dismissed) {
      const ts = parseInt(dismissed, 10);
      if (!Number.isNaN(ts) && Date.now() - ts < 14 * 24 * 60 * 60 * 1000) {
        return;
      }
    }

    // Đã cài rồi → ẩn
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Day 6 16/05/2026: iOS Safari không emit beforeinstallprompt
    // → fallback hint sau 10s nếu user chưa cài.
    let iosTimer: ReturnType<typeof setTimeout> | null = null;
    if (isIos()) {
      iosTimer = setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, 10_000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, [promptConfig]);

  // Day 6 16/05/2026: chấp nhận hiển thị khi có iOS hint dù không có deferredPrompt.
  if (!promptConfig || !visible || (!deferredPrompt && !iosHint)) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return; // iOS hint mode → không có deferredPrompt
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "dismissed") {
        localStorage.setItem(promptConfig.dismissKey, String(Date.now()));
      }
    } catch {
      // ignore
    } finally {
      setDeferredPrompt(null);
      setVisible(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(promptConfig.dismissKey, String(Date.now()));
    setVisible(false);
  };

  return (
    <div
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:max-w-sm z-50 rounded-2xl bg-surface-container-lowest border border-primary-fixed p-4 ambient-shadow-lg flex items-center gap-3 stitch-fade-in"
      role="dialog"
      aria-labelledby="pwa-install-title"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-fixed">
        <Icon name="download" size={24} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p
          id="pwa-install-title"
          className="font-heading text-sm font-bold text-foreground leading-tight"
        >
          {promptConfig.title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {iosHint
            ? "Trên iPhone/iPad: bấm Chia sẻ → Thêm vào màn hình chính"
            : promptConfig.description}
        </p>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        {!iosHint && deferredPrompt && (
          <button
            type="button"
            onClick={handleInstall}
            className="press-scale-sm h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary-hover transition-colors"
          >
            Cài đặt
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          className="press-scale-sm h-7 px-3 rounded-lg text-muted-foreground text-xs hover:text-foreground hover:bg-surface-container-low transition-colors"
        >
          Để sau
        </button>
      </div>
    </div>
  );
}
