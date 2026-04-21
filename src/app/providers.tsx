"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, SettingsProvider, ToastProvider } from "@/lib/contexts";
import { ToastContainer } from "@/components/shared/toast";
import { PwaInstallPrompt } from "@/components/shared/pwa-install-prompt";
import { AuthSessionToast } from "@/components/shared/auth-session-toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SettingsProvider>
        <ToastProvider>
          <TooltipProvider>
            {children}
            <ToastContainer />
            <PwaInstallPrompt />
            <AuthSessionToast />
          </TooltipProvider>
        </ToastProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
