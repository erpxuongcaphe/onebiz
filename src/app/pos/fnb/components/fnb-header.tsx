"use client";

/**
 * FnbHeader — Top navigation bar for F&B POS (Sprint UI-1, CEO 07/05).
 *
 * Light theme align mockup v3 desktop. Cấu trúc:
 *   [☰] [Logo OneBiz] [Branch] [Shift] [Bán hàng / Sơ đồ bàn] [Tìm món F3] [Tabs] [...]  [KDS] [⚙]
 *
 * Khác bản dark trước:
 *   - bg surface trắng + backdrop-blur (glass) thay vì bg-pos-chrome-bg slate đen.
 *   - Height 64px (h-16) thay 48px → thoáng + đủ chỗ logo + chip lớn.
 *   - Border bottom subtle outline-variant/30.
 *   - Text foreground (đậm) trên light bg.
 *
 * KDS giữ dark vì môi trường bếp khác (góc tối, hiển thị order liên tục).
 * KHÔNG đổi token `pos-chrome-*` global vì KDS + tests vẫn dùng.
 */

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FnbTabSnapshot } from "@/lib/types/fnb";
import type { Shift } from "@/lib/types/shift";
import { PosBranchSelector } from "@/components/shared/pos-branch-selector";
import { ShiftIndicator } from "./shift-indicator";
import { useFnbSubdomain } from "@/lib/hooks/use-fnb-subdomain";
import { Icon } from "@/components/ui/icon";

interface FnbHeaderProps {
  tabs: FnbTabSnapshot[];
  activeTabId: string;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  createTab: () => void;
  onToggleFloorPlan: () => void;
  onSearch: () => void;
  shift?: Shift | null;
  onShiftClick?: () => void;
  viewMode?: "menu" | "floorplan";
  /** Sprint A: Mở sidenav drawer (☰ trigger). */
  onMenuClick?: () => void;
}

export function FnbHeader({
  tabs,
  activeTabId,
  switchTab,
  closeTab,
  createTab,
  onToggleFloorPlan,
  onSearch,
  shift,
  onShiftClick,
  viewMode = "menu",
  onMenuClick,
}: FnbHeaderProps) {
  const { isFnb, fnbPath } = useFnbSubdomain();

  return (
    <header className="h-16 bg-surface/95 backdrop-blur-md text-foreground flex items-center px-3 gap-2 shrink-0 border-b border-outline-variant/30">
      {/* ☰ Sidenav trigger */}
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-on-surface-variant hover:text-foreground hover:bg-surface-container transition-colors shrink-0"
          aria-label="Mở menu điều hướng"
          title="Menu điều hướng (☰)"
        >
          <Icon name="menu" size={20} />
        </button>
      )}
      {!onMenuClick && !isFnb && (
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-foreground transition-colors shrink-0"
        >
          <Icon name="arrow_back" size={18} />
        </Link>
      )}

      {/* Logo OneBiz — chỉ icon 28px, không text vì branch chip đã chiếm space */}
      <Link
        href={isFnb ? "/" : "/"}
        className="flex items-center shrink-0 hover:opacity-80 transition-opacity"
        title="Trang chủ OneBiz"
      >
        <Image
          src="/onebiz-icon.svg"
          alt="OneBiz"
          width={28}
          height={28}
          priority
          className="select-none"
        />
      </Link>

      {/* POS FnB: CHỈ chọn quán (store). Light variant cho header trắng. */}
      <PosBranchSelector variant="light" filter={["store"]} showCode />

      {onShiftClick && (
        <ShiftIndicator shift={shift ?? null} onClick={onShiftClick} />
      )}

      {/* View mode toggle: Sprint UI-3 — wording chuẩn "Bán hàng / Sơ đồ bàn" */}
      <div className="flex items-center bg-surface-container rounded-xl p-1 shrink-0">
        <button
          type="button"
          onClick={() => viewMode !== "menu" && onToggleFloorPlan()}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
            viewMode === "menu"
              ? "bg-surface text-primary ambient-shadow"
              : "text-on-surface-variant hover:text-foreground",
          )}
          title="Xem thực đơn để bán hàng"
        >
          <Icon name="restaurant" size={14} />
          <span className="hidden sm:inline">Bán hàng</span>
        </button>
        <button
          type="button"
          onClick={() => viewMode !== "floorplan" && onToggleFloorPlan()}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
            viewMode === "floorplan"
              ? "bg-surface text-primary ambient-shadow"
              : "text-on-surface-variant hover:text-foreground",
          )}
          title="Xem sơ đồ bàn"
        >
          <Icon name="table_restaurant" size={14} />
          <span className="hidden sm:inline">Sơ đồ bàn</span>
        </button>
      </div>

      {/* Search bar — click open F3 modal */}
      <button
        type="button"
        onClick={onSearch}
        className="flex items-center gap-2 px-3 py-2 bg-surface-container hover:bg-surface-container-high rounded-xl text-xs sm:text-sm text-on-surface-variant transition-colors shrink-0 min-w-0 sm:min-w-[160px] lg:min-w-[220px]"
        title="Tìm món (F3)"
      >
        <Icon name="search" size={16} />
        <span>Tìm món (F3)</span>
      </button>

      <div className="h-6 w-px bg-outline-variant/30 shrink-0" />

      {/* Tab bar — Sprint UI-2 sẽ tách thành row riêng. Hiện inline với padding mới. */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          // Colored dot theo orderType (xanh dine_in / cam takeaway / tím delivery).
          // Delivery dùng status-success (xanh lá) thay vì purple — token chưa
          // có status-purple. Tone: xanh dương / cam / xanh lá đủ phân biệt.
          const dotColor =
            tab.orderType === "dine_in"
              ? "bg-status-info"
              : tab.orderType === "takeaway"
                ? "bg-status-warning"
                : "bg-status-success";
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors shrink-0",
                isActive
                  ? "bg-primary-fixed text-primary"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-foreground",
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", dotColor)} />
              <span className="max-w-[120px] truncate">{tab.label}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }
                }}
                className={cn(
                  "ml-0.5 rounded-full p-0.5 transition-colors",
                  isActive
                    ? "text-primary hover:bg-primary/20"
                    : "text-on-surface-variant hover:bg-surface-container-highest",
                )}
              >
                <Icon name="close" size={12} />
              </span>
            </button>
          );
        })}

        {/* Add tab button */}
        <button
          type="button"
          onClick={createTab}
          className="flex items-center justify-center h-8 w-8 rounded-lg bg-surface-container text-on-surface-variant hover:bg-primary-fixed hover:text-primary transition-colors shrink-0"
          title="Thêm đơn mới"
        >
          <Icon name="add" size={16} />
        </button>
      </div>

      <div className="h-6 w-px bg-outline-variant/30 shrink-0" />

      {/* Right: KDS + settings */}
      <div className="flex items-center gap-1 shrink-0">
        <Link href={fnbPath("/pos/fnb/kds")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-on-surface-variant hover:text-foreground hover:bg-surface-container"
          >
            <Icon name="restaurant_menu" size={16} className="mr-1.5" />
            <span className="hidden lg:inline text-xs font-semibold">Màn bếp</span>
          </Button>
        </Link>
        {!isFnb && (
          <Link href="/he-thong/quan-ly-ban">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-on-surface-variant hover:text-foreground hover:bg-surface-container"
              title="Quản lý bàn"
            >
              <Icon name="settings" size={18} />
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
