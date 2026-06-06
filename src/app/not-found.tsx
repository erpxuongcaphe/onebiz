"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <Icon name="quiz" size={80} className="text-muted-foreground/50" />
        </div>
        <div className="space-y-2">
          <h1 className="text-7xl font-bold tracking-tighter text-foreground">
            404
          </h1>
          <h2 className="text-xl font-semibold text-foreground">
            Trang không tồn tại
          </h2>
          <p className="text-muted-foreground">
            Xin lỗi, trang bạn đang tìm kiếm không tồn tại hoặc đã bị di chuyển.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Link href="/">
            <Button>Về trang chủ</Button>
          </Link>
          <Button variant="outline" onClick={() => router.back()}>
            Quay lại
          </Button>
        </div>
      </div>
    </div>
  );
}
