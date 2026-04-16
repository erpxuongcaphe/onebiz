"use client";

/**
 * FnbHeader — Top navigation bar for F&B POS (KiotViet-style)
 *
 * Left:   "Phòng bàn" / "Thực đơn" toggle + search bar
 * Center: Order tabs (switch / close / create)
 * Right:  KDS + Settings
 */

import Link from "next/link";
import { ArrowLeft, Plus, X, Armchair, UtensilsCrossed, Search, ChefHat, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FnbTabSnapshot } from "@/lib/types/fnb";
import type { Shift } from "@/lib/types/shift";
import { PosBranchSelector } from "@/components/shared/pos-branch-selector";
import { ShiftIndicator } from "./shift-indicator";
import { useFnbSubdomain } from "@/lib/hooks/use-fnb-subdomain";

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
    <header className="h-12 bg-slate-900 text-white flex items-center px-2 gap-1.5 shrink-0">
      {/* ── Left: back + branch selector + view mode tabs ── */}
      {!isFnb && (
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-slate-300 hover:text-white transition-colors shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
      )}

      <PosBranchSelector variant="dark" />

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
              ? "bg-blue-600 text-white"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
          )}
        >
          <Armchair className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Phòng bàn</span>
        </button>
        <button
          type="button"
          onClick={() => viewMode !== "menu" && onToggleFloorPlan()}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-r-md transition-colors",
            viewMode === "menu"
              ? "bg-blue-600 text-white"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
          )}
        >
          <UtensilsCrossed className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Thực đơn</span>
        </button>
      </div>

      {/* Search bar (click to open F3 modal) */}
      <button
        type="button"
        onClick={onSearch}
        className="flex items-center gap-2 px-3 py-2 sm:py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-md text-sm sm:text-xs text-slate-400 transition-colors shrink-0 min-w-0 sm:min-w-[140px] lg:min-w-[200px]"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Tìm món (F3)</span>
      </button>

      <div className="h-5 w-px bg-slate-700 shrink-0" />

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
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
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
                  isActive ? "text-blue-200" : "text-slate-500"
                )}
              >
                <X className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
              </span>
            </button>
          );
        })}

        {/* Add tab button */}
        <button
          type="button"
          onClick={createTab}
          className="flex items-center justify-center h-8 w-8 sm:h-6 sm:w-6 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white active:bg-slate-600 transition-colors shrink-0"
          title="Thêm đơn mới"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="h-5 w-px bg-slate-700 shrink-0" />

      {/* ── Right: KDS + settings ── */}
      <div className="flex items-center gap-1 shrink-0">
        <Link href={fnbPath("/pos/fnb/kds")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-slate-300 hover:text-white hover:bg-slate-800"
          >
            <ChefHat className="h-4 w-4 mr-1" />
            <span className="hidden lg:inline text-xs">Màn bếp</span>
          </Button>
        </Link>
        {!isFnb && (
          <Link href="/he-thong/quan-ly-ban">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-300 hover:text-white hover:bg-slate-800"
              title="Quản lý bàn"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
