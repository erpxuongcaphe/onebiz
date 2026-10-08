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

import type { ReactNode } from "react";
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
  orderActions?: ReactNode;
  openOrderCount?: number;
  onOpenOrders?: () => void;
  tabs: FnbTabSnapshot[];
  activeTabId: string;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  createTab: () => void;
  onToggleFloorPlan: () => void;
  onSearch: () => void;
  hideSearch?: boolean;
  shift?: Shift | null;
  onShiftClick?: () => void;
  viewMode?: "menu" | "floorplan";
  /** Sprint A: Mở sidenav drawer (☰ trigger). */
  onMenuClick?: () => void;
  /**
   * Day 21/05/2026 (CEO): Số đơn delivery hôm nay tại branch hiện tại.
   * Hiển thị badge nhỏ trên header để cashier biết workload giao trong ngày.
   */
  deliveryCountToday?: number;
}

export function FnbHeader({
  orderActions,
  openOrderCount = 0,
  onOpenOrders,
  tabs,
  activeTabId,
  switchTab,
  closeTab,
  createTab,
  onToggleFloorPlan,
  onSearch,
  hideSearch = false,
  shift,
  onShiftClick,
  viewMode = "menu",
  onMenuClick,
  deliveryCountToday,
}: FnbHeaderProps) {
  const { isFnb, fnbPath } = useFnbSubdomain();

  return (
    <>
    {/* Responsive Sprint B2 (CEO 25/05/2026): đổi md:flex-nowrap → lg:flex-nowrap.
        iPad landscape (1024px) trước đây bị wrap 2 hàng vì branch chip + search +
        view-toggle quá rộng. Giờ chỉ no-wrap ở lg+ (1024+) cho desktop thật, tablet
        landscape vẫn flex-wrap (chấp nhận 1-2 hàng) nhưng có space breathing room. */}
    <header className="min-h-14 bg-white dark:bg-card text-foreground flex flex-wrap lg:flex-nowrap items-center px-2 sm:px-3 gap-2 py-1 lg:h-14 lg:py-0 shrink-0 border-b border-outline-variant/30">
      {/* ☰ Sidenav trigger */}
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          className="w-11 h-11 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-foreground hover:bg-surface-container transition-colors shrink-0"
          aria-label="Mở menu điều hướng"
          title="Menu điều hướng (☰)"
        >
          <Icon name="menu" size={20} />
        </button>
      )}
      {!onMenuClick && !isFnb && (
        // CEO 04/06/2026: từ POS quay về trang chủ mở tab mới (workflow đa tab).
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-foreground transition-colors shrink-0"
        >
          <Icon name="arrow_back" size={18} />
        </a>
      )}

      {/* Logo OneBiz — chỉ icon 28px, không text vì branch chip đã chiếm space */}
      <a
        href="/"
        target="_blank"
        rel="noopener noreferrer"
        className="hidden sm:flex items-center shrink-0 hover:opacity-80 transition-opacity"
        title="Trang chủ OneBiz (tab mới)"
      >
        <Image
          src="/onebiz-icon.svg"
          alt="OneBiz"
          width={28}
          height={28}
          priority
          className="select-none"
        />
      </a>

      {/* POS FnB: CHỈ chọn quán (store). Light variant cho header trắng. */}
      <div className="order-1 min-w-0 flex-1 md:order-none md:flex-none">
        <PosBranchSelector
          variant="light"
          filter={["store"]}
          showCode
          className="min-h-11 w-full justify-start md:max-w-[240px] md:w-auto"
        />
      </div>

      {onShiftClick && (
        <div className="order-2 shrink-0 md:order-none">
          <ShiftIndicator shift={shift ?? null} onClick={onShiftClick} />
        </div>
      )}

      <div className="order-10 basis-full md:hidden" aria-hidden />

      {/* View mode toggle: Sprint UI-3 — wording chuẩn "Bán hàng / Sơ đồ bàn" */}
      <div aria-label="Chế độ POS" className="order-20 flex min-w-0 flex-1 items-center rounded-md border border-primary/25 bg-primary/5 p-0.5 shrink-0 md:order-none md:min-w-0 md:basis-auto md:flex-none">
        <button
          type="button"
          onClick={() => viewMode !== "menu" && onToggleFloorPlan()}
          aria-pressed={viewMode === "menu"}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 min-h-11 px-3 text-sm font-bold rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:flex-none",
            viewMode === "menu"
              ? "bg-primary text-primary-foreground"
              : "text-primary hover:bg-primary/10",
          )}
          title="Xem thực đơn để bán hàng"
        >
          <Icon name="restaurant" size={18} />
          <span>Bán hàng</span>
        </button>
        <button
          type="button"
          onClick={() => viewMode !== "floorplan" && onToggleFloorPlan()}
          aria-pressed={viewMode === "floorplan"}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 min-h-11 px-3 text-sm font-bold rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:flex-none",
            viewMode === "floorplan"
              ? "bg-primary text-primary-foreground"
              : "text-primary hover:bg-primary/10",
          )}
          title="Xem sơ đồ bàn"
        >
          <Icon name="table_restaurant" size={18} />
          <span>Sơ đồ bàn</span>
        </button>
      </div>

      {/* Search bar — click open F3 modal */}
      {!hideSearch && <button
        type="button"
        onClick={onSearch}
        className="order-21 flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted md:order-none md:flex-1 md:justify-start"
        title="Tìm món (F3)"
      >
        <Icon name="search" size={16} />
        <span>Tìm món</span><kbd className="ml-auto hidden rounded border border-border px-1.5 py-0.5 text-xs md:inline">F3</kbd>
      </button>}

      {/* Day 21/05/2026 (CEO): Badge số đơn delivery hôm nay — cashier biết
          khối lượng giao trong ngày luôn, không cần mở báo cáo. */}
      {typeof deliveryCountToday === "number" && deliveryCountToday > 0 && (
        <div
          className="order-21 hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-status-warning/10 text-status-warning rounded-xl text-xs font-semibold shrink-0"
          title={`${deliveryCountToday} đơn giao hôm nay (đã chốt)`}
        >
          <Icon name="local_shipping" size={14} />
          <span>Hôm nay: {deliveryCountToday} đơn giao</span>
        </div>
      )}

      {/* Filler giữa search và right actions — đẩy KDS/settings sang phải */}
      <div className="hidden md:block flex-1" />

      {/*
        Right: KDS + settings.
        CEO 16/08/2026 (mục D) — đo trên production, khung 1024x768 (tablet
        ngang, thiết bị chính của quán): khối này nằm ở left=978 → right=1080,
        tức TRÀN RA NGOÀI 56px và bị cắt, nút "Màn bếp" bấm không tới. Mốc `lg`
        của Tailwind đúng bằng 1024 nên vừa bật hiện là đã hết chỗ.
        Dời lên `xl` (1280px): tablet ngang và dọc đều vào Màn bếp qua ngăn kéo
        (fnb-sidenav-drawer.tsx:46), không mất đường đi nào.
      */}
      <div className="order-22 hidden items-center gap-1 shrink-0 xl:flex md:order-none">
        <Link href={fnbPath("/pos/fnb/kds")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-on-surface-variant hover:text-foreground hover:bg-surface-container"
          >
            <Icon name="restaurant_menu" size={16} className="mr-1.5" />
            <span className="hidden xl:inline text-xs font-semibold">Màn bếp</span>
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

    {/* Sprint UI-2: Order tabs row riêng dưới header (40px).
        Mockup v3: tabs có space riêng, không chen với toolbar — staff dễ
        scan đơn hiện tại. Color dot xanh/cam/xanh lá theo orderType. */}
    <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border bg-white dark:bg-card px-2 sm:px-3">
      {onOpenOrders && <button type="button" onClick={onOpenOrders} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2.5 text-sm font-semibold text-primary hover:bg-primary/15" aria-label={`Đơn chờ thanh toán (${openOrderCount})`}><Icon name="receipt_long" size={16} /><span>Chờ thanh toán</span><span className="rounded bg-primary px-1.5 text-primary-foreground">{openOrderCount}</span></button>}
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
      {(onOpenOrders ? tabs.filter((tab, index) => tab.id === activeTabId || index >= tabs.length - 2) : tabs).map((tab) => {
        const isActive = tab.id === activeTabId;
        // Color dot theo orderType (đồng bộ với cart pill row)
        const dotColor =
          tab.orderType === "dine_in"
            ? "bg-status-info"
            : tab.orderType === "takeaway"
              ? "bg-status-warning"
              : "bg-status-success";
        return (
          <div
            key={tab.id}
            className={cn(
              "flex min-h-11 items-center gap-1.5 px-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors shrink-0",
              isActive
                ? "bg-surface text-primary ambient-shadow border border-primary/20"
                : "bg-transparent text-on-surface-variant hover:bg-surface-container hover:text-foreground",
            )}
          >
            <button type="button" onClick={() => switchTab(tab.id)} aria-pressed={isActive} className="flex min-h-11 items-center gap-1.5 text-left">
              <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
              <span className="max-w-[104px] truncate sm:max-w-[140px]">{tab.label}</span>
            </button>
            <button
              type="button"
              aria-label={"Đóng đơn " + tab.label}
              onClick={(e) => {
                e.stopPropagation();
                // P1-3D-P2 12/06/2026 + R-6 13/06/2026 audit lần 2:
                // - Tab dine_in ĐÃ gửi bếp → confirm chặt chẽ (bàn vẫn occupied
                //   ở server — đóng tab xong cashier có thể click lại bàn từ
                //   Sơ đồ bàn để re-hydrate tab qua handleTableSelect).
                // - Tab takeaway/delivery đã gửi bếp → confirm bình thường.
                // - Tab có items chưa gửi → confirm.
                const hasItems = (tab.lines?.length ?? 0) > 0;
                const sentToKitchen = !!tab.kitchenOrderId;
                if (sentToKitchen && tab.orderType === "dine_in" && typeof window !== "undefined") {
                  if (!window.confirm(
                    `"${tab.label}" đã gửi bếp. Đóng tab không hủy bill và bàn vẫn đang phục vụ. Anh có thể mở lại trong Chờ thanh toán. Đóng tab?`
                  )) return;
                  closeTab(tab.id);
                  return;
                }
                if ((hasItems || sentToKitchen) && typeof window !== "undefined") {
                  const msg = sentToKitchen
                    ? `"${tab.label}" đã gửi bếp. Đóng tab không hủy bill. Anh có thể mở lại trong Chờ thanh toán. Đóng tab?`
                    : `"${tab.label}" có ${tab.lines.length} món chưa gửi bếp. Đóng tab sẽ mất sạch. Tiếp tục?`;
                  if (!window.confirm(msg)) return;
                }
                closeTab(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  const hasItems = (tab.lines?.length ?? 0) > 0;
                  const sentToKitchen = !!tab.kitchenOrderId;
                  if (sentToKitchen && tab.orderType === "dine_in" && typeof window !== "undefined") {
                    if (!window.confirm(
                      `"${tab.label}" đã gửi bếp. Đóng tab không hủy bill và bàn vẫn đang phục vụ. Anh có thể mở lại trong Chờ thanh toán. Đóng tab?`
                    )) return;
                    closeTab(tab.id);
                    return;
                  }
                  if ((hasItems || sentToKitchen) && typeof window !== "undefined") {
                    const msg = sentToKitchen
                      ? `"${tab.label}" đã gửi bếp. Đóng tab không hủy bill. Anh có thể mở lại trong Chờ thanh toán. Đóng tab?`
                      : `"${tab.label}" có ${tab.lines.length} món chưa gửi bếp. Đóng tab sẽ mất sạch. Tiếp tục?`;
                    if (!window.confirm(msg)) return;
                  }
                  closeTab(tab.id);
                }
              }}
              className={cn(
                "ml-0.5 flex h-11 w-11 items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "text-primary hover:bg-primary/15"
                  : "text-on-surface-variant hover:bg-surface-container-highest",
              )}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}

    </div>
      {/* Keep the new-order action outside the horizontally scrolling tabs. */}
      <button
        type="button"
        onClick={createTab}
        className="flex items-center justify-center gap-1 min-h-11 px-3 rounded-lg bg-primary-fixed text-primary hover:bg-primary hover:text-on-primary transition-colors shrink-0 text-xs font-bold"
        title="Thêm đơn mới"
      >
        <Icon name="add" size={14} />
        <span className="sm:hidden">Mới</span>
        <span className="hidden sm:inline">Đơn mới</span>
      </button>

      {/* Empty state khi không có tab */}
      {tabs.length === 0 && (
        <span className="text-xs text-on-surface-variant px-2">
          Chưa có đơn — bấm “Đơn mới” để bắt đầu
        </span>
      )}
    {orderActions}
    </div>
    </>
  );
}
