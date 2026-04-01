"use client";

import Link from "next/link";
import { Plus, X, User, ChevronLeft, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderTab, SaleMode } from "@/lib/types";

interface PosTopBarProps {
  tabs: OrderTab[];
  activeTabId: string;
  saleMode: SaleMode;
  currentTime: string;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
  onSetSaleMode: (mode: SaleMode) => void;
}

export function PosTopBar({
  tabs,
  activeTabId,
  saleMode,
  currentTime,
  onSwitchTab,
  onCloseTab,
  onAddTab,
  onSetSaleMode,
}: PosTopBarProps) {
  return (
    <div className="h-10 bg-[hsl(217,91%,40%)] flex items-center px-2 text-white shrink-0 gap-2">
      {/* Left: Logo + Back */}
      <Link
        href="/"
        className="flex items-center gap-1 text-white/90 hover:text-white text-sm shrink-0 mr-2"
      >
        <ChevronLeft className="size-4" />
        <span className="hidden sm:inline">Quan ly</span>
      </Link>
      <span className="font-bold text-sm shrink-0 hidden md:inline mr-2">
        OneBiz POS
      </span>

      {/* Center: Order Tabs */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto mx-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSwitchTab(tab.id)}
            className={cn(
              "flex items-center gap-1 px-3 h-7 rounded text-xs whitespace-nowrap shrink-0 transition-colors",
              tab.id === activeTabId
                ? "bg-white/20 text-white font-medium"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            )}
          >
            <span>{tab.label}</span>
            {tab.cart.length > 0 && (
              <span className="bg-white/30 text-[10px] rounded-full px-1.5 leading-4">
                {tab.cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            )}
            {tabs.length > 1 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="ml-0.5 hover:bg-white/20 rounded-full p-0.5 leading-none cursor-pointer"
              >
                <X className="size-3" />
              </span>
            )}
          </button>
        ))}
        <button
          onClick={onAddTab}
          className="shrink-0 size-7 flex items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {/* Right: Sale Mode + Clock + Avatar */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Sale mode toggle - desktop only */}
        <div className="hidden lg:flex items-center bg-white/10 rounded h-7 overflow-hidden">
          {(
            [
              { key: "quick", label: "Ban nhanh" },
              { key: "normal", label: "Ban thuong" },
              { key: "delivery", label: "Giao hang" },
            ] as const
          ).map((mode) => (
            <button
              key={mode.key}
              onClick={() => onSetSaleMode(mode.key)}
              className={cn(
                "px-2.5 h-full text-xs whitespace-nowrap transition-colors",
                saleMode === mode.key
                  ? "bg-white/25 text-white font-medium"
                  : "text-white/70 hover:text-white"
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Clock */}
        <div className="hidden sm:flex items-center gap-1 text-xs text-white/80 ml-2">
          <Clock className="size-3.5" />
          <span className="font-mono w-[60px]">{currentTime}</span>
        </div>

        {/* User avatar */}
        <div className="size-7 rounded-full bg-white/20 flex items-center justify-center ml-1">
          <User className="size-4 text-white/80" />
        </div>
      </div>
    </div>
  );
}
