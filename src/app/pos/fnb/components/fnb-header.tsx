"use client";

/**
 * FnbHeader — Top navigation bar for F&B POS (KiotViet-style)
 *
 * Left:   "Phòng bàn" / "Thực đơn" toggle + search bar
 * Center: Order tabs (switch / close / create)
 * Right:  KDS + Settings
 */

import Link from "next/link";
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
}: FnbHeaderProps) {
  const { isFnb, fnbPath } = useFnbSubdomain();

  return (
    <header className="h-12 bg-pos-chrome-bg text-pos-chrome-fg flex items-center px-2 gap-1.5 shrink-0">
      {/* ── Left: back + branch selector + view mode tabs ── */}
      {!isFnb && (
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-pos-chrome-fg-muted hover:text-pos-chrome-fg transition-colors shrink-0"
        >
          <Icon name="arrow_back" size={16} />
        </Link>
      )}

      {/* POS FnB: CHỈ cho chọn quán (store). Ẩn kho tổng + xưởng. */}
      <PosBranchSelector variant="dark" filter={["store"]} showCode />

      {onShiftClick && (
        <ShiftIndicator shift={shift ?? null} onClick={onShiftClick} />
      )}

      {/* View mode toggle: Phòng bàn / Thực đơn */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={() => viewMode !== "floorplan" && onToggleFloorPlan()}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-l-md transition-colors",
            viewMode === "floorplan"
              ? "bg-primary text-on-primary"
              : "bg-pos-chrome-bg-elevated text-pos-chrome-fg-dim hover:bg-pos-chrome-bg-hover hover:text-pos-chrome-fg-muted"
          )}
        >
          <Icon name="chair" size={14} />
          <span className="hidden sm:inline">Phòng bàn</span>
        </button>
        <button
          type="button"
          onClick={() => viewMode !== "menu" && onToggleFloorPlan()}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-r-md transition-colors",
            viewMode === "menu"
              ? "bg-primary text-on-primary"
              : "bg-pos-chrome-bg-elevated text-pos-chrome-fg-dim hover:bg-pos-chrome-bg-hover hover:text-pos-chrome-fg-muted"
          )}
        >
          <Icon name="restaurant" size={14} />
          <span className="hidden sm:inline">Thực đơn</span>
        </button>
      </div>

      {/* Search bar (click to open F3 modal) */}
      <button
        type="button"
        onClick={onSearch}
        className="flex items-center gap-2 px-3 py-2 sm:py-1.5 bg-pos-chrome-bg-elevated hover:bg-pos-chrome-bg-hover active:bg-pos-chrome-bg-hover rounded-md text-sm sm:text-xs text-pos-chrome-fg-dim transition-colors shrink-0 min-w-0 sm:min-w-[140px] lg:min-w-[200px]"
      >
        <Icon name="search" size={14} />
        <span>Tìm món (F3)</span>
      </button>

      <div className="h-5 w-px bg-pos-chrome-border shrink-0" />

      {/* ── Center: tab bar ── */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors shrink-0",
                isActive
                  ? "bg-primary text-on-primary"
                  : "bg-pos-chrome-bg-elevated text-pos-chrome-fg-dim hover:bg-pos-chrome-bg-hover hover:text-pos-chrome-fg-muted"
              )}
            >
              <span className="max-w-[100px] truncate">{tab.label}</span>
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
                  "ml-0.5 rounded-full p-0.5 hover:bg-white/20 transition-colors",
                  isActive ? "text-primary-fixed" : "text-pos-chrome-fg-dim"
                )}
              >
                <Icon name="close" size={14} className="sm:h-3 sm:w-3" />
              </span>
            </button>
          );
        })}

        {/* Add tab button */}
        <button
          type="button"
          onClick={createTab}
          className="flex items-center justify-center h-8 w-8 sm:h-6 sm:w-6 rounded bg-pos-chrome-bg-elevated text-pos-chrome-fg-dim hover:bg-pos-chrome-bg-hover hover:text-pos-chrome-fg active:bg-pos-chrome-bg-hover transition-colors shrink-0"
          title="Thêm đơn mới"
        >
          <Icon name="add" size={14} />
        </button>
      </div>

      <div className="h-5 w-px bg-pos-chrome-border shrink-0" />

      {/* ── Right: KDS + settings ── */}
      <div className="flex items-center gap-1 shrink-0">
        <Link href={fnbPath("/pos/fnb/kds")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-pos-chrome-fg-muted hover:text-pos-chrome-fg hover:bg-pos-chrome-bg-elevated"
          >
            <Icon name="restaurant_menu" size={16} className="mr-1" />
            <span className="hidden lg:inline text-xs">Màn bếp</span>
          </Button>
        </Link>
        {!isFnb && (
          <Link href="/he-thong/quan-ly-ban">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-pos-chrome-fg-muted hover:text-pos-chrome-fg hover:bg-pos-chrome-bg-elevated"
              title="Quản lý bàn"
            >
              <Icon name="settings" size={16} />
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
