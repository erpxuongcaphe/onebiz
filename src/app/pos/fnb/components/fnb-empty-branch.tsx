"use client";

/**
 * FnbEmptyBranch — Empty state khi tenant đã load xong nhưng KHÔNG có
 * chi nhánh FnB nào (vd CEO mới setup, chưa tạo branch type=store).
 *
 * Sprint LOAD-1 (CEO 08/05): replace "1 dòng text rỗng" trước đây bằng
 * UI có illustration + heading + CTA rõ ràng → user hiểu cần làm gì.
 *
 * Khác với FnbLoadingSkeleton:
 *   - Skeleton hiện khi đang LOAD (có thể có branch sắp tới).
 *   - EmptyBranch hiện khi LOAD XONG nhưng confirm không có branch.
 */

import Link from "next/link";
import { FnbHeader } from "./fnb-header";
import { Icon } from "@/components/ui/icon";

interface FnbEmptyBranchProps {
  onMenuClick?: () => void;
  onSearch?: () => void;
}

export function FnbEmptyBranch({ onMenuClick, onSearch }: FnbEmptyBranchProps) {
  return (
    <div className="flex flex-col h-screen bg-surface-container-low">
      <FnbHeader
        tabs={[]}
        activeTabId=""
        switchTab={() => {}}
        closeTab={() => {}}
        createTab={() => {}}
        onToggleFloorPlan={() => {}}
        onSearch={onSearch ?? (() => {})}
        onMenuClick={onMenuClick}
      />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-5">
          {/* Illustration */}
          <div className="relative w-32 h-32 mx-auto">
            <div className="absolute inset-0 rounded-full bg-primary-fixed/40 animate-pulse" />
            <div className="relative w-full h-full flex items-center justify-center text-primary">
              <Icon name="storefront" size={64} />
            </div>
          </div>

          {/* Heading */}
          <div className="space-y-2">
            <h2 className="font-heading text-2xl font-bold text-foreground">
              Chưa có chi nhánh FnB
            </h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Anh cần tạo ít nhất 1 chi nhánh kiểu <strong>"Quán FnB"</strong> để
              bắt đầu bán hàng. Nhân viên sẽ chọn quán làm việc trên header POS.
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col gap-2 pt-2">
            <Link
              href="/he-thong/chi-nhanh"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors press-scale-sm"
            >
              <Icon name="add_business" size={18} />
              Tạo chi nhánh FnB
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              <Icon name="arrow_back" size={16} />
              Về trang chủ
            </Link>
          </div>

          {/* Tip */}
          <div className="pt-4 px-4 py-3 rounded-xl bg-status-info/10 border border-status-info/20 text-left">
            <div className="flex items-start gap-2">
              <Icon name="lightbulb" size={16} className="text-status-info shrink-0 mt-0.5" />
              <div className="text-xs text-on-surface-variant leading-relaxed">
                <strong className="text-foreground">Mẹo:</strong> Nếu anh đã có
                chi nhánh nhưng kiểu <em>"Kho"</em> hoặc <em>"Xưởng"</em>, vào
                Hệ thống → Chi nhánh để đổi loại sang <strong>"Quán FnB"</strong>.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
