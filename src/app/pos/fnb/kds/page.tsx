"use client";

/**
 * KDS (Kitchen Display System) — Full-screen order board for bar/kitchen.
 *
 * Polls kitchen_orders every 5s, displays cards grouped by status.
 * Bar staff taps items to cycle status (pending→preparing→ready),
 * taps "Xong" to mark order as served.
 *
 * Stitch dark mode styling (per mockup m_n_h_nh_b_p_kds_fnb_dark_mode_chuy_n_d_ng):
 * - Main bg: bg-pos-chrome-bg-elevated (inverse-surface tương đương MD3)
 * - Cards: bg-pos-chrome-bg rounded-xl với colored header theo status
 * - Timer: font-heading black 4xl, color theo threshold
 * - Item checkbox: w-6 h-6 rounded border-2 toggle
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth, useToast } from "@/lib/contexts";
import { useSettings } from "@/lib/contexts/settings-context";
import { PosBranchSelector } from "@/components/shared/pos-branch-selector";
import { PermissionPage } from "@/components/shared/permission-page";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getKitchenOrders,
  getKitchenOrderById,
  updateKitchenOrderStatus,
  updateKitchenItemStatus,
} from "@/lib/services/supabase/kitchen-orders";
import { getClient } from "@/lib/services/supabase/base";
import { hapticTap, hapticSuccess } from "@/lib/offline";
import { printKitchenTicketV2 } from "@/lib/print-fnb";
import type {
  KitchenOrder,
  KitchenOrderItem,
  KitchenOrderStatus,
  KitchenItemStatus,
} from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";

// ── Constants ──

const POLL_INTERVAL = 30_000;
const ACTIVE_STATUSES: KitchenOrderStatus[] = ["pending", "preparing", "ready", "served"];

type FilterTab = "all" | "pending" | "preparing" | "ready";
const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "pending", label: "Chờ" },
  { key: "preparing", label: "Đang pha" },
  { key: "ready", label: "Sẵn sàng" },
];

// ── Timer helpers ──

/** Elapsed minutes since createdAt. */
function getElapsedMinutes(createdAt: string): number {
  return (Date.now() - new Date(createdAt).getTime()) / 60_000;
}

/** Stitch urgency level: fresh (<5m), attention (5-10m), overdue (>10m) */
type Urgency = "fresh" | "attention" | "overdue";
function getUrgency(createdAt: string): Urgency {
  const m = getElapsedMinutes(createdAt);
  if (m < 5) return "fresh";
  if (m < 10) return "attention";
  return "overdue";
}

function formatElapsed(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Sound helper ──

function playBeep(freq = 880, duration = 0.15, gain = 0.3) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g);
    g.connect(ctx.destination);
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Web Audio not available
  }
}

/** Double-beep cảnh báo đơn quá hạn (>10 phút). Freq cao hơn để phân biệt với beep đơn mới. */
function playOverdueBeep() {
  playBeep(1320, 0.22, 0.35);
  setTimeout(() => playBeep(1320, 0.22, 0.35), 260);
}

// ── Types ──

interface KdsOrder extends KitchenOrder {
  items: KitchenOrderItem[];
}

// ── Page ──

function KdsPageInner() {
  const { currentBranch, user } = useAuth();
  const { toast } = useToast();
  const { settings } = useSettings();
  const branchId = currentBranch?.id;

  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [soundOn, setSoundOn] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const overdueAlertedRef = useRef<Set<string>>(new Set());
  const fetchErrorShownRef = useRef(false);

  // Clock
  const [wallClock, setWallClock] = useState<string>(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  // ── Poll orders ──
  const fetchOrders = useCallback(async () => {
    if (!branchId) return;
    try {
      const list = await getKitchenOrders(branchId, ACTIVE_STATUSES);
      const enriched = await Promise.all(
        list.map(async (o) => {
          try {
            const detail = await getKitchenOrderById(o.id);
            return { ...o, items: detail.items } as KdsOrder;
          } catch {
            return { ...o, items: [] } as KdsOrder;
          }
        })
      );

      const newIds = new Set(enriched.map((o) => o.id));
      if (prevOrderIdsRef.current.size > 0 && soundOn) {
        for (const id of newIds) {
          if (!prevOrderIdsRef.current.has(id)) {
            playBeep();
            break;
          }
        }
      }
      prevOrderIdsRef.current = newIds;

      setOrders(enriched);
      fetchErrorShownRef.current = false;
    } catch (err) {
      console.error("KDS fetchOrders error:", err);
      if (!fetchErrorShownRef.current) {
        fetchErrorShownRef.current = true;
        toast({
          title: "Không tải được đơn bếp",
          description:
            "Danh sách có thể không phải bản mới nhất. Kiểm tra kết nối.",
          variant: "error",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [branchId, soundOn, toast]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // ── Supabase Realtime subscription ──
  useEffect(() => {
    if (!branchId) return;
    const client = getClient();

    const channel = client
      .channel(`kds-${branchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kitchen_orders",
          filter: `branch_id=eq.${branchId}`,
        },
        () => {
          fetchOrders();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kitchen_order_items",
        },
        () => {
          fetchOrders();
        }
      )
      .subscribe((status) => {
        setRealtimeConnected(status === "SUBSCRIBED");
      });

    return () => {
      client.removeChannel(channel);
      setRealtimeConnected(false);
    };
  }, [branchId, fetchOrders]);

  // Timer tick every second + wall clock update
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      const d = new Date();
      setWallClock(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
      );
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Overdue alert: double-beep lần đầu khi đơn crossing >10m ──
  // Theo dõi orderId đã alert để không spam mỗi giây. Chỉ alert đơn đang active
  // (chưa served/cancelled) và chưa sẵn sàng hết (bếp chưa xong).
  useEffect(() => {
    if (!soundOn) return;
    for (const order of orders) {
      if (order.status === "served" || order.status === "cancelled") continue;
      if (order.items.length === 0) continue;
      const allReady = order.items.every((i) => i.status === "ready");
      if (allReady) continue;
      if (getUrgency(order.createdAt) !== "overdue") continue;
      if (overdueAlertedRef.current.has(order.id)) continue;
      overdueAlertedRef.current.add(order.id);
      playOverdueBeep();
    }
    // Garbage-collect: đơn không còn trong active list → bỏ khỏi set
    const activeIds = new Set(orders.map((o) => o.id));
    for (const id of overdueAlertedRef.current) {
      if (!activeIds.has(id)) overdueAlertedRef.current.delete(id);
    }
  }, [orders, soundOn, now]);

  // ── Item status toggle ──
  const handleItemToggle = useCallback(
    async (item: KitchenOrderItem) => {
      const nextStatus: Record<KitchenItemStatus, KitchenItemStatus> = {
        pending: "preparing",
        preparing: "ready",
        ready: "ready",
      };
      const next = nextStatus[item.status];
      if (next === item.status) return;

      hapticTap();
      await updateKitchenItemStatus(item.id, next);

      setOrders((prev) =>
        prev.map((o) =>
          o.id === item.kitchenOrderId
            ? {
                ...o,
                items: o.items.map((i) =>
                  i.id === item.id ? { ...i, status: next } : i
                ),
              }
            : o
        )
      );
    },
    []
  );

  // ── Mark order served ──
  const handleServed = useCallback(async (orderId: string) => {
    hapticSuccess();
    await updateKitchenOrderStatus(orderId, "served");
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, status: "served" as KitchenOrderStatus } : o
      )
    );
  }, []);

  // ── Mark all items in an order as ready (bulk action) ──
  const handleMarkAllReady = useCallback(
    async (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;

      const toMark = order.items.filter((i) => i.status !== "ready");
      if (toMark.length === 0) return;

      hapticTap();

      // Optimistic UI: update locally first
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                items: o.items.map((i) =>
                  i.status !== "ready" ? { ...i, status: "ready" as KitchenItemStatus } : i
                ),
              }
            : o
        )
      );

      try {
        // Run in parallel for speed
        await Promise.all(
          toMark.map((i) => updateKitchenItemStatus(i.id, "ready"))
        );
        hapticSuccess();
      } catch (err) {
        // Rollback + toast
        fetchOrders();
        toast({
          title: "Không đánh dấu được",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
      }
    },
    [orders, fetchOrders, toast]
  );

  // ── Recall item: ready → preparing (lỡ tay đánh dấu xong) ──
  const handleItemRecall = useCallback(async (item: KitchenOrderItem) => {
    if (item.status !== "ready") return;
    hapticTap();
    try {
      await updateKitchenItemStatus(item.id, "preparing");
      setOrders((prev) =>
        prev.map((o) =>
          o.id === item.kitchenOrderId
            ? {
                ...o,
                items: o.items.map((i) =>
                  i.id === item.id ? { ...i, status: "preparing" as KitchenItemStatus } : i
                ),
              }
            : o
        )
      );
    } catch (err) {
      toast({
        title: "Không hoàn tác được",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    }
  }, [toast]);

  // ── Print kitchen ticket again (reprint) ──
  const handlePrintTicket = useCallback(
    (order: KdsOrder) => {
      try {
        printKitchenTicketV2({
          orderNumber: order.orderNumber,
          tableName: order.tableName ?? undefined,
          orderType: order.orderType,
          items: order.items.map((it) => ({
            name: it.productName,
            variant: it.variantLabel ?? undefined,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            toppings: (it.toppings ?? []).map((t) => ({
              name: t.name,
              quantity: t.quantity,
              price: t.price,
            })),
            note: it.note ?? undefined,
          })),
          createdAt: order.createdAt,
          cashierName: user?.fullName,
          style: settings.print.kitchenTicketStyle,
          paperSize: settings.print.paperSize === "58mm" ? "58mm" : "80mm",
        });
      } catch (err) {
        toast({
          title: "Không in được phiếu bếp",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
      }
    },
    [user?.fullName, settings.print, toast]
  );

  // ── Filtered orders ──
  const filtered = orders.filter((o) => {
    if (filter === "all") return o.status !== "served";
    return o.status === filter;
  });

  // ── Render ──

  // CEO chưa chọn chi nhánh
  if (!branchId) {
    return (
      <div className="flex flex-col h-screen bg-pos-chrome-bg-elevated text-pos-chrome-fg">
        <header className="h-16 bg-pos-chrome-bg/70 backdrop-blur flex items-center px-6 gap-3 shrink-0 border-b border-pos-chrome-border/50">
          <Link
            href="/pos/fnb"
            className="text-pos-chrome-fg-dim hover:text-pos-chrome-fg text-sm flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-pos-chrome-bg-elevated transition-colors"
          >
            <Icon name="arrow_back" size={16} />
            POS
          </Link>
          <PosBranchSelector variant="dark" filter={["store"]} showCode />
          <div className="flex-1" />
          <Icon name="soup_kitchen" size={20} className="text-pos-chrome-fg-dim" />
          <span className="font-heading text-base font-bold text-pos-chrome-fg">
            KDS Bếp
          </span>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="size-20 rounded-2xl bg-pos-chrome-bg-hover flex items-center justify-center">
            <Icon name="soup_kitchen" size={40} className="text-pos-chrome-fg-dim" />
          </div>
          <p className="font-heading text-lg font-semibold text-pos-chrome-fg-muted">
            Chọn chi nhánh trên thanh header để xem đơn bếp
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-pos-chrome-bg-elevated">
        <div className="flex flex-col items-center gap-3">
          <Icon
            name="progress_activity"
            size={36}
            className="animate-spin text-status-info"
          />
          <p className="text-sm text-pos-chrome-fg-dim">Đang tải đơn bếp…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-pos-chrome-bg-elevated text-pos-chrome-fg overflow-hidden">
      {/* ── Stitch Top Bar ── */}
      <header className="h-16 md:h-20 px-4 md:px-8 flex items-center justify-between bg-pos-chrome-bg/60 backdrop-blur-md border-b border-pos-chrome-border/50 shrink-0 gap-3">
        {/* Left: title + status */}
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/pos/fnb"
            className="shrink-0 text-pos-chrome-fg-dim hover:text-pos-chrome-fg rounded-lg p-2 hover:bg-pos-chrome-bg-elevated transition-colors"
            title="Quay về POS"
          >
            <Icon name="arrow_back" size={18} />
          </Link>
          <div className="flex flex-col min-w-0">
            <h1 className="font-heading text-lg md:text-xl font-bold tracking-tight text-pos-chrome-fg truncate leading-tight">
              KDS Bếp Chính
            </h1>
            <span className="flex items-center gap-1.5 text-xs text-pos-chrome-fg-dim">
              <span
                className={cn(
                  "size-2 rounded-full",
                  realtimeConnected ? "bg-status-success animate-pulse" : "bg-pos-chrome-fg-dim"
                )}
              />
              {realtimeConnected ? "Live" : "Polling"} · {filtered.length} đơn
            </span>
          </div>
          <div className="hidden lg:block">
            <PosBranchSelector variant="dark" filter={["store"]} showCode />
          </div>
        </div>

        {/* Center: filter pills — Stitch style */}
        <div className="hidden sm:flex items-center gap-1 bg-pos-chrome-bg/60 p-1 rounded-xl border border-pos-chrome-border/40">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                "px-4 md:px-5 py-1.5 md:py-2 rounded-lg font-semibold text-xs md:text-sm transition-all press-scale-sm",
                filter === tab.key
                  ? "bg-status-info text-white shadow-md shadow-pos-chrome-bg/30"
                  : "text-pos-chrome-fg-dim hover:bg-pos-chrome-bg-elevated hover:text-pos-chrome-fg"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right: time + sound */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="font-heading font-bold text-xl md:text-2xl tabular-nums tracking-tight text-pos-chrome-fg">
            {wallClock}
          </div>
          <button
            onClick={() => setSoundOn(!soundOn)}
            className={cn(
              "size-9 rounded-lg flex items-center justify-center transition-colors press-scale-sm",
              soundOn
                ? "bg-status-info/20 text-status-info hover:bg-status-info/30"
                : "bg-pos-chrome-bg-elevated text-pos-chrome-fg0 hover:bg-pos-chrome-bg-hover"
            )}
            title={soundOn ? "Tắt âm" : "Bật âm"}
          >
            <Icon name={soundOn ? "volume_up" : "volume_off"} size={18} />
          </button>
        </div>
      </header>

      {/* Filter pills — mobile row (outside header) */}
      <div className="flex sm:hidden items-center gap-1 bg-pos-chrome-bg/60 mx-3 mt-3 p-1 rounded-xl overflow-x-auto no-scrollbar border border-pos-chrome-border/40 shrink-0">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "shrink-0 px-4 py-2 rounded-lg font-semibold text-xs transition-all press-scale-sm",
              filter === tab.key
                ? "bg-status-info text-white shadow"
                : "text-pos-chrome-fg-dim hover:bg-pos-chrome-bg-elevated hover:text-pos-chrome-fg"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── KDS Board ── */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="size-20 rounded-2xl bg-pos-chrome-bg-hover flex items-center justify-center">
              <Icon name="check_circle" size={40} className="text-status-success" />
            </div>
            <p className="font-heading text-lg font-bold text-pos-chrome-fg-muted">
              Bếp đang thong thả
            </p>
            <p className="text-sm text-pos-chrome-fg0 max-w-xs text-center">
              Đơn mới sẽ tự động hiện trong vài giây. Âm thanh {soundOn ? "đang bật" : "đang tắt"}.
            </p>
          </div>
        ) : (
          <div className="h-full flex gap-4 md:gap-5 items-start overflow-x-auto no-scrollbar pb-3">
            {filtered.map((order) => (
              <KdsOrderCard
                key={order.id}
                order={order}
                now={now}
                onItemToggle={handleItemToggle}
                onItemRecall={handleItemRecall}
                onPrintTicket={() => handlePrintTicket(order)}
                onServed={() => handleServed(order.id)}
                onMarkAllReady={() => handleMarkAllReady(order.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// KDS Order Card — Stitch dark mode
// ══════════════════════════════════════════════════════════════════

function KdsOrderCard({
  order,
  now: _now,
  onItemToggle,
  onItemRecall,
  onPrintTicket,
  onServed,
  onMarkAllReady,
}: {
  order: KdsOrder;
  now: number;
  onItemToggle: (item: KitchenOrderItem) => void;
  onItemRecall: (item: KitchenOrderItem) => void;
  onPrintTicket: () => void;
  onServed: () => void;
  onMarkAllReady: () => void;
}) {
  const allReady =
    order.items.length > 0 && order.items.every((i) => i.status === "ready");
  const pendingCount = order.items.filter((i) => i.status !== "ready").length;
  const urgency = getUrgency(order.createdAt);

  // Order type label
  const typeLabel =
    order.orderType === "dine_in"
      ? order.tableName ?? "Bàn"
      : order.orderType === "takeaway"
        ? "Mang về"
        : "Giao";
  const typeLabelCaption =
    order.orderType === "dine_in" ? "BÀN" : order.orderType === "takeaway" ? "TAKEAWAY" : "DELIVERY";

  // Header color theme based on urgency
  const headerClass =
    urgency === "overdue"
      ? "bg-status-error/80 border-b border-status-error/40"
      : urgency === "attention"
        ? "bg-status-warning/60 border-b border-status-warning/30"
        : "bg-status-info";

  const headerTextClass =
    urgency === "overdue"
      ? "text-status-error"
      : urgency === "attention"
        ? "text-status-warning"
        : "text-status-info";

  const timerTextClass =
    urgency === "overdue"
      ? "text-status-error animate-pulse"
      : urgency === "attention"
        ? "text-status-warning"
        : "text-status-info";

  return (
    <div
      className={cn(
        "w-[300px] md:w-[320px] shrink-0 bg-pos-chrome-bg rounded-xl overflow-hidden flex flex-col relative ambient-shadow-lg",
        "border border-pos-chrome-border/40",
        order.status === "served" && "opacity-50"
      )}
    >
      {/* Overdue pulse bar */}
      {urgency === "overdue" && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-status-error animate-pulse" />
      )}

      {/* ── Card Header — large table # ── */}
      <div className={cn("p-4 flex justify-between items-start shrink-0", headerClass)}>
        <div className="min-w-0">
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-[0.15em] block mb-1 opacity-90",
              headerTextClass
            )}
          >
            {typeLabelCaption}
          </span>
          <span
            className={cn(
              "font-heading font-extrabold text-3xl md:text-4xl leading-none truncate block",
              headerTextClass
            )}
          >
            {typeLabel}
          </span>
          <span className={cn("text-[11px] font-semibold mt-1 block opacity-80", headerTextClass)}>
            #{order.orderNumber}
          </span>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrintTicket();
            }}
            className={cn(
              "size-7 rounded-md flex items-center justify-center transition-colors",
              "bg-black/10 hover:bg-black/20",
              headerTextClass
            )}
            title="In lại phiếu bếp"
            aria-label="In lại phiếu bếp"
          >
            <Icon name="print" size={14} />
          </button>
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider block opacity-80",
              headerTextClass
            )}
          >
            Time
          </span>
          <span
            className={cn(
              "font-heading font-bold text-xl md:text-2xl tabular-nums",
              timerTextClass
            )}
          >
            {formatElapsed(order.createdAt)}
          </span>
        </div>
      </div>

      {/* ── Items list ── */}
      <div className="p-2 flex flex-col gap-1.5 bg-pos-chrome-bg flex-1 min-h-0 overflow-y-auto">
        {order.items.map((item) => (
          <KdsItemRow
            key={item.id}
            item={item}
            onToggle={() => onItemToggle(item)}
            onRecall={() => onItemRecall(item)}
          />
        ))}
      </div>

      {/* ── Action buttons ── */}
      <div className="p-3 shrink-0 border-t border-pos-chrome-border/40 bg-pos-chrome-bg space-y-2">
        {/* Bulk "Sẵn sàng hết" — only when there are still pending items */}
        {order.status !== "served" && pendingCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllReady}
            className={cn(
              "w-full py-2.5 rounded-lg font-semibold text-xs transition-all press-scale-sm flex items-center justify-center gap-1.5",
              "bg-pos-chrome-bg-elevated text-status-info hover:bg-pos-chrome-bg-hover border border-status-info/40"
            )}
            title={`Đánh dấu sẵn sàng ${pendingCount} món còn lại`}
          >
            <Icon name="done_all" size={14} />
            Sẵn sàng hết ({pendingCount})
          </button>
        )}

        {order.status === "served" ? (
          <div className="w-full py-3 rounded-lg bg-pos-chrome-bg-elevated text-pos-chrome-fg0 font-semibold text-sm text-center flex items-center justify-center gap-1.5">
            <Icon name="check_circle" size={16} />
            Đã phục vụ
          </div>
        ) : (
          <button
            type="button"
            onClick={onServed}
            disabled={!allReady}
            className={cn(
              "w-full py-3 rounded-lg font-bold text-sm transition-all press-scale-sm flex items-center justify-center gap-2",
              allReady
                ? "bg-status-success text-white hover:bg-status-success/90 ambient-shadow"
                : urgency === "overdue"
                  ? "bg-status-error/80 text-white hover:bg-status-error ambient-shadow"
                  : "bg-pos-chrome-bg-elevated text-pos-chrome-fg-dim cursor-not-allowed opacity-70"
            )}
          >
            <Icon
              name={allReady ? "check_circle" : urgency === "overdue" ? "bolt" : "pending"}
              size={16}
            />
            {allReady ? "Xong" : urgency === "overdue" ? "Đẩy nhanh" : "Chờ hoàn tất"}
          </button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// KDS Item Row — Stitch checkbox style
// ══════════════════════════════════════════════════════════════════

function KdsItemRow({
  item,
  onToggle,
  onRecall,
}: {
  item: KitchenOrderItem;
  onToggle: () => void;
  onRecall: () => void;
}) {
  const isReady = item.status === "ready";
  const isPreparing = item.status === "preparing";

  // Khi item ready → dùng <div> + recall button riêng (không dùng <button> lớn
  // để tránh nested button + cho phép người dùng hoàn tác khi lỡ tick).
  if (isReady) {
    return (
      <div
        className={cn(
          "flex items-start gap-3 w-full text-left rounded-lg p-3",
          "bg-pos-chrome-bg-elevated/40"
        )}
      >
        <div
          className={cn(
            "size-6 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all",
            "bg-status-success border-status-success"
          )}
        >
          <Icon name="check" size={14} className="text-white font-bold" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5">
            <span
              className={cn(
                "font-heading font-bold text-sm md:text-base leading-tight",
                "line-through text-pos-chrome-fg0"
              )}
            >
              {item.productName}
            </span>
          </div>
          {item.variantLabel && (
            <span className="text-xs text-pos-chrome-fg-dim block mt-0.5 line-through">
              {item.variantLabel}
            </span>
          )}
          {item.toppings.length > 0 && (
            <div className="text-xs text-pos-chrome-fg-dim mt-0.5 line-through">
              {item.toppings.map((t, i) => (
                <span key={i}>
                  {i > 0 && ", "}+{t.name}
                </span>
              ))}
            </div>
          )}
          {item.quantity > 1 && (
            <span className="inline-flex items-center gap-0.5 mt-1.5 px-2 py-0.5 rounded-full bg-status-success/20 text-status-success text-[10px] font-bold">
              x{item.quantity}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onRecall}
          className={cn(
            "shrink-0 size-7 rounded-md flex items-center justify-center transition-colors press-scale-sm",
            "bg-pos-chrome-bg text-pos-chrome-fg-dim hover:text-status-warning hover:bg-status-warning/10"
          )}
          title="Hoàn tác — đánh dấu lại đang pha"
          aria-label="Hoàn tác món"
        >
          <Icon name="undo" size={14} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-start gap-3 w-full text-left rounded-lg p-3 transition-colors press-scale-sm",
        "bg-pos-chrome-bg-elevated hover:bg-pos-chrome-bg-hover cursor-pointer"
      )}
    >
      {/* Checkbox — Stitch style */}
      <div
        className={cn(
          "size-6 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all",
          isPreparing
            ? "bg-status-warning/20 border-status-warning"
            : "border-pos-chrome-fg-dim"
        )}
      >
        {isPreparing && (
          <div className="size-2 rounded-full bg-status-warning animate-pulse" />
        )}
      </div>

      {/* Item body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5">
          <span
            className={cn(
              "font-heading font-bold text-sm md:text-base leading-tight",
              "text-pos-chrome-fg"
            )}
          >
            {item.productName}
          </span>
        </div>
        {item.variantLabel && (
          <span className="text-xs text-pos-chrome-fg-dim block mt-0.5">
            {item.variantLabel}
          </span>
        )}
        {/* Toppings */}
        {item.toppings.length > 0 && (
          <div className="text-xs text-pos-chrome-fg-dim mt-0.5">
            {item.toppings.map((t, i) => (
              <span key={i}>
                {i > 0 && ", "}+{t.name}
              </span>
            ))}
          </div>
        )}
        {/* Note */}
        {item.note && (
          <p className="text-xs text-status-warning italic mt-1 flex items-start gap-1">
            <Icon name="sticky_note_2" size={12} className="mt-0.5 shrink-0" />
            {item.note}
          </p>
        )}
        {/* Quantity badge */}
        {item.quantity > 1 && (
          <span className="inline-flex items-center gap-0.5 mt-1.5 px-2 py-0.5 rounded-full bg-status-info/20 text-status-info text-[10px] font-bold">
            x{item.quantity}
          </span>
        )}
      </div>
    </button>
  );
}

export default function KdsPage() {
  // KDS yêu cầu quyền xem đơn bếp (pos_fnb.view_orders). Bếp/bar có quyền
  // này; cashier thường chỉ có send_kitchen, không có view_orders trừ khi
  // admin cấp thêm.
  return (
    <PermissionPage requires={PERMISSIONS.POS_FNB_VIEW_ORDERS}>
      <KdsPageInner />
    </PermissionPage>
  );
}
