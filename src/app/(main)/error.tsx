"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";

export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[MainError]", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
          <Icon name="error" size={32} className="text-red-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Đã xảy ra lỗi</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Trang này gặp sự cố. Vui lòng thử lại hoặc quay về trang chủ.
          </p>
          {error.digest && (
            <p className="mt-1 text-xs text-muted-foreground font-mono">
              Mã lỗi: {error.digest}
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={reset}>
            <Icon name="undo" size={16} className="mr-1.5" />
            Thử lại
          </Button>
          <Link href="/">
            <Button variant="outline">
              <Icon name="home" size={16} className="mr-1.5" />
              Về trang chủ
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
