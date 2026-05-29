"use client";

/**
 * KDS (Kitchen Display System) — Full-screen order board for bar/kitchen.
 *
 * Polls kitchen_orders in bulk, displays cards grouped by kitchen stage.
 * Bar staff taps items to cycle status (pending→preparing→ready),
 * taps "Xong" to mark order as served.
 *
 * OneBiz light board styling:
 * - Main bg follows ERP surface tokens for consistency with POS FnB.
 * - Cards use white surfaces with a strong status strip for kitchen readability.
 * - Timer stays large and color-coded by urgency.
 * - Item rows stay touch-friendly for tablet/kitchen monitors.
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
  getKitchenOrdersWithItems,
  updateKitchenOrderStatus,
  updateKitchenItemStatus,
} from "@/lib/services/supabase/kitchen-orders";
import { getClient } from "@/lib/services/supabase/base";
import { getKitchenStationsByBranch } from "@/lib/services/supabase/kitchen-stations";
import { useFnbSubdomain } from "@/lib/hooks/use-fnb-subdomain";
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
const ACTIVE_STATUSES: KitchenOrderStatus[] = ["pending", "preparing", "ready"];

type FilterTab = "all" | "pending" | "preparing" | "ready";
const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "pending", label: "Chờ" },
  { key: "preparing", label: "Đang pha" },
  { key: "ready", label: "Sẵn sàng" },
];
const KDS_LANES: {
  key: Exclude<FilterTab, "all">;
  title: string;
  description: string;
  icon: string;
  accentClass: string;
}[] = [
  {
    key: "pending",
    title: "Chờ nhận",
    description: "Đơn mới cần bắt đầu làm",
    icon: "pending_actions",
    accentClass: "text-status-warning bg-status-warning/10 border-status-warning/20",
  },
  {
    key: "preparing",
    title: "Đang pha",
    description: "Món đang được xử lý",
    icon: "local_cafe",
    accentClass: "text-primary bg-primary-subtle border-primary/20",
  },
  {
    key: "ready",
    title: "Sẵn sàng",
    description: "Chờ mang ra hoặc giao khách",
    icon: "room_service",
    accentClass: "text-status-success bg-status-success/10 border-status-success/20",
  },
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

function getOrderStage(order: KdsOrder): Exclude<FilterTab, "all"> {
  // CEO 29/05/2026: ưu tiên TRẠNG THÁI MÓN (chi tiết) khi đơn có món — tránh
  // đơn status='ready' nhưng còn món đang pha bị đẩy nhầm vào lane "Sẵn sàng"
  // (nút Xong khoá → mâu thuẫn). Chỉ dùng order.status khi chưa có món nào động.
  const items = order.items ?? [];
  if (items.length > 0) {
    if (items.every((item) => item.status === "ready")) return "ready";
    if (items.some((item) => item.status === "preparing" || item.status === "ready")) {
      return "preparing";
    }
  }
  if (order.status === "ready") return "ready";
  if (order.status === "preparing") return "preparing";
  return "pending";
}

// ── Sound helper ──
// CEO 29/05/2026: dùng 1 AudioContext dùng chung (lazy) thay vì tạo mới mỗi
// lần beep — trước đây mỗi beep `new AudioContext()` → rò rỉ, trình duyệt chặn
// sau ~6 context → chuông báo đơn mới CHẾT.
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (typeof AudioContext === "undefined") return null;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioContext();
    if (sharedAudioCtx.state === "suspended") void sharedAudioCtx.resume().catch(() => {});
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function playBeep(freq = 880, duration = 0.15, gain = 0.3) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
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

function getKitchenLoadMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (message.includes("PGRST201")) {
    return "Không đọc được thông tin bàn do quan hệ dữ liệu bị mơ hồ. Hệ thống sẽ thử lại sau khi dùng query đã chỉ rõ liên kết bàn.";
  }
  if (message.toLowerCase().includes("failed to fetch") || message.toLowerCase().includes("network")) {
    return "Mất kết nối mạng khi tải đơn bếp.";
  }
  return "Không tải được đơn bếp lúc này.";
}

// ── Types ──

interface KdsOrder extends KitchenOrder {
  items: KitchenOrderItem[];
}

// ── Page ──

function KdsPageInner() {
  const { branches, currentBranch, switchBranch, user } = useAuth();
  // Sprint UI-FIX (CEO 08/05): link "Quay về POS" dùng fnbPath để
  // trên subdomain fnb.* trỏ về "/" thay vì "/pos/fnb" (URL bar đẹp hơn).
  const { fnbPath } = useFnbSubdomain();
  const { toast } = useToast();
  const { settings } = useSettings();
  const branchId = currentBranch?.id;
  const isStoreBranch = currentBranch?.branchType === "store";
  const storeBranches = branches.filter((branch) => branch.branchType === "store");

  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  // Sprint KITCHEN-1 (CEO 07/05): filter theo trạm chế biến.
  // null = "Tất cả trạm" (hiện hết). string = id của 1 station.
  const [stationFilter, setStationFilter] = useState<string | null>(null);
  const [stations, setStations] = useState<
    { id: string; name: string; color: string; icon: string }[]
  >([]);
  const [soundOn, setSoundOn] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  // Offline indicator: track last successful fetch + current error state.
  // Banner shows khi hoặc fetch vừa lỗi HOẶC chưa thấy update > 60s (stale).
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const overdueAlertedRef = useRef<Set<string>>(new Set());
  const fetchErrorShownRef = useRef(false);

  // Clock
  const [wallClock, setWallClock] = useState<string>(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  // Sprint KITCHEN-1: Load stations cho dropdown filter.
  useEffect(() => {
    if (!branchId || !isStoreBranch) {
      setStations([]);
      setStationFilter(null);
      return;
    }
    let cancelled = false;
    getKitchenStationsByBranch(branchId)
      .then((list) => {
        if (cancelled) return;
        // Chỉ hiện stations có show_on_kds !== false
        const visible = list
          .filter((s) => s.settings.show_on_kds !== false)
          .map((s) => ({ id: s.id, name: s.name, color: s.color, icon: s.icon }));
        setStations(visible);
      })
      .catch(() => {
        if (!cancelled) setStations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, isStoreBranch]);

  // ── Poll orders ──
  const fetchOrders = useCallback(async () => {
    if (!branchId || !isStoreBranch) {
      setOrders([]);
      setFetchError(null);
      setLastFetchAt(null);
      setLoading(false);
      return;
    }
    try {
      const enriched = await getKitchenOrdersWithItems(branchId, ACTIVE_STATUSES);

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

      // R8: Sort theo urgency desc — đơn chờ lâu nhất nổi đầu để bếp pha trước.
      // Tiebreak: status priority (pending > preparing > ready) để new orders không
      // bị "chôn" sau "preparing" cũ. Cancelled không lọt vào ACTIVE_STATUSES.
      const STATUS_PRIORITY: Record<string, number> = {
        pending: 0,
        preparing: 1,
        ready: 2,
        served: 3,
      };
      enriched.sort((a, b) => {
        // Primary: createdAt asc (cũ nhất lên đầu = chờ lâu nhất)
        const tA = new Date(a.createdAt).getTime();
        const tB = new Date(b.createdAt).getTime();
        if (tA !== tB) return tA - tB;
        // Secondary: status priority
        return (
          (STATUS_PRIORITY[a.status] ?? 99) -
          (STATUS_PRIORITY[b.status] ?? 99)
        );
      });

      setOrders(enriched);
      fetchErrorShownRef.current = false;
      setFetchError(null);
      setLastFetchAt(Date.now());
    } catch (err) {
      console.error("KDS fetchOrders error:", err);
      const msg = getKitchenLoadMessage(err);
      setFetchError(msg);
      if (!fetchErrorShownRef.current) {
        fetchErrorShownRef.current = true;
        toast({
          title: "Không tải được đơn bếp",
          description:
            "Danh sách có thể chưa phải bản mới nhất. Hệ thống vẫn tự thử lại.",
          variant: "error",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [branchId, isStoreBranch, soundOn, toast]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // ── Supabase Realtime subscription ──
  useEffect(() => {
    if (!branchId || !isStoreBranch) return;
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
  }, [branchId, isStoreBranch, fetchOrders]);

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
      // Optimistic UI trước cho phản hồi tức thì.
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
      // CEO 29/05/2026: bọc try/catch + rollback — mất mạng giữa chừng (wifi
      // bếp hay rớt) trước đây làm UI lệch DB, 30s sau tự revert → tưởng mất tay.
      try {
        await updateKitchenItemStatus(item.id, next);
      } catch (err) {
        fetchOrders(); // rollback về đúng trạng thái server
        toast({
          title: "Không cập nhật được món",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
      }
    },
    [fetchOrders, toast]
  );

  // ── Mark order served ──
  const handleServed = useCallback(async (orderId: string) => {
    hapticSuccess();
    // Optimistic UI trước.
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, status: "served" as KitchenOrderStatus } : o
      )
    );
    // CEO 29/05/2026: bọc try/catch + rollback — mất mạng → UI lệch DB.
    try {
      await updateKitchenOrderStatus(orderId, "served");
    } catch (err) {
      fetchOrders();
      toast({
        title: "Không đánh dấu phục vụ được",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    }
  }, [fetchOrders, toast]);

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
  // Sprint KITCHEN-1: thêm filter theo station — bar staff chỉ thấy món
  // drink, kitchen staff chỉ thấy món bếp. Khi filter = null = "Tất cả trạm".
  const filtered = orders
    .map((o) => {
      // Filter items theo station nếu có chọn
      if (!stationFilter) return o;
      const items = o.items.filter((it) => it.kitchenStationId === stationFilter);
      return { ...o, items };
    })
    .filter((o) => {
      // Hide order nếu không còn item nào (sau khi filter station)
      if (stationFilter && o.items.length === 0) return false;
      if (filter === "all") return o.status !== "served";
      return getOrderStage(o) === filter;
    });
  const laneOrders = (status: Exclude<FilterTab, "all">) =>
    filtered.filter((order) => getOrderStage(order) === status);
  const selectedLane =
    filter === "all" ? null : KDS_LANES.find((lane) => lane.key === filter);

  // ── Render ──

  // CEO chưa chọn chi nhánh
  if (!branchId) {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-6">
          <Link
            href={fnbPath("/pos/fnb")}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
          >
            <Icon name="arrow_back" size={16} />
            POS
          </Link>
          <PosBranchSelector variant="light" filter={["store"]} showCode />
          <div className="flex-1" />
          <Icon name="soup_kitchen" size={20} className="text-muted-foreground" />
          <span className="font-heading text-base font-bold text-foreground">
            KDS Bếp
          </span>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
          <div className="relative w-28 h-28">
            <div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse" />
            <div className="relative flex h-full w-full items-center justify-center text-primary">
              <Icon name="soup_kitchen" size={56} />
            </div>
          </div>
          <div className="text-center space-y-2 max-w-md">
            <h2 className="font-heading text-2xl font-bold text-foreground">
              Chọn chi nhánh để xem đơn bếp
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Bấm chip <strong className="text-foreground">"Chọn chi nhánh"</strong> trên header để chọn quán đang trực bếp. Mỗi quán có hàng đợi đơn riêng.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isStoreBranch) {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-6">
          <Link
            href={fnbPath("/pos/fnb")}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
          >
            <Icon name="arrow_back" size={16} />
            POS FnB
          </Link>
          <div className="flex-1" />
          <PosBranchSelector variant="light" filter={["store"]} showCode />
        </header>

        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg bg-primary-subtle text-primary">
              <Icon name="storefront" size={28} />
            </div>
            <h2 className="font-heading text-2xl font-bold text-foreground">
              Chọn quán FnB để mở màn bếp
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Hiện tại đang ở {currentBranch?.name ?? "chi nhánh không phù hợp"}. KDS chỉ hiển thị đơn của chi nhánh loại quán/store. Vui lòng chọn đúng quán để mở hàng đợi bếp.
            </p>

            {storeBranches.length > 0 ? (
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {storeBranches.map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => switchBranch(branch.id)}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-subtle press-scale-sm"
                  >
                    <Icon name="storefront" size={18} className="text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {branch.code ? `${branch.code} · ${branch.name}` : branch.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">Mở hàng đợi bếp</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-lg bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
                Chưa có chi nhánh loại quán/store. Vui lòng tạo hoặc đổi loại chi nhánh trong Cài đặt chi nhánh trước.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Icon
            name="progress_activity"
            size={36}
            className="animate-spin text-primary"
          />
          <p className="text-sm text-muted-foreground">Đang tải đơn bếp...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-card/95 px-4 py-3 shadow-sm md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          {/* Left: title + status */}
          <div className="flex min-w-0 items-center gap-3">
          <Link
            href={fnbPath("/pos/fnb")}
            className="shrink-0 rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
            title="Quay về POS"
          >
            <Icon name="arrow_back" size={16} />
          </Link>
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
              <Icon name="restaurant_menu" size={20} />
            </div>
            <div className="flex min-w-0 flex-col">
              <h1 className="font-heading truncate text-lg font-bold leading-tight tracking-tight text-foreground md:text-xl">
                Màn bếp KDS
              </h1>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    fetchError
                      ? "bg-status-error animate-pulse"
                      : realtimeConnected
                        ? "bg-status-success"
                        : "bg-status-warning",
                  )}
                />
                {fetchError ? "Lỗi tải" : realtimeConnected ? "Trực tiếp" : "Đang kiểm tra"} · {filtered.length} đơn
              </span>
            </div>
          </div>
          <div className="hidden lg:block">
            <PosBranchSelector variant="light" filter={["store"]} showCode />
          </div>

          <div className="flex-1" />

          <div className="hidden items-center gap-1 rounded-lg border border-border bg-surface-container p-1 sm:flex">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={cn(
                  "rounded-md px-4 py-2 text-xs font-semibold transition-all press-scale-sm md:text-sm",
                  filter === tab.key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-card hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {stations.length > 1 && (
            <div className="hidden max-w-[420px] items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-container p-1 md:flex">
              <button
                onClick={() => setStationFilter(null)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-all press-scale-sm",
                  stationFilter === null
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-card hover:text-foreground",
                )}
                title="Hiện tất cả trạm"
              >
                <Icon name="apps" size={14} />
                Tất cả
              </button>
              {stations.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStationFilter(s.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-all press-scale-sm",
                    stationFilter === s.id
                      ? "text-white shadow-sm"
                      : "text-muted-foreground hover:bg-card hover:text-foreground",
                  )}
                  style={
                    stationFilter === s.id
                      ? { backgroundColor: s.color }
                      : undefined
                  }
                  title={`Chỉ hiện món ${s.name}`}
                >
                  <Icon name={s.icon} size={14} />
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex shrink-0 items-center gap-2">
            <div className="rounded-lg border border-border bg-card px-3 py-1.5 font-heading text-xl font-bold tabular-nums tracking-tight text-foreground md:text-2xl">
              {wallClock}
            </div>
            <button
              onClick={() => setSoundOn(!soundOn)}
              className={cn(
                "flex size-10 items-center justify-center rounded-lg border transition-colors press-scale-sm",
                soundOn
                  ? "border-primary/30 bg-primary-subtle text-primary hover:bg-primary-fixed"
                  : "border-border bg-card text-muted-foreground hover:bg-surface-container",
              )}
              title={soundOn ? "Tắt âm" : "Bật âm"}
            >
              <Icon name={soundOn ? "volume_up" : "volume_off"} size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Offline / connection alert banner — hiện khi fetch lỗi hoặc stale data > 90s
          Để bếp biết ngay không cần check header nhỏ. Khi online lại thì biến mất. */}
      {(fetchError || (!realtimeConnected && lastFetchAt !== null && now - lastFetchAt > 90_000)) && (
        <div className="flex shrink-0 items-center gap-3 border-b border-status-warning/30 bg-status-warning/10 px-4 py-3 md:px-6">
          <div className="flex size-8 shrink-0 animate-pulse items-center justify-center rounded-full bg-status-warning/20">
            <Icon name="wifi_off" size={16} className="text-status-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-status-warning">
              {fetchError ? "Lỗi tải đơn bếp" : "Mất kết nối realtime"}
            </div>
            <div className="text-xs text-muted-foreground">
              {fetchError
                ? `${fetchError}. Đang thử lại mỗi 30s - kiểm tra mạng hoặc Supabase.`
                : `Chưa update ${Math.floor((now - (lastFetchAt ?? now)) / 1000)}s. Poll 30s vẫn chạy - món mới có thể chậm.`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchOrders()}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-status-warning/30 bg-card px-3 py-2 text-xs font-semibold text-status-warning transition-colors hover:bg-status-warning/10 press-scale-sm"
            title="Tải lại ngay"
          >
            <Icon name="refresh" size={14} />
            Tải lại
          </button>
        </div>
      )}

      {/* Filter pills — mobile row (outside header) */}
      <div className="mx-3 mt-3 flex shrink-0 items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-container p-1 no-scrollbar sm:hidden">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "shrink-0 rounded-md px-4 py-2 text-xs font-semibold transition-all press-scale-sm",
              filter === tab.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-card hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {stations.length > 1 && (
        <div className="mx-3 mt-2 flex shrink-0 items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-container p-1 no-scrollbar md:hidden">
          <button
            onClick={() => setStationFilter(null)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-all press-scale-sm",
              stationFilter === null
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            <Icon name="apps" size={14} />
            Tất cả trạm
          </button>
          {stations.map((s) => (
            <button
              key={s.id}
              onClick={() => setStationFilter(s.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-all press-scale-sm",
                stationFilter === s.id
                  ? "text-white shadow-sm"
                  : "text-muted-foreground hover:bg-card hover:text-foreground",
              )}
              style={
                stationFilter === s.id
                  ? { backgroundColor: s.color }
                  : undefined
              }
            >
              <Icon name={s.icon} size={14} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* ── KDS Board ── */}
      <div className="flex-1 overflow-auto bg-background p-3 md:p-5">
        {filtered.length === 0 ? (
          /* CEO 29/05/2026: empty-state TỔNG THỂ — 0 đơn thì hiện 1 trạng thái
             "bếp rảnh" gọn giữa màn, thay vì để 3 ô rỗng gần giống nhau trông
             như màn hình bị hỏng. Icon trung tính (không phải ✓ xanh gây hiểu
             nhầm "đã xong hết"). */
          <div className="flex h-full min-h-[60vh] flex-col items-center justify-center px-6 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-surface-container text-muted-foreground">
              <Icon name="restaurant" size={44} />
            </div>
            <p className="mt-4 text-xl font-semibold text-foreground">
              {filter === "all" ? "Bếp đang rảnh" : "Không có đơn ở luồng này"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filter === "all"
                ? "Chưa có đơn nào — đơn mới sẽ tự hiện ở đây."
                : "Thử chọn luồng khác hoặc xem Tất cả."}
            </p>
          </div>
        ) : filter === "all" ? (
          /* Responsive Sprint A4 (CEO 25/05/2026):
             Trước đây grid-cols-1 (mobile) → lg:grid-cols-3 (desktop). Khoảng
             768-1023px (iPad treo bếp) bị single-col → mỗi lane chiếm full
             width, phải cuộn dọc 3+ lanes. Thêm md:grid-cols-2 cho tablet
             + 2xl:grid-cols-5 cho TV bếp 1920px+ (4-5 lane 1 hàng đọc xa). */
          <div className="grid min-h-full grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {KDS_LANES.map((lane) => (
              <KdsLane
                key={lane.key}
                title={lane.title}
                description={lane.description}
                icon={lane.icon}
                accentClass={lane.accentClass}
                orders={laneOrders(lane.key)}
                now={now}
                onItemToggle={handleItemToggle}
                onItemRecall={handleItemRecall}
                onPrintTicket={handlePrintTicket}
                onServed={handleServed}
                onMarkAllReady={handleMarkAllReady}
              />
            ))}
          </div>
        ) : (
          <KdsLane
            title={selectedLane?.title ?? "Đơn bếp"}
            description={selectedLane?.description ?? "Hàng đợi đang lọc"}
            icon={selectedLane?.icon ?? "restaurant_menu"}
            accentClass={selectedLane?.accentClass ?? "text-primary bg-primary-subtle border-primary/20"}
            orders={filtered}
            now={now}
            wide
            onItemToggle={handleItemToggle}
            onItemRecall={handleItemRecall}
            onPrintTicket={handlePrintTicket}
            onServed={handleServed}
            onMarkAllReady={handleMarkAllReady}
          />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// KDS Lane
// ══════════════════════════════════════════════════════════════════

function KdsLane({
  title,
  description,
  icon,
  accentClass,
  orders,
  now,
  wide = false,
  onItemToggle,
  onItemRecall,
  onPrintTicket,
  onServed,
  onMarkAllReady,
}: {
  title: string;
  description: string;
  icon: string;
  accentClass: string;
  orders: KdsOrder[];
  now: number;
  wide?: boolean;
  onItemToggle: (item: KitchenOrderItem) => void;
  onItemRecall: (item: KitchenOrderItem) => void;
  onPrintTicket: (order: KdsOrder) => void;
  onServed: (orderId: string) => void;
  onMarkAllReady: (orderId: string) => void;
}) {
  return (
    <section className="flex min-h-[320px] flex-col overflow-hidden rounded-lg border border-border bg-surface-container-lowest shadow-sm">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border", accentClass)}>
          <Icon name={icon} size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-base font-bold text-foreground">
              {title}
            </h2>
            <span className="rounded-full bg-surface-container px-2 py-0.5 text-xs font-bold text-muted-foreground">
              {orders.length}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </header>

      <div
        className={cn(
          "flex-1 overflow-y-auto p-3",
          wide
            ? "grid auto-rows-max grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
            : "space-y-3",
        )}
      >
        {orders.length === 0 ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/70 p-4 text-center">
            {/* CEO 29/05/2026: icon trung tính (không phải ✓ xanh gây hiểu nhầm "đã xong hết"). */}
            <Icon name="inbox" size={28} className="text-muted-foreground" />
            <p className="mt-2 text-sm font-semibold text-foreground">Đang trống</p>
            <p className="mt-1 text-xs text-muted-foreground">Chưa có đơn trong luồng này.</p>
          </div>
        ) : (
          orders.map((order) => (
            <KdsOrderCard
              key={order.id}
              order={order}
              now={now}
              onItemToggle={onItemToggle}
              onItemRecall={onItemRecall}
              onPrintTicket={() => onPrintTicket(order)}
              onServed={() => onServed(order.id)}
              onMarkAllReady={() => onMarkAllReady(order.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════
// KDS Order Card — OneBiz light board style
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
    order.orderType === "dine_in" ? "Bàn tại quán" : order.orderType === "takeaway" ? "Mang về" : "Giao hàng";

  // Header color theme based on urgency
  const cardAccentClass =
    urgency === "overdue"
      ? "border-t-status-error"
      : urgency === "attention"
        ? "border-t-status-warning"
        : "border-t-primary";

  const statusPillClass =
    urgency === "overdue"
      ? "border-status-error/30 bg-status-error/10 text-status-error"
      : urgency === "attention"
        ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
        : "border-primary/20 bg-primary-subtle text-primary";

  const timerTextClass =
    urgency === "overdue"
      ? "text-status-error animate-pulse"
      : urgency === "attention"
        ? "text-status-warning"
        : "text-status-info";

  return (
    <div
      className={cn(
        "relative flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-border border-t-4 bg-card shadow-sm",
        cardAccentClass,
        order.status === "served" && "opacity-50"
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card p-4">
        <div className="min-w-0 space-y-2">
          <span className={cn("inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-bold", statusPillClass)}>
            {typeLabelCaption}
          </span>
          <div className="space-y-1">
            <span className="block truncate font-heading text-3xl font-extrabold leading-none text-foreground md:text-4xl">
              {typeLabel}
            </span>
            <span className="block text-xs font-semibold text-muted-foreground">
              #{order.orderNumber}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrintTicket();
            }}
            className="flex size-11 md:size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
            title="In lại phiếu bếp"
            aria-label="In lại phiếu bếp"
          >
            <Icon name="print" size={14} />
          </button>
          <div className="rounded-lg bg-surface-container px-2.5 py-1.5">
            <span className="block text-[10px] font-bold uppercase text-muted-foreground">
              Thời gian
            </span>
            {/* Responsive Sprint A3 (CEO 25/05/2026): tăng size để bếp đọc
                xa 2-3m trên TV 24"+. xl: ~30px, 2xl: ~36px. */}
            <span className={cn("font-heading text-xl font-bold tabular-nums md:text-2xl xl:text-3xl 2xl:text-4xl", timerTextClass)}>
              {formatElapsed(order.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Items list ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-surface-container-lowest p-2">
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
      <div className="shrink-0 space-y-2 border-t border-border bg-card p-3">
        {/* Bulk "Sẵn sàng hết" — only when there are still pending items */}
        {order.status !== "served" && pendingCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllReady}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg border border-primary/25 bg-primary-subtle py-3 text-xs font-semibold text-primary transition-all hover:bg-primary-fixed press-scale-sm"
            )}
            title={`Đánh dấu sẵn sàng ${pendingCount} món còn lại`}
          >
            <Icon name="done_all" size={14} />
            Sẵn sàng hết ({pendingCount})
          </button>
        )}

        {order.status === "served" ? (
          <div className="flex w-full items-center justify-center gap-2 rounded-lg bg-surface-container py-3 text-center text-sm font-semibold text-muted-foreground">
            <Icon name="check_circle" size={16} />
            Đã phục vụ
          </div>
        ) : (
          <button
            type="button"
            onClick={onServed}
            disabled={!allReady}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold transition-all press-scale-sm",
              allReady
                ? "bg-status-success text-white hover:bg-status-success/90 ambient-shadow"
                : "cursor-not-allowed bg-surface-container text-muted-foreground opacity-75"
            )}
          >
            <Icon
              name={allReady ? "check_circle" : "pending_actions"}
              size={16}
            />
            {allReady ? "Xong" : `Còn ${pendingCount} món`}
          </button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// KDS Item Row
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
          "flex w-full items-start gap-3 rounded-lg border border-status-success/20 bg-status-success/5 p-3 text-left"
        )}
      >
        <div
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition-all",
            "bg-status-success border-status-success"
          )}
        >
          <Icon name="check" size={14} className="text-white font-bold" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "font-heading text-sm font-bold leading-tight md:text-base",
                "line-through text-muted-foreground"
              )}
            >
              {item.productName}
            </span>
          </div>
          {item.variantLabel && (
            <span className="mt-0.5 block text-xs text-muted-foreground line-through">
              {item.variantLabel}
            </span>
          )}
          {item.toppings.length > 0 && (
            <div className="mt-0.5 text-xs text-muted-foreground line-through">
              {item.toppings.map((t, i) => (
                <span key={i}>
                  {i > 0 && ", "}+{t.name}
                </span>
              ))}
            </div>
          )}
          {item.quantity > 1 && (
            <span className="inline-flex items-center gap-0.5 mt-2 px-2 py-0.5 rounded-full bg-status-success/20 text-status-success text-[10px] font-bold">
              x{item.quantity}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onRecall}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-status-warning/10 hover:text-status-warning press-scale-sm"
          )}
          title="Hoàn tác - đánh dấu lại đang pha"
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
        "flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors press-scale-sm",
        isPreparing
          ? "border-status-warning/30 bg-status-warning/10 hover:bg-status-warning/15"
          : "border-border bg-card hover:bg-surface-container"
      )}
    >
      {/* Checkbox — Stitch style */}
      <div
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition-all",
          isPreparing
            ? "bg-status-warning/20 border-status-warning"
            : "border-outline-variant"
        )}
      >
        {isPreparing && (
          <div className="size-2 rounded-full bg-status-warning animate-pulse" />
        )}
      </div>

      {/* Item body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              // Responsive Sprint A3 (CEO 25/05/2026): tăng font item KDS
              // để bếp đọc rõ trên TV/iPad treo bếp từ 1.5-3m.
              "font-heading text-base font-bold leading-tight md:text-lg xl:text-xl",
              "text-foreground"
            )}
          >
            {item.productName}
          </span>
        </div>
        {item.variantLabel && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {item.variantLabel}
          </span>
        )}
        {/* Toppings */}
        {item.toppings.length > 0 && (
          <div className="mt-0.5 text-xs text-muted-foreground">
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
            <Icon name="sticky_note_2" size={14} className="mt-0.5 shrink-0" />
            {item.note}
          </p>
        )}
        {/* Quantity badge */}
        {item.quantity > 1 && (
          <span className="inline-flex items-center gap-0.5 mt-2 px-2 py-0.5 rounded-full bg-status-info/20 text-status-info text-[10px] font-bold">
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
