"use client";

/**
 * MOCKUP — Màn bếp KDS Design Showcase (populated)
 * Route: /mockup/kds
 *
 * CEO 29/05/2026: review design POS + bếp. Tenant đang 0 đơn nên KDS thật mở
 * ra chỉ thấy "Bếp đang rảnh". Mockup này dựng lại ĐÚNG thiết kế card/lane của
 * KDS production (border-t-4 theo độ trễ, số bàn cỡ lớn, đồng hồ đổi màu, item
 * có trạng thái, nút "Xong"/"Sẵn sàng hết") + bơm đơn mẫu ở 3 luồng để CEO
 * thấy màn bếp khi có đơn thật. Không đụng data / file KDS thật.
 */

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type ItemStatus = "pending" | "preparing" | "ready";
type Urgency = "normal" | "attention" | "overdue";
type OrderType = "dine_in" | "takeaway" | "delivery";

interface MockItem {
  id: string;
  name: string;
  quantity: number;
  status: ItemStatus;
  note?: string;
  toppings?: string[];
}
interface MockOrder {
  id: string;
  orderNumber: string;
  orderType: OrderType;
  tableName?: string;
  elapsed: string; // "3:12"
  urgency: Urgency;
  status: "active" | "served";
  items: MockItem[];
}

const LANES: { key: string; title: string; description: string; icon: string; accent: string }[] = [
  {
    key: "pending",
    title: "Chờ pha",
    description: "Đơn mới — chưa bắt đầu",
    icon: "schedule",
    accent: "border-status-warning/30 bg-status-warning/10 text-status-warning",
  },
  {
    key: "preparing",
    title: "Đang pha",
    description: "Barista đang làm",
    icon: "local_fire_department",
    accent: "border-status-info/30 bg-status-info/10 text-status-info",
  },
  {
    key: "ready",
    title: "Sẵn sàng",
    description: "Chờ phục vụ / giao",
    icon: "check_circle",
    accent: "border-status-success/30 bg-status-success/10 text-status-success",
  },
];

const ORDERS: Record<string, MockOrder[]> = {
  pending: [
    {
      id: "o-3",
      orderNumber: "KO000312",
      orderType: "dine_in",
      tableName: "Bàn 12",
      elapsed: "12:40",
      urgency: "overdue",
      status: "active",
      items: [
        { id: "i-1", name: "Trà sữa trân châu đường đen", quantity: 2, status: "pending", toppings: ["Trân châu đen"] },
        { id: "i-2", name: "Cà phê muối", quantity: 1, status: "pending", note: "Ít ngọt" },
      ],
    },
  ],
  preparing: [
    {
      id: "o-2",
      orderNumber: "KO000311",
      orderType: "takeaway",
      elapsed: "7:05",
      urgency: "attention",
      status: "active",
      items: [
        { id: "i-3", name: "Matcha đá xay", quantity: 1, status: "preparing" },
        { id: "i-4", name: "Bạc xỉu", quantity: 2, status: "preparing" },
        { id: "i-5", name: "Croissant bơ", quantity: 1, status: "ready" },
      ],
    },
    {
      id: "o-1",
      orderNumber: "KO000310",
      orderType: "dine_in",
      tableName: "Bàn 5",
      elapsed: "2:18",
      urgency: "normal",
      status: "active",
      items: [
        { id: "i-6", name: "Cà phê sữa đá", quantity: 2, status: "preparing" },
        { id: "i-7", name: "Trà đào cam sả", quantity: 1, status: "ready" },
      ],
    },
  ],
  ready: [
    {
      id: "o-4",
      orderNumber: "KO000309",
      orderType: "delivery",
      elapsed: "1:30",
      urgency: "normal",
      status: "active",
      items: [
        { id: "i-8", name: "Cold Brew", quantity: 1, status: "ready" },
        { id: "i-9", name: "Bánh tiramisu", quantity: 1, status: "ready" },
      ],
    },
  ],
};

function ItemRow({ item }: { item: MockItem }) {
  const isReady = item.status === "ready";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-2.5 transition-colors",
        isReady
          ? "border-status-success/20 bg-status-success/5"
          : "border-border bg-card",
      )}
    >
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border-2",
          isReady
            ? "border-status-success bg-status-success text-white"
            : item.status === "preparing"
              ? "border-status-info text-status-info"
              : "border-muted-foreground/40 text-transparent",
        )}
      >
        <Icon name="check" size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "font-heading text-base font-bold leading-tight",
              isReady ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {item.name}
          </span>
          <span className="shrink-0 rounded-md bg-surface-container px-1.5 py-0.5 text-xs font-bold tabular-nums text-foreground">
            ×{item.quantity}
          </span>
        </div>
        {item.toppings && item.toppings.length > 0 && (
          <p className="text-xs text-muted-foreground">+ {item.toppings.join(", ")}</p>
        )}
        {item.note && (
          <p className="text-xs italic text-status-warning">&ldquo;{item.note}&rdquo;</p>
        )}
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: MockOrder }) {
  const pendingCount = order.items.filter((i) => i.status !== "ready").length;
  const allReady = pendingCount === 0;
  const typeLabel =
    order.orderType === "dine_in" ? order.tableName ?? "Bàn" : order.orderType === "takeaway" ? "Mang về" : "Giao";
  const typeCaption =
    order.orderType === "dine_in" ? "Bàn tại quán" : order.orderType === "takeaway" ? "Mang về" : "Giao hàng";

  const cardAccent =
    order.urgency === "overdue"
      ? "border-t-status-error"
      : order.urgency === "attention"
        ? "border-t-status-warning"
        : "border-t-primary";
  const statusPill =
    order.urgency === "overdue"
      ? "border-status-error/30 bg-status-error/10 text-status-error"
      : order.urgency === "attention"
        ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
        : "border-primary/20 bg-primary-subtle text-primary";
  const timerText =
    order.urgency === "overdue"
      ? "text-status-error animate-pulse"
      : order.urgency === "attention"
        ? "text-status-warning"
        : "text-status-info";

  return (
    <div className={cn("relative flex w-full flex-col overflow-hidden rounded-lg border border-border border-t-4 bg-card shadow-sm", cardAccent)}>
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card p-4">
        <div className="min-w-0 space-y-2">
          <span className={cn("inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-bold", statusPill)}>
            {typeCaption}
          </span>
          <div className="space-y-1">
            <span className="block truncate font-heading text-3xl font-extrabold leading-none text-foreground md:text-4xl">
              {typeLabel}
            </span>
            <span className="block text-xs font-semibold text-muted-foreground">#{order.orderNumber}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 text-right">
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
            title="In lại phiếu bếp"
          >
            <Icon name="print" size={14} />
          </button>
          <div className="rounded-lg bg-surface-container px-2.5 py-1.5">
            <span className="block text-[10px] font-bold uppercase text-muted-foreground">Thời gian</span>
            <span className={cn("font-heading text-2xl font-bold tabular-nums xl:text-3xl", timerText)}>
              {order.elapsed}
            </span>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-surface-container-lowest p-2">
        {order.items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </div>

      {/* Actions */}
      <div className="shrink-0 space-y-2 border-t border-border bg-card p-3">
        {pendingCount > 0 && (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/25 bg-primary-subtle py-3 text-xs font-semibold text-primary transition-all hover:bg-primary-fixed press-scale-sm"
          >
            <Icon name="done_all" size={14} />
            Sẵn sàng hết ({pendingCount})
          </button>
        )}
        <button
          type="button"
          disabled={!allReady}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold transition-all press-scale-sm",
            allReady
              ? "bg-status-success text-white hover:bg-status-success/90 ambient-shadow"
              : "cursor-not-allowed bg-surface-container text-muted-foreground opacity-75",
          )}
        >
          <Icon name={allReady ? "check_circle" : "pending_actions"} size={16} />
          {allReady ? "Xong" : `Còn ${pendingCount} món`}
        </button>
      </div>
    </div>
  );
}

export default function KdsMockupPage() {
  const [soundOn, setSoundOn] = useState(true);
  const total = Object.values(ORDERS).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Mockup banner */}
      <div className="shrink-0 flex items-center gap-2 bg-primary-fixed px-4 py-1.5 text-xs text-primary">
        <Icon name="palette" size={14} />
        <span className="font-semibold">MOCKUP minh hoạ</span>
        <span className="opacity-80">— màn bếp KDS với đơn mẫu. Dữ liệu giả, không ảnh hưởng hệ thống thật.</span>
      </div>

      {/* Header */}
      <header className="shrink-0 border-b border-border bg-card/95 px-4 py-3 shadow-sm md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
            <Icon name="restaurant_menu" size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-lg font-bold leading-tight md:text-xl">Màn bếp KDS</h1>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-status-success" />
              Trực tiếp · {total} đơn
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="rounded-lg border border-border bg-card px-3 py-1.5 font-heading text-xl font-bold tabular-nums md:text-2xl">
              09:24
            </div>
            <button
              type="button"
              onClick={() => setSoundOn((v) => !v)}
              className={cn(
                "flex size-10 items-center justify-center rounded-lg border transition-colors press-scale-sm",
                soundOn
                  ? "border-primary/30 bg-primary-subtle text-primary"
                  : "border-border bg-card text-muted-foreground",
              )}
              title={soundOn ? "Tắt âm" : "Bật âm"}
            >
              <Icon name={soundOn ? "volume_up" : "volume_off"} size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Board — 3 lanes */}
      <div className="flex-1 overflow-auto bg-background p-3 md:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {LANES.map((lane) => {
            const orders = ORDERS[lane.key] ?? [];
            return (
              <section
                key={lane.key}
                className="flex min-h-[320px] flex-col overflow-hidden rounded-lg border border-border bg-surface-container-lowest shadow-sm"
              >
                <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-3">
                  <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border", lane.accent)}>
                    <Icon name={lane.icon} size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="font-heading text-base font-bold text-foreground">{lane.title}</h2>
                      <span className="rounded-full bg-surface-container px-2 py-0.5 text-xs font-bold text-muted-foreground">
                        {orders.length}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{lane.description}</p>
                  </div>
                </header>
                <div className="flex-1 space-y-3 overflow-y-auto p-3">
                  {orders.length === 0 ? (
                    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/70 p-4 text-center">
                      <Icon name="inbox" size={28} className="text-muted-foreground" />
                      <p className="mt-2 text-sm font-semibold text-foreground">Đang trống</p>
                      <p className="mt-1 text-xs text-muted-foreground">Chưa có đơn trong luồng này.</p>
                    </div>
                  ) : (
                    orders.map((order) => <OrderCard key={order.id} order={order} />)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-surface-container-lowest px-4 py-1.5 text-[11px] text-muted-foreground">
        Thiết kế KDS hiện tại với đơn mẫu · viền trên đổi màu theo độ trễ (xanh → cam → đỏ nhấp nháy) · số bàn cỡ lớn đọc xa · nút “Xong” chỉ bật khi mọi món sẵn sàng.
      </div>
    </div>
  );
}
