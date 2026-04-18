"use client";

/**
 * KDS (Kitchen Display System) — Full-screen order board for bar/kitchen.
 *
 * Polls kitchen_orders every 5s, displays cards grouped by status.
 * Bar staff taps items to cycle status (pending→preparing→ready),
 * taps "Xong" to mark order as served.
 *
 * Stitch dark mode styling (per mockup m_n_h_nh_b_p_kds_fnb_dark_mode_chuy_n_d_ng):
 * - Main bg: slate-800 (inverse-surface tương đương MD3)
 * - Cards: slate-900 rounded-xl với colored header theo status
 * - Timer: font-heading black 4xl, color theo threshold
 * - Item checkbox: w-6 h-6 rounded border-2 toggle
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
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

// ── Types ──

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

  // ── Filtered orders ──
  const filtered = orders.filter((o) => {
    if (filter === "all") return o.status !== "served";
    return o.status === filter;
  });

  // ── Render ──

  // CEO chưa chọn chi nhánh
  if (!branchId) {
    return (
      <div className="flex flex-col h-screen bg-slate-800 text-slate-100">
        <header className="h-16 bg-slate-900/70 backdrop-blur flex items-center px-6 gap-3 shrink-0 border-b border-slate-700/50">
          <Link
            href="/pos/fnb"
            className="text-slate-400 hover:text-slate-100 text-sm flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-slate-800 transition-colors"
          >
            <Icon name="arrow_back" size={16} />
            POS
          </Link>
          <PosBranchSelector variant="dark" />
          <div className="flex-1" />
          <Icon name="soup_kitchen" size={20} className="text-slate-400" />
          <span className="font-heading text-base font-bold text-slate-100">
            KDS Bếp
          </span>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="size-20 rounded-2xl bg-slate-700 flex items-center justify-center">
            <Icon name="soup_kitchen" size={40} className="text-slate-400" />
          </div>
          <p className="font-heading text-lg font-semibold text-slate-300">
            Chọn chi nhánh trên thanh header để xem đơn bếp
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-800">
        <div className="flex flex-col items-center gap-3">
          <Icon
            name="progress_activity"
            size={36}
            className="animate-spin text-blue-400"
          />
          <p className="text-sm text-slate-400">Đang tải đơn bếp…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-800 text-slate-100 overflow-hidden">
      {/* ── Stitch Top Bar ── */}
      <header className="h-16 md:h-20 px-4 md:px-8 flex items-center justify-between bg-slate-900/60 backdrop-blur-md border-b border-slate-700/50 shrink-0 gap-3">
        {/* Left: title + status */}
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/pos/fnb"
            className="shrink-0 text-slate-400 hover:text-slate-100 rounded-lg p-2 hover:bg-slate-800 transition-colors"
            title="Quay về POS"
          >
            <Icon name="arrow_back" size={18} />
          </Link>
          <div className="flex flex-col min-w-0">
            <h1 className="font-heading text-lg md:text-xl font-bold tracking-tight text-slate-50 truncate leading-tight">
              KDS Bếp Chính
            </h1>
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span
                className={cn(
                  "size-2 rounded-full",
                  realtimeConnected ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                )}
              />
              {realtimeConnected ? "Live" : "Polling"} · {filtered.length} đơn
            </span>
          </div>
          <div className="hidden lg:block">
            <PosBranchSelector variant="dark" />
          </div>
        </div>

        {/* Center: filter pills — Stitch style */}
        <div className="hidden sm:flex items-center gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-700/40">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                "px-4 md:px-5 py-1.5 md:py-2 rounded-lg font-semibold text-xs md:text-sm transition-all press-scale-sm",
                filter === tab.key
                  ? "bg-blue-600 text-white shadow-md shadow-blue-900/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right: time + sound */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="font-heading font-bold text-xl md:text-2xl tabular-nums tracking-tight text-slate-50">
            {wallClock}
          </div>
          <button
            onClick={() => setSoundOn(!soundOn)}
            className={cn(
              "size-9 rounded-lg flex items-center justify-center transition-colors press-scale-sm",
              soundOn
                ? "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700"
            )}
            title={soundOn ? "Tắt âm" : "Bật âm"}
          >
            <Icon name={soundOn ? "volume_up" : "volume_off"} size={18} />
          </button>
        </div>
      </header>

      {/* Filter pills — mobile row (outside header) */}
      <div className="flex sm:hidden items-center gap-1 bg-slate-900/60 mx-3 mt-3 p-1 rounded-xl overflow-x-auto no-scrollbar border border-slate-700/40 shrink-0">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "shrink-0 px-4 py-2 rounded-lg font-semibold text-xs transition-all press-scale-sm",
              filter === tab.key
                ? "bg-blue-600 text-white shadow"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
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
            <div className="size-20 rounded-2xl bg-slate-700 flex items-center justify-center">
              <Icon name="check_circle" size={40} className="text-emerald-400" />
            </div>
            <p className="font-heading text-lg font-bold text-slate-300">
              Bếp đang thong thả
            </p>
            <p className="text-sm text-slate-500 max-w-xs text-center">
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
                onServed={() => handleServed(order.id)}
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
  onServed,
}: {
  order: KdsOrder;
  now: number;
  onItemToggle: (item: KitchenOrderItem) => void;
  onServed: () => void;
}) {
  const allReady =
    order.items.length > 0 && order.items.every((i) => i.status === "ready");
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
      ? "bg-red-950/80 border-b border-red-600/40"
      : urgency === "attention"
        ? "bg-amber-950/60 border-b border-amber-600/30"
        : "bg-blue-600";

  const headerTextClass =
    urgency === "overdue"
      ? "text-red-100"
      : urgency === "attention"
        ? "text-amber-100"
        : "text-blue-50";

  const timerTextClass =
    urgency === "overdue"
      ? "text-red-300 animate-pulse"
      : urgency === "attention"
        ? "text-amber-200"
        : "text-blue-100";

  return (
    <div
      className={cn(
        "w-[300px] md:w-[320px] shrink-0 bg-slate-900 rounded-xl overflow-hidden flex flex-col relative ambient-shadow-lg",
        "border border-slate-700/40",
        order.status === "served" && "opacity-50"
      )}
    >
      {/* Overdue pulse bar */}
      {urgency === "overdue" && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-red-500 animate-pulse" />
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
        <div className="text-right shrink-0">
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider block mb-1 opacity-80",
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
      <div className="p-2 flex flex-col gap-1.5 bg-slate-900 flex-1 min-h-0 overflow-y-auto">
        {order.items.map((item) => (
          <KdsItemRow
            key={item.id}
            item={item}
            onToggle={() => onItemToggle(item)}
          />
        ))}
      </div>

      {/* ── Action button ── */}
      <div className="p-3 shrink-0 border-t border-slate-700/40 bg-slate-900">
        {order.status === "served" ? (
          <div className="w-full py-3 rounded-lg bg-slate-800 text-slate-500 font-semibold text-sm text-center flex items-center justify-center gap-1.5">
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
                ? "bg-emerald-500 text-white hover:bg-emerald-400 ambient-shadow"
                : urgency === "overdue"
                  ? "bg-red-600/80 text-red-50 hover:bg-red-600 ambient-shadow"
                  : "bg-slate-800 text-slate-400 cursor-not-allowed opacity-70"
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
}: {
  item: KitchenOrderItem;
  onToggle: () => void;
}) {
  const isReady = item.status === "ready";
  const isPreparing = item.status === "preparing";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isReady}
      className={cn(
        "flex items-start gap-3 w-full text-left rounded-lg p-3 transition-colors press-scale-sm",
        isReady
          ? "bg-slate-800/40 cursor-default"
          : "bg-slate-800 hover:bg-slate-700 cursor-pointer"
      )}
    >
      {/* Checkbox — Stitch style */}
      <div
        className={cn(
          "size-6 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all",
          isReady
            ? "bg-emerald-500 border-emerald-500"
            : isPreparing
              ? "bg-amber-500/20 border-amber-400"
              : "border-slate-500"
        )}
      >
        {isReady && (
          <Icon name="check" size={14} className="text-white font-bold" />
        )}
        {isPreparing && (
          <div className="size-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </div>

      {/* Item body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5">
          <span
            className={cn(
              "font-heading font-bold text-sm md:text-base leading-tight",
              isReady ? "line-through text-slate-500" : "text-slate-50"
            )}
          >
            {item.productName}
          </span>
        </div>
        {item.variantLabel && (
          <span className="text-xs text-slate-400 block mt-0.5">
            {item.variantLabel}
          </span>
        )}
        {/* Toppings */}
        {item.toppings.length > 0 && (
          <div className="text-xs text-slate-400 mt-0.5">
            {item.toppings.map((t, i) => (
              <span key={i}>
                {i > 0 && ", "}+{t.name}
              </span>
            ))}
          </div>
        )}
        {/* Note */}
        {item.note && (
          <p className="text-xs text-amber-300 italic mt-1 flex items-start gap-1">
            <Icon name="sticky_note_2" size={12} className="mt-0.5 shrink-0" />
            {item.note}
          </p>
        )}
        {/* Quantity badge */}
        {item.quantity > 1 && (
          <span className="inline-flex items-center gap-0.5 mt-1.5 px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold">
            x{item.quantity}
          </span>
        )}
      </div>
    </button>
  );
}
