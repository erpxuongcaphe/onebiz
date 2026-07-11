"use client";

import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

export default function MktError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <Icon name="error" size={40} className="text-rose-500" />
      <div className="max-w-md space-y-1">
        <h2 className="font-heading text-lg font-bold">Có lỗi khi tải trang</h2>
        <p className="text-sm text-on-surface-variant">
          Thường do mạng chập chờn. Bấm thử lại — nếu vẫn lỗi, chụp màn hình gửi quản trị.
        </p>
        {error.digest ? (
          <p className="text-xs text-on-surface-variant">Mã lỗi: {error.digest}</p>
        ) : null}
      </div>
      <Button onClick={reset}>
        <Icon name="refresh" size={18} /> Thử lại
      </Button>
    </div>
  );
}
