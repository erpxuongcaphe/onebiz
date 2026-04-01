"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCcw, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function PosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[PosError]", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-4 bg-gray-50">
      <div className="max-w-sm w-full text-center space-y-5">
        <div className="mx-auto h-14 w-14 rounded-full bg-red-100 flex items-center justify-center">
          <AlertCircle className="h-7 w-7 text-red-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Lỗi POS</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Màn hình bán hàng gặp sự cố. Vui lòng thử lại.
          </p>
          {error.digest && (
            <p className="mt-1 text-xs text-muted-foreground font-mono">
              Mã lỗi: {error.digest}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={reset} className="w-full">
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Thử lại
          </Button>
          <Link href="/">
            <Button variant="outline" className="w-full">
              <ChevronLeft className="h-4 w-4 mr-1.5" />
              Về quản lý
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
