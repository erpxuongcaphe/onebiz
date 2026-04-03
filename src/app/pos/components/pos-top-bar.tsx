"use client";

import Link from "next/link";
import { Plus, X, User, ChevronLeft, Clock, Zap, ShoppingBag, Truck } from "lucide-react";
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

const SALE_MODES = [
  { key: "quick" as const, label: "Bán nhanh", shortLabel: "Nhanh", icon: Zap },
  { key: "normal" as const, label: "Bán thường", shortLabel: "Thường", icon: ShoppingBag },
  { key: "delivery" as const, label: "Giao hàng", shortLabel: "GH", icon: Truck },
];

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
    <div className="h-11 bg-[hsl(217,91%,40%)] flex items-center px-2 text-white shrink-0 gap-2">
      {/* Left: Logo + Back */}
      <Link
        href="/"
        className="flex items-center gap-1 text-white/90 hover:text-white text-sm shrink-0 mr-1"
      >
        <ChevronLeft className="size-4" />
        <span className="hidden sm:inline">Quản lý</span>
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
          title="Thêm hóa đơn mới"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {/* Right: Sale Mode + Clock + Avatar */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Sale mode toggle */}
        <div className="flex items-center bg-white/10 rounded-lg h-8 overflow-hidden">
          {SALE_MODES.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.key}
                onClick={() => onSetSaleMode(mode.key)}
                className={cn(
                  "flex items-center gap-1 px-2 lg:px-2.5 h-full text-xs whitespace-nowrap transition-colors",
                  saleMode === mode.key
                    ? "bg-white/25 text-white font-medium"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                )}
                title={mode.label}
              >
                <Icon className="size-3.5" />
                <span className="hidden lg:inline">{mode.label}</span>
                <span className="lg:hidden">{mode.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Clock */}
        <div className="hidden sm:flex items-center gap-1 text-xs text-white/80 ml-1">
          <Clock className="size-3.5" />
          <span className="font-mono w-[60px]">{currentTime}</span>
        </div>

        {/* User avatar */}
        <div className="size-7 rounded-full bg-white/20 flex items-center justify-center ml-0.5">
          <User className="size-4 text-white/80" />
        </div>
      </div>
    </div>
  );
}
