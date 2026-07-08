"use client";

import { Icon } from "@/components/ui/icon";

/**
 * AllBranchesBanner — CEO 08/07/2026.
 *
 * Hiện phía trên danh sách chứng từ kho khi user đã bấm "Xem tất cả chi nhánh"
 * (từ empty-state), báo rõ đang bỏ lọc chi nhánh + cho quay lại chỉ xem chi
 * nhánh hiện tại. Việc bỏ lọc là CỤC BỘ trong màn — KHÔNG đổi chi nhánh toàn
 * hệ thống (global switcher giữ nguyên).
 */
export function AllBranchesBanner({
  branchName,
  onBackToBranch,
}: {
  /** Tên chi nhánh đang chọn ở global switcher — để nhãn nút "Chỉ xem …". */
  branchName?: string;
  /** Quay lại lọc theo chi nhánh hiện tại. */
  onBackToBranch: () => void;
}) {
  return (
    <div className="mx-4 mt-2 mb-1 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm">
      <Icon name="apartment" size={16} className="shrink-0 text-primary" />
      <span className="text-foreground">
        Đang xem phiếu của <b>tất cả chi nhánh</b>.
      </span>
      <button
        type="button"
        onClick={onBackToBranch}
        className="ml-auto inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="arrow_back" size={14} />
        {branchName ? `Chỉ xem ${branchName}` : "Chỉ xem chi nhánh hiện tại"}
      </button>
    </div>
  );
}
