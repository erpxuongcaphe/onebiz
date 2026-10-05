"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useToast } from "@/lib/contexts/toast-context";
import type { PrintResult } from "@/lib/printer/printer-service";

export function PrintJobFeedback() {
  const pathname = usePathname();
  const { toast } = useToast();
  useEffect(() => {
    const handler = (event: Event) => {
      if (pathname.startsWith("/pos/fnb")) return; // POS already reports its print errors.
      const result = (event as CustomEvent<PrintResult>).detail;
      if (result && (!result.success || result.warning)) toast({title:result.success ? "Lưu ý bản in" : "Không gửi được lệnh in",description:result.warning,variant:result.success ? "warning" : "error",duration:10000});
    };
    window.addEventListener("onebiz-print-result", handler);
    return () => window.removeEventListener("onebiz-print-result", handler);
  }, [pathname, toast]);
  return null;
}
