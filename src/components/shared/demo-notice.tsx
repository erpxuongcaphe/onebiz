"use client";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

interface DemoNoticeProps {
  /** Tiêu đề chính — thường là "Dữ liệu mẫu" hoặc "Tính năng đang phát triển". */
  title?: string;
  /** Mô tả chi tiết — giải thích vì sao thấy dữ liệu mock và khi nào có thật. */
  description?: string;
  className?: string;
}

/**
 * DemoNotice — banner cảnh báo trang đang dùng dữ liệu mẫu (chưa kết nối DB).
 *
 * Dùng cho các module đang trong giai đoạn UI prototype (vd /ban-online/*,
 * /he-thong/tich-hop) để nhân viên nội bộ không nhầm số liệu mock với số thật.
 *
 * Stitch tone: warning (amber) — visible nhưng không alarming. Kèm icon
 * `engineering` để gợi ý "đang xây dựng".
 */
export function DemoNotice({
  title = "Dữ liệu mẫu — chưa kết nối hệ thống",
  description = "Các con số và danh sách trên trang này là giả lập để minh hoạ giao diện. Tính năng sẽ được kết nối với cơ sở dữ liệu trong sprint tiếp theo.",
  className,
}: DemoNoticeProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-sm",
        className,
      )}
    >
      <span className="flex-none mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-status-warning/15 text-status-warning">
        <Icon name="engineering" size={16} />
      </span>
      <div className="min-w-0">
        <p className="font-medium text-status-warning">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
