"use client";

import { useEffect, useState } from "react";
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

const DISMISS_KEY = "onebiz-fnb-pwa-dismissed";

export function PwaInstallPrompt() {
  const { isFnb } = useFnbSubdomain();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isFnb) return;
    if (typeof window === "undefined") return;

    // Đã dismiss trong 14 ngày gần nhất → ẩn
    const dismissed = localStorage.getItem(DISMISS_KEY);
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
    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, [isFnb]);

  if (!visible || !deferredPrompt) return null;

  const handleInstall = async () => {
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "dismissed") {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      }
    } catch {
      // ignore
    } finally {
      setDeferredPrompt(null);
      setVisible(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
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
          Cài ứng dụng FnB POS
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Bán hàng nhanh hơn, mở từ màn hình chính như app thật
        </p>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          type="button"
          onClick={handleInstall}
          className="press-scale-sm h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary-hover transition-colors"
        >
          Cài đặt
        </button>
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
