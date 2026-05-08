"use client";

/** FnbCart — Right sidebar cart panel for F&B POS */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type {
  FnbTabSnapshot,
  FnbOrderLine,
  FnbDiscountInput,
  DeliveryPlatform,
} from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";
import { HelpTip } from "@/components/shared/help-tip";

// Sprint POS-FNB-EXT-1 (CEO 08/05): Delivery platform metadata
const DELIVERY_PLATFORMS: {
  key: DeliveryPlatform;
  label: string;
  activeClassName: string;
}[] = [
  { key: "shopee_food", label: "Shopee Food", activeClassName: "bg-status-error text-white" },
  { key: "grab_food", label: "Grab Food", activeClassName: "bg-status-success text-white" },
  { key: "gojek", label: "Gojek", activeClassName: "bg-status-success text-white" },
  { key: "be", label: "Be", activeClassName: "bg-status-warning text-foreground" },
  { key: "direct", label: "Tự giao", activeClassName: "bg-status-neutral text-white" },
];

interface FnbCartProps {
  activeTab: FnbTabSnapshot | undefined;
  subtotal: number;
  total: number;
  orderDiscountAmount: number;
  lineCount: number;
  updateLineQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;
  onSendToKitchen: () => void;
  onPayment: () => void;
  onSplitBill?: () => void;
  onCustomerClick?: () => void;
  onDiscountChange?: (discount: FnbDiscountInput | undefined) => void;
  onPrintPreBill?: () => void;
  /** Sprint POS-FNB-EXT-1: ghi chú toàn đơn. */
  onOrderNoteChange?: (note: string) => void;
  /** Sprint POS-FNB-EXT-1: delivery platform setters (chỉ dùng khi orderType="delivery"). */
  onDeliveryPlatformChange?: (
    platform: import("@/lib/types/fnb").DeliveryPlatform,
    commissionPercent?: number,
  ) => void;
  onDeliveryFeeChange?: (fee: number) => void;
  onPlatformCommissionChange?: (percent: number) => void;
  /** Sprint POS-FNB-EXT-1: discount presets từ settings. */
  discountPresets?: { id: string; name: string; mode: "amount" | "percent"; value: number }[];
  /** Huỷ đơn bếp — chỉ hiển thị khi activeTab.kitchenOrderId tồn tại (đã gửi bếp). */
  onVoidKitchenOrder?: () => void;
  /** Chuyển bàn — chỉ hiển thị khi dine_in + kitchenOrderId tồn tại. */
  onTransferTable?: () => void;
  /** Lịch sử đơn — mở modal danh sách hoá đơn hôm nay + reprint. */
  onOrderHistory?: () => void;
  /**
   * Sprint POS-FNB-4: switch order type instant từ cart (dine_in/takeaway/delivery).
   * Chỉ hiển thị pill row khi callback được pass + chưa gửi bếp (tránh
   * đổi loại sau khi đã in bill bếp gây nhầm phục vụ).
   */
  onChangeOrderType?: (next: "dine_in" | "takeaway" | "delivery") => void;
  /** Voucher apply — nếu có, hiển thị input áp mã khuyến mãi.
   *  Callback nên gọi validateCoupon RPC + setOrderDiscount khi thành công. */
  onApplyCoupon?: (code: string) => Promise<void> | void;
  onRemoveCoupon?: () => void;
  appliedCouponCode?: string;
  couponApplying?: boolean;
  /** KM-3: free items từ promotion engine (BOGO + gift). Render section "Tặng kèm". */
  freeItems?: { productId: string; productName?: string; quantity: number; unitPrice: number }[];
  /** When true, show full-width (no hidden lg:flex) */
  mobile?: boolean;
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: "Tại quán",
  takeaway: "Mang về",
  delivery: "Giao hàng",
};

export function FnbCart({
  activeTab,
  subtotal,
  total,
  orderDiscountAmount,
  lineCount,
  updateLineQty,
  removeLine,
  onSendToKitchen,
  onPayment,
  onSplitBill,
  onCustomerClick,
  onDiscountChange,
  onPrintPreBill,
  onVoidKitchenOrder,
  onTransferTable,
  onOrderHistory,
  onChangeOrderType,
  onApplyCoupon,
  onRemoveCoupon,
  appliedCouponCode,
  couponApplying,
  freeItems,
  mobile,
  onOrderNoteChange,
  onDeliveryPlatformChange,
  onDeliveryFeeChange,
  onPlatformCommissionChange,
  discountPresets,
}: FnbCartProps) {
  // Sprint POS-FNB-EXT-1: state cho note textarea expandable
  const [noteExpanded, setNoteExpanded] = useState(false);
  const lines = activeTab?.lines ?? [];
  const isEmpty = lines.length === 0;
  const orderTypeLabel =
    ORDER_TYPE_LABEL[activeTab?.orderType ?? "takeaway"] ?? "Mang về";

  // Stitch FnB POS mockup: cart sidebar
  // - Container: bg-surface-container-lowest rounded-xl ambient-shadow border
  // - Header: tên đơn + badge loại + icons actions
  // - Order type 3 buttons pill row
  // - Items: bg-surface p-3 rounded-lg với qty controls bg-surface-container-low
  // - Footer: summary + 2 primary buttons (Bếp F10 / Thanh toán F9)
  return (
    <div className={cn(
      "flex flex-col bg-surface-container-lowest h-full overflow-hidden",
      mobile
        ? "w-full"
        // Sprint B (CEO 06/05): cart fixed right CHỈ hiện trên lg+ (tablet
        // landscape + desktop). Tablet portrait (md) chuyển sang FAB + drawer
        // giống mobile để menu zone tận full width 624px.
        // Breakpoints sau Sprint B:
        //   md (768-1023, portrait) → hidden, FAB hiển thị
        //   lg (1024+, landscape/desktop) → 320px width
        //   xl (1280+) → 400px width
        //   2xl (1536+) → 440px width
        : "w-[320px] xl:w-[400px] 2xl:w-[440px] hidden lg:flex rounded-xl ambient-shadow border border-outline-variant/20 my-3 mr-3"
    )}>
      {/* ── Header (Sprint UI-5: gradient subtle để tróc khỏi nền + ambient depth) ── */}
      <div className="p-4 border-b border-outline-variant/20 bg-gradient-to-b from-surface-container/50 to-surface-container-lowest shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h2 className="font-heading text-base font-bold text-foreground truncate">
              {activeTab?.label ?? "Đơn hàng"}
            </h2>
            {!isEmpty && (
              <Badge
                variant="secondary"
                className="text-[10px] shrink-0 bg-surface-container-high text-on-surface-variant border-0 font-semibold"
              >
                {lineCount} món
              </Badge>
            )}
            {activeTab?.kitchenOrderId && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-info/10 text-status-info text-[10px] font-semibold shrink-0"
                title="Đơn đã được gửi xuống bếp. Thêm món sẽ gửi bổ sung."
              >
                <Icon name="ramen_dining" size={14} />
                Đã gửi bếp
              </span>
            )}
          </div>
          {/* Kebab actions — chỉ hiện khi đơn đã gửi bếp */}
          {activeTab?.kitchenOrderId && (
            <div className="flex items-center gap-1 shrink-0">
              {activeTab?.orderType === "dine_in" && onTransferTable && (
                <button
                  type="button"
                  onClick={onTransferTable}
                  className="h-8 w-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high active:bg-surface-container transition-colors press-scale-sm"
                  title="Chuyển bàn"
                  aria-label="Chuyển bàn"
                >
                  <Icon name="swap_horiz" size={16} />
                </button>
              )}
              {onVoidKitchenOrder && (
                <button
                  type="button"
                  onClick={onVoidKitchenOrder}
                  className="h-8 w-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-status-error/10 hover:text-status-error active:bg-status-error/20 transition-colors press-scale-sm"
                  title="Huỷ đơn bếp"
                  aria-label="Huỷ đơn bếp"
                >
                  <Icon name="cancel" size={16} />
                </button>
              )}
            </div>
          )}
          {!activeTab?.kitchenOrderId && onOrderHistory && (
            <button
              type="button"
              onClick={onOrderHistory}
              className="h-8 w-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high active:bg-surface-container transition-colors press-scale-sm shrink-0"
              title="Lịch sử đơn — in lại hoá đơn"
              aria-label="Lịch sử đơn"
            >
              <Icon name="receipt_long" size={16} />
            </button>
          )}
        </div>

        {/* Customer bar — Stitch style */}
        <button
          type="button"
          onClick={onCustomerClick}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-low text-sm text-foreground hover:bg-surface-container transition-colors press-scale-sm"
        >
          <Icon name="person" size={16} className="text-muted-foreground shrink-0" />
          <span className="truncate flex-1 text-left">
            {activeTab?.customerName ?? "Khách lẻ"}
          </span>
          <kbd className="text-[10px] text-muted-foreground font-mono bg-surface-container-lowest border border-outline-variant/30 rounded px-2 py-0.5">
            F4
          </kbd>
        </button>

        {/* Sprint POS-FNB-EXT-1: Ghi chú đơn — toggle expandable textarea
            (CEO 08/05). Ghi chú toàn bill khác line.note (từng món). */}
        {onOrderNoteChange && (
          <div className="mt-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setNoteExpanded((v) => !v)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                <Icon name="sticky_note_2" size={14} />
                <span className="flex-1 text-left truncate">
                  {activeTab?.orderNote
                    ? `📝 ${activeTab.orderNote}`
                    : "Thêm ghi chú đơn"}
                </span>
                <Icon
                  name={noteExpanded ? "expand_less" : "expand_more"}
                  size={14}
                  className="opacity-60"
                />
              </button>
              <HelpTip>
                Ghi chú cho TOÀN BILL — vd &quot;Khách kiêng đường&quot;, &quot;Đơn VIP&quot;,
                &quot;Không nhận giấy&quot;. In ra phiếu bếp dòng riêng. Khác ghi chú
                từng món (mở dialog món để nhập).
              </HelpTip>
            </div>
            {noteExpanded && (
              <Textarea
                value={activeTab?.orderNote ?? ""}
                onChange={(e) => onOrderNoteChange(e.target.value)}
                placeholder="VD: Khách kiêng đường hết bill, đơn ưu tiên VIP..."
                className="mt-1 text-xs min-h-[60px] resize-y"
                maxLength={300}
              />
            )}
          </div>
        )}
      </div>

      {/* Order type pill row — Sprint POS-FNB-4 (CEO 06/05).
          Trước: chỉ display badge mode current → muốn đổi phải qua menu.
          Sau: 3 button pill switch instant — cashier chuyển dine-in
          ↔ takeaway ↔ delivery với 1 click ngay tại cart.
          Disable sau khi gửi bếp (kitchenOrderId tồn tại) để tránh
          đổi loại đơn đã in vé bếp gây phục vụ nhầm. */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        {onChangeOrderType && !activeTab?.kitchenOrderId ? (
          <div className="inline-flex items-center rounded-full p-0.5 bg-surface-container-low border border-outline-variant/30">
            {([
              { key: "dine_in", label: "Tại quán", icon: "restaurant" },
              { key: "takeaway", label: "Mang về", icon: "takeout_dining" },
              { key: "delivery", label: "Giao hàng", icon: "local_shipping" },
            ] as const).map((opt) => {
              const isActive = (activeTab?.orderType ?? "takeaway") === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onChangeOrderType(opt.key)}
                  className={cn(
                    "inline-flex items-center gap-1 px-3 h-7 rounded-full text-xs font-medium transition-colors press-scale-sm",
                    isActive
                      ? "bg-primary text-on-primary ambient-shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={isActive}
                >
                  <Icon name={opt.icon} size={13} />
                  {opt.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-primary-fixed text-primary text-xs font-semibold">
            <Icon
              name={
                activeTab?.orderType === "dine_in"
                  ? "restaurant"
                  : activeTab?.orderType === "delivery"
                    ? "local_shipping"
                    : "takeout_dining"
              }
              size={14}
            />
            {orderTypeLabel}
            {activeTab?.kitchenOrderId && (
              <span className="text-[10px] text-muted-foreground ml-1">
                (đã gửi bếp)
              </span>
            )}
          </div>
        )}

        {/* Sprint POS-FNB-EXT-1: Delivery platform section — chỉ hiện khi
            orderType="delivery". Pick sàn → auto-fill commission % từ settings.
            User override được commission + delivery fee. */}
        {activeTab?.orderType === "delivery" &&
          onDeliveryPlatformChange &&
          !activeTab?.kitchenOrderId && (
            <div className="mt-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant/20 space-y-2.5">
              <div className="flex items-center gap-1">
                <span className="text-[11px] uppercase tracking-wider font-bold text-on-surface-variant">
                  Sàn giao hàng
                </span>
                <HelpTip>
                  Chọn sàn để hệ thống tự ghi nhận chiết khấu (% sàn lấy của
                  quán) + phí ship. Dùng cho báo cáo doanh thu net (sau CK).
                  Mặc định % CK lấy từ Cài đặt → Sàn giao hàng.
                </HelpTip>
              </div>
              {/* Platform pills */}
              <div className="flex gap-1 flex-wrap">
                {DELIVERY_PLATFORMS.map((p) => {
                  const isActive =
                    (activeTab.deliveryPlatform ?? "direct") === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => onDeliveryPlatformChange(p.key)}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors",
                        isActive
                          ? p.activeClassName
                          : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {/* Fee + Commission inputs row */}
              {(activeTab.deliveryPlatform ?? "direct") !== "direct" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-on-surface-variant flex items-center gap-1">
                      Phí ship (₫)
                      <HelpTip>
                        Phí giao hàng quán trả cho sàn / shipper. Khách thường
                        thấy &quot;Free ship&quot; nhưng quán vẫn chịu phí qua sàn.
                      </HelpTip>
                    </label>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={activeTab.deliveryFee ?? 0}
                      onChange={(e) =>
                        onDeliveryFeeChange?.(parseInt(e.target.value) || 0)
                      }
                      className="h-8 text-xs"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-on-surface-variant flex items-center gap-1">
                      CK sàn (%)
                      <HelpTip>
                        % chiết khấu sàn lấy của quán. Shopee Food / Grab Food
                        thường 25%, Be 20%. Có thể chỉnh tay nếu sàn ưu đãi
                        riêng cho quán anh.
                      </HelpTip>
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={activeTab.platformCommissionPercent ?? 0}
                      onChange={(e) =>
                        onPlatformCommissionChange?.(
                          parseInt(e.target.value) || 0,
                        )
                      }
                      className="h-8 text-xs"
                      placeholder="0"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
      </div>

      {/* ── Cart lines ── */}
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 px-6 text-center">
          <div className="size-16 rounded-2xl bg-surface-container-low flex items-center justify-center">
            <Icon name="local_cafe" size={32} className="text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium">Chưa có món nào</p>
          <p className="text-xs text-muted-foreground">
            Chọn món từ thực đơn để thêm vào đơn
          </p>
          {/* Sprint POS-FNB-4: CTA shortcuts cho cashier mới
              giúp tìm nhanh thay vì lóng ngóng. */}
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-muted-foreground">
            <kbd className="font-mono bg-surface-container-lowest border border-outline-variant/30 rounded px-1.5 py-0.5">
              F3
            </kbd>
            <span>tìm món</span>
            <span className="opacity-50">·</span>
            <kbd className="font-mono bg-surface-container-lowest border border-outline-variant/30 rounded px-1.5 py-0.5">
              F4
            </kbd>
            <span>chọn khách</span>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-3 flex flex-col gap-2">
            {lines.map((line) => (
              <CartLineItem
                key={line.id}
                line={line}
                onUpdateQty={(qty) => updateLineQty(line.id, qty)}
                onRemove={() => removeLine(line.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* ── Footer: totals + discount + actions ── */}
      <div className="border-t border-outline-variant/20 bg-surface-container-lowest p-4 shrink-0 space-y-3">
        {/* KM-3: Free items section — quà tặng kèm (BOGO + gift) */}
        {freeItems && freeItems.length > 0 && (
          <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-2 space-y-1">
            <div className="flex items-center gap-2">
              <Icon name="redeem" size={14} className="text-status-warning" />
              <span className="text-xs font-semibold text-status-warning">
                Tặng kèm ({freeItems.length} món)
              </span>
            </div>
            <div className="space-y-0.5 pl-5">
              {freeItems.map((free) => {
                const lineMatch = lines.find((l) => l.productId === free.productId);
                const name = lineMatch?.productName ?? free.productName ?? "Sản phẩm";
                return (
                  <div
                    key={free.productId}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <span className="truncate text-foreground">
                      {name}{" "}
                      <span className="text-muted-foreground">× {free.quantity}</span>
                    </span>
                    {free.unitPrice > 0 && (
                      <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                        {formatCurrency(free.quantity * free.unitPrice)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Subtotal */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Tạm tính</span>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {formatCurrency(subtotal)}
          </span>
        </div>

        {/* Discount controls + Preset dropdown (Sprint POS-FNB-EXT-1) */}
        {!isEmpty && onDiscountChange && (
          <DiscountRow
            discount={activeTab?.orderDiscount}
            onChange={onDiscountChange}
            presets={discountPresets}
          />
        )}

        {/* Discount display */}
        {orderDiscountAmount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-status-warning">Giảm giá</span>
            <span className="text-sm font-medium text-status-warning tabular-nums">
              -{formatCurrency(orderDiscountAmount)}
            </span>
          </div>
        )}

        {/* Voucher / Coupon row */}
        {!isEmpty && onApplyCoupon && (
          <CouponRow
            appliedCode={appliedCouponCode}
            applying={couponApplying}
            onApply={onApplyCoupon}
            onRemove={onRemoveCoupon}
          />
        )}

        {/* Total — Sprint POS-FNB-4: số to hơn (3xl) cho cashier liếc xa
            đọc được. Stitch spec dùng text-3xl/4xl để ưu tiên visual.
            font-black thay extrabold để đậm rõ. */}
        <div className="flex items-end justify-between border-t border-outline-variant/20 pt-3">
          <span className="text-sm font-semibold text-foreground pb-0.5">Khách cần trả</span>
          <span className="font-heading text-3xl font-black text-primary tabular-nums tracking-tight leading-none">
            {formatCurrency(total)}
            <span className="text-base font-bold ml-1">đ</span>
          </span>
        </div>

        {!isEmpty && (
          <div className="flex gap-2">
            {onPrintPreBill && (
              <Button
                variant="outline"
                onClick={onPrintPreBill}
                className="flex-1 h-8 text-xs rounded-lg border-outline-variant/40"
              >
                <Icon name="description" size={14} className="mr-1" />
                Tạm tính
              </Button>
            )}
            {onSplitBill && activeTab?.kitchenOrderId && lines.length > 1 && (
              <Button
                variant="outline"
                onClick={onSplitBill}
                className="flex-1 h-8 text-xs rounded-lg border-outline-variant/40"
              >
                <Icon name="content_cut" size={14} className="mr-1" />
                Tách bill
              </Button>
            )}
          </div>
        )}

        {/* Primary actions row — Stitch spec: 40/60 split */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onSendToKitchen}
            disabled={isEmpty}
            className={cn(
              "flex-[0.4] h-14 rounded-xl font-semibold text-sm flex flex-col items-center justify-center gap-0.5 transition-all press-scale-sm",
              activeTab?.kitchenOrderId
                ? "bg-status-info/15 text-status-info hover:bg-status-info/25 disabled:opacity-40 disabled:pointer-events-none"
                : "bg-surface-container-high text-on-surface hover:bg-surface-container disabled:opacity-40 disabled:pointer-events-none"
            )}
          >
            <Icon name={activeTab?.kitchenOrderId ? "add_circle" : "notifications_active"} size={16} />
            <span className="text-xs leading-none">
              {activeTab?.kitchenOrderId ? "Gửi thêm (F10)" : "Bếp (F10)"}
            </span>
          </button>
          <button
            type="button"
            onClick={onPayment}
            disabled={isEmpty}
            className={cn(
              "flex-[0.6] h-14 rounded-xl font-bold text-sm flex flex-col items-center justify-center gap-0.5 transition-all press-scale-sm ambient-shadow",
              "bg-primary text-on-primary hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none"
            )}
          >
            <Icon name="payments" size={16} />
            <span className="text-xs leading-none">Thanh toán (F9)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CouponRow({
  appliedCode,
  applying,
  onApply,
  onRemove,
}: {
  appliedCode?: string;
  applying?: boolean;
  onApply: (code: string) => Promise<void> | void;
  onRemove?: () => void;
}) {
  const [code, setCode] = useState("");

  if (appliedCode) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">Mã</span>
        <div className="flex-1 min-w-0 flex items-center gap-2 px-3 h-9 md:h-7 rounded bg-status-success/10 border border-status-success/30">
          <Icon name="local_offer" size={14} className="text-status-success shrink-0" />
          <span className="text-xs font-semibold text-status-success truncate tabular-nums">
            {appliedCode}
          </span>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="h-9 w-9 md:h-7 md:w-7 rounded border border-border bg-surface-container-low text-muted-foreground hover:text-status-error hover:border-status-error flex items-center justify-center shrink-0 transition-colors"
            title="Bỏ mã khuyến mãi"
            aria-label="Bỏ mã"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    );
  }

  const handleApply = async () => {
    const trimmed = code.trim();
    if (!trimmed || applying) return;
    await onApply(trimmed);
    setCode("");
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground shrink-0">Mã</span>
      <Input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 20))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void handleApply();
          }
        }}
        placeholder="Nhập mã khuyến mãi"
        disabled={applying}
        className="h-9 md:h-7 text-sm md:text-xs flex-1 min-w-0 font-mono uppercase tracking-wider"
      />
      <button
        type="button"
        onClick={handleApply}
        disabled={!code.trim() || applying}
        className={cn(
          "h-9 md:h-7 px-3 rounded border text-xs font-semibold shrink-0 transition-colors",
          code.trim() && !applying
            ? "bg-primary text-on-primary border-primary hover:bg-primary-hover"
            : "bg-surface-container-low text-muted-foreground border-border opacity-60"
        )}
        title="Áp dụng mã"
        aria-label="Áp mã"
      >
        {applying ? (
          <Icon name="progress_activity" size={14} className="animate-spin" />
        ) : (
          "Áp"
        )}
      </button>
    </div>
  );
}

function DiscountRow({
  discount,
  onChange,
  presets,
}: {
  discount: FnbDiscountInput | undefined;
  onChange: (d: FnbDiscountInput | undefined) => void;
  presets?: { id: string; name: string; mode: "amount" | "percent"; value: number }[];
}) {
  const mode = discount?.mode ?? "amount";
  const [localValue, setLocalValue] = useState(
    discount?.value ? String(discount.value) : "",
  );
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);

  const handleValueChange = (v: string) => {
    setLocalValue(v);
    const num = parseInt(v.replace(/\D/g, ""), 10);
    if (!v || Number.isNaN(num) || num <= 0) {
      onChange(undefined);
    } else {
      onChange({ mode, value: num });
    }
  };

  const toggleMode = () => {
    const newMode = mode === "amount" ? "percent" : "amount";
    const num = parseInt(localValue.replace(/\D/g, ""), 10);
    if (localValue && !Number.isNaN(num) && num > 0) {
      onChange({ mode: newMode, value: num });
    }
  };

  // Sprint POS-FNB-EXT-1: Apply preset từ dropdown — set both mode + value
  const applyPreset = (preset: { mode: "amount" | "percent"; value: number }) => {
    setLocalValue(String(preset.value));
    onChange({ mode: preset.mode, value: preset.value });
    setPresetMenuOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">Giảm giá</span>
        <Input
          type="text"
          inputMode="numeric"
          value={localValue}
          onChange={(e) => handleValueChange(e.target.value)}
          placeholder="0"
          className="h-9 md:h-7 text-sm md:text-xs flex-1 min-w-0 tabular-nums"
        />
        <button
          type="button"
          onClick={toggleMode}
          className={cn(
            "h-9 w-9 md:h-7 md:w-7 rounded border flex items-center justify-center shrink-0 transition-colors",
            mode === "percent"
              ? "bg-primary-fixed border-primary text-primary"
              : "bg-surface-container-low border-border text-muted-foreground",
          )}
          title={mode === "percent" ? "Phần trăm" : "Số tiền"}
        >
          {mode === "percent" ? (
            <Icon name="percent" size={14} className="md:h-3 md:w-3" />
          ) : (
            <span className="text-xs md:text-[10px] font-bold">đ</span>
          )}
        </button>
        {/* Sprint POS-FNB-EXT-1: Preset dropdown trigger */}
        {presets && presets.length > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setPresetMenuOpen((v) => !v)}
              className="h-9 w-9 md:h-7 md:w-7 rounded border border-border bg-surface-container-low text-muted-foreground hover:text-primary hover:border-primary flex items-center justify-center transition-colors"
              title="Khuyến mãi nhanh"
            >
              <Icon name="local_offer" size={14} className="md:h-3 md:w-3" />
            </button>
            {presetMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setPresetMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-outline-variant/30 bg-surface-container-lowest shadow-lg overflow-hidden">
                  <div className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-on-surface-variant border-b border-outline-variant/20">
                    Khuyến mãi nhanh
                  </div>
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className="w-full px-3 py-2 text-left text-xs hover:bg-surface-container-low transition-colors flex items-center justify-between"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="font-semibold text-primary tabular-nums shrink-0 ml-2">
                        {p.mode === "percent"
                          ? `${p.value}%`
                          : `${formatCurrency(p.value)}`}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CartLineItem({
  line,
  onUpdateQty,
  onRemove,
}: {
  line: FnbOrderLine;
  onUpdateQty: (qty: number) => void;
  onRemove: () => void;
}) {
  // Stitch FnB mockup cart line:
  // - Wrap card: bg-surface-container-low rounded-lg p-3
  // - Name font-heading semibold + line-total text-primary
  // - Qty controls: pill group bg-surface-container rounded-full
  // - Remove: subtle icon top-right, visible on hover
  return (
    <div className="group relative bg-surface-container-low rounded-lg p-3 hover:bg-surface-container transition-colors">
      <div className="flex items-start justify-between gap-2">
        {/* Name + variant */}
        <div className="flex-1 min-w-0">
          <p className="font-heading text-sm font-semibold text-foreground leading-tight">
            {line.productName}
          </p>
          {line.variantLabel && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {line.variantLabel}
            </p>
          )}
        </div>

        {/* Line total — primary color per Stitch */}
        <span className="text-sm font-bold text-primary shrink-0 tabular-nums">
          {formatCurrency(line.lineTotal)}
        </span>
      </div>

      {/* Toppings */}
      {line.toppings.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {line.toppings.map((t, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">
              + {t.name} x{t.quantity}{" "}
              <span className="text-muted-foreground/80 tabular-nums">
                {formatCurrency(t.price)}
              </span>
            </p>
          ))}
        </div>
      )}
      {line.note && (
        <p className="text-[11px] text-status-warning mt-1 italic">
          &ldquo;{line.note}&rdquo;
        </p>
      )}

      {/* Qty controls + remove — Stitch pill group.
          POS-FIX-C1: tăng touch target lên 36px md+, 44px touch device.
          Trước đây size-7 (28px) — barista đeo găng tap nhầm sang nút xoá. */}
      <div className="flex items-center justify-between mt-3">
        <div className="inline-flex items-center gap-0.5 bg-surface-container-lowest rounded-full p-0.5 border border-outline-variant/15">
          <button
            type="button"
            onClick={() => onUpdateQty(line.quantity - 1)}
            className="size-9 md:size-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-high hover:text-foreground active:bg-surface-container transition-colors press-scale-sm"
            aria-label="Giảm số lượng"
          >
            <Icon name="remove" size={16} />
          </button>
          <span className="text-sm font-semibold w-7 text-center tabular-nums text-foreground">
            {line.quantity}
          </span>
          <button
            type="button"
            onClick={() => onUpdateQty(line.quantity + 1)}
            className="size-9 md:size-8 rounded-full flex items-center justify-center text-primary hover:bg-primary-fixed active:bg-primary-fixed/70 transition-colors press-scale-sm"
            aria-label="Tăng số lượng"
          >
            <Icon name="add" size={16} />
          </button>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="size-9 md:size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-status-error hover:bg-status-error/10 transition-colors opacity-60 md:opacity-0 md:group-hover:opacity-100 press-scale-sm"
          title="Xoá"
          aria-label="Xoá món"
        >
          <Icon name="delete" size={16} />
        </button>
      </div>
    </div>
  );
}
