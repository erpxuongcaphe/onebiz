"use client";

/**
 * KDS (Kitchen Display System) — Full-screen order board for bar/kitchen.
 *
 * Polls kitchen_orders every 5s, displays cards grouped by status.
 * Bar staff taps items to cycle status (pending→preparing→ready),
 * taps "Xong" to mark order as served.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth, useToast } from "@/lib/contexts";
import { PosBranchSelector } from "@/components/shared/pos-branch-selector";
import {
  getKitchenOrders,
  getKitchenOrderById,
  updateKitchenOrderStatus,
  updateKitchenItemStatus,
} from "@/lib/services/supabase/kitchen-orders";
import { getClient } from "@/lib/services/supabase/base";
import { hapticTap, hapticSuccess } from "@/lib/offline";
import type {
  KitchenOrder,
  KitchenOrderItem,
  KitchenOrderStatus,
  KitchenItemStatus,
} from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";

// ── Constants ──

// Fallback polling if Realtime subscription fails
const POLL_INTERVAL = 30_000;
const ACTIVE_STATUSES: KitchenOrderStatus[] = ["pending", "preparing", "ready", "served"];

type FilterTab = "all" | "pending" | "preparing" | "ready";
const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "pending", label: "Chờ" },
  { key: "preparing", label: "Đang pha" },
  { key: "ready", label: "Sẵn sàng" },
];

// ── Timer color ──

function getTimerColor(createdAt: string): string {
  const min = (Date.now() - new Date(createdAt).getTime()) / 60_000;
  if (min < 5) return "text-green-600";
  if (min < 10) return "text-yellow-600";
  return "text-red-600";
}

function formatElapsed(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (m < 1) return `${s}s`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Sound helper ──

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Web Audio not available
  }
}

// ── Types for enriched orders ──

interface KdsOrder extends KitchenOrder {
  items: KitchenOrderItem[];
}

// ── Page ──

export default function KdsPage() {
  const { currentBranch } = useAuth();
  const { toast } = useToast();
  const branchId = currentBranch?.id;

  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [soundOn, setSoundOn] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  // Track lỗi liên tiếp để chỉ hiện toast 1 lần, không spam mỗi 30s khi Supabase
  // sập hoặc quán mất mạng.
  const fetchErrorShownRef = useRef(false);

  // ── Poll orders ──
  const fetchOrders = useCallback(async () => {
    if (!branchId) return;
    try {
      const list = await getKitchenOrders(branchId, ACTIVE_STATUSES);
      // Fetch items for each order
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

      // Detect new orders for sound notification
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
      // Reset cờ khi fetch thành công để lần fail tiếp theo lại toast.
      fetchErrorShownRef.current = false;
    } catch (err) {
      console.error("KDS fetchOrders error:", err);
      // Chỉ toast 1 lần để tránh spam khi polling 30s gặp outage kéo dài.
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
    // Fallback polling (reduced to 30s since Realtime handles updates)
    const interval = setInterval(fetchOrders, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // ── Supabase Realtime subscription (replaces aggressive polling) ──
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
          // Any kitchen_orders change → refetch
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
          // Any kitchen_order_items change → refetch
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

  // Timer tick every second
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Item status toggle ──
  const handleItemToggle = useCallback(
    async (item: KitchenOrderItem) => {
      const nextStatus: Record<KitchenItemStatus, KitchenItemStatus> = {
        pending: "preparing",
        preparing: "ready",
        ready: "ready", // no further toggle
      };
      const next = nextStatus[item.status];
      if (next === item.status) return;

      hapticTap();
      await updateKitchenItemStatus(item.id, next);

      // Optimistic update
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

  // ── Filtered orders ──
  const filtered = orders.filter((o) => {
    if (filter === "all") return o.status !== "served";
    return o.status === filter;
  });

  // ── Render ──

  // CEO chưa chọn chi nhánh → hiện header + prompt chọn branch
  if (!branchId) {
    return (
      <div className="flex flex-col h-screen bg-gray-900 text-white">
        <header className="h-12 bg-gray-800 flex items-center px-4 gap-3 shrink-0">
          <Link href="/pos/fnb" className="text-gray-400 hover:text-white text-sm flex items-center gap-1">
            <Icon name="arrow_back" size={16} />
            POS
          </Link>
          <PosBranchSelector variant="dark" />
          <div className="flex-1" />
          <Icon name="restaurant_menu" className="text-gray-400" />
          <span className="text-sm font-medium text-gray-300">Màn hình bếp</span>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Icon name="restaurant_menu" size={48} className="text-gray-600" />
          <p className="text-lg font-medium text-gray-400">
            Chọn chi nhánh trên thanh header để xem đơn bếp
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <Icon name="progress_activity" size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* ── Header ── */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 shrink-0 gap-2 sm:gap-0">
        <div className="flex items-center gap-3">
          <Link href="/pos/fnb" className="text-gray-400 hover:text-white transition-colors p-1">
            <Icon name="arrow_back" />
          </Link>
          <h1 className="text-base font-bold tracking-wide">Bar — KDS</h1>
          <Badge variant="outline" className="text-gray-400 border-gray-600 text-xs">
            {filtered.length} đơn
          </Badge>
          <span
            className={cn(
              "flex items-center gap-1 text-xs px-2 py-0.5 rounded",
              realtimeConnected ? "text-green-400" : "text-gray-500"
            )}
            title={realtimeConnected ? "Realtime đang hoạt động" : "Chế độ polling fallback"}
          >
            {realtimeConnected ? (
              <Icon name="wifi" size={12} />
            ) : (
              <Icon name="wifi_off" size={12} />
            )}
            {realtimeConnected ? "Live" : "Polling"}
          </span>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Filter tabs */}
          <div className="flex flex-1 sm:flex-initial bg-gray-700 rounded-md p-0.5">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={cn(
                  "flex-1 sm:flex-initial px-3 py-2 sm:py-1 text-sm sm:text-xs rounded-sm transition-colors",
                  filter === tab.key
                    ? "bg-gray-500 text-white"
                    : "text-gray-400 hover:text-gray-200 active:bg-gray-600"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sound toggle */}
          <button
            onClick={() => setSoundOn(!soundOn)}
            className="p-2 sm:p-1.5 rounded hover:bg-gray-700 active:bg-gray-600 transition-colors"
            title={soundOn ? "Tắt âm" : "Bật âm"}
          >
            {soundOn ? (
              <Icon name="volume_up" className="sm:h-4 sm:w-4 text-green-400" />
            ) : (
              <Icon name="volume_off" className="sm:h-4 sm:w-4 text-gray-500" />
            )}
          </button>
        </div>
      </header>

      {/* ── Order cards grid ── */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-lg">Không có đơn nào</p>
            <p className="text-sm mt-1">Đơn mới sẽ tự động hiện trong vài giây</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {filtered.map((order) => (
              <KdsOrderCard
                key={order.id}
                order={order}
                now={now}
                onItemToggle={handleItemToggle}
                onServed={() => handleServed(order.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Order card ──

function KdsOrderCard({
  order,
  now,
  onItemToggle,
  onServed,
}: {
  order: KdsOrder;
  now: number;
  onItemToggle: (item: KitchenOrderItem) => void;
  onServed: () => void;
}) {
  const allReady =
    order.items.length > 0 && order.items.every((i) => i.status === "ready");
  const timerColor = getTimerColor(order.createdAt);

  const ORDER_TYPE_LABEL: Record<string, string> = {
    dine_in: order.tableName ?? "Tại quán",
    takeaway: "Mang về",
    delivery: "Giao",
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border overflow-hidden",
        allReady
          ? "border-green-500 bg-green-950/30"
          : order.status === "served"
            ? "border-gray-600 bg-gray-800/50 opacity-60"
            : "border-gray-700 bg-gray-800"
      )}
    >
      {/* ── Card header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">
            {order.orderNumber}
          </span>
          <span className="text-xs text-gray-400">
            {ORDER_TYPE_LABEL[order.orderType] ?? order.orderType}
          </span>
        </div>
        <span className={cn("text-xs font-mono font-semibold", timerColor)}>
          {formatElapsed(order.createdAt)}
        </span>
      </div>

      {/* ── Items ── */}
      <div className="flex-1 px-3 py-2 space-y-1.5">
        {order.items.map((item) => (
          <KdsItemRow key={item.id} item={item} onToggle={() => onItemToggle(item)} />
        ))}
      </div>

      {/* ── Actions ── */}
      <div className="px-3 py-2 border-t border-gray-700">
        {order.status === "served" ? (
          <span className="text-xs text-gray-500">Đã phục vụ</span>
        ) : (
          <Button
            size="sm"
            onClick={onServed}
            disabled={!allReady}
            className={cn(
              "w-full text-xs font-semibold",
              allReady
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-gray-700 text-gray-400 cursor-not-allowed"
            )}
          >
            {allReady ? "Xong" : "Chờ hoàn tất"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Item row ──

const ITEM_STATUS_ICON: Record<KitchenItemStatus, { symbol: string; color: string }> = {
  pending: { symbol: "○", color: "text-gray-400" },
  preparing: { symbol: "◔", color: "text-yellow-400" },
  ready: { symbol: "●", color: "text-green-400" },
};

function KdsItemRow({
  item,
  onToggle,
}: {
  item: KitchenOrderItem;
  onToggle: () => void;
}) {
  const cfg = ITEM_STATUS_ICON[item.status];

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={item.status === "ready"}
      className={cn(
        "flex items-start gap-2 w-full text-left rounded px-1.5 py-1 transition-colors",
        item.status === "ready"
          ? "opacity-60 cursor-default"
          : "hover:bg-gray-700/50 cursor-pointer"
      )}
    >
      <span className={cn("text-sm mt-0.5 shrink-0", cfg.color)}>{cfg.symbol}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1">
          <span
            className={cn(
              "text-sm font-medium",
              item.status === "ready" ? "line-through text-gray-500" : "text-gray-200"
            )}
          >
            {item.quantity > 1 && (
              <span className="text-xs text-gray-400 mr-1">x{item.quantity}</span>
            )}
            {item.productName}
          </span>
          {item.variantLabel && (
            <span className="text-[10px] text-gray-500">({item.variantLabel})</span>
          )}
        </div>
        {/* Toppings */}
        {item.toppings.length > 0 && (
          <div className="text-[10px] text-gray-500 mt-0.5">
            {item.toppings.map((t, i) => (
              <span key={i}>
                {i > 0 && ", "}+{t.name}
              </span>
            ))}
          </div>
        )}
        {/* Note */}
        {item.note && (
          <p className="text-[10px] text-orange-400 italic mt-0.5">{item.note}</p>
        )}
      </div>
    </button>
  );
}
