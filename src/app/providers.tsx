"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, SettingsProvider, ToastProvider } from "@/lib/contexts";
import { ToastContainer } from "@/components/shared/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SettingsProvider>
        <ToastProvider>
          <TooltipProvider>
            {children}
            <ToastContainer />
          </TooltipProvider>
        </ToastProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
