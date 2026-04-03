"use client";

import {
  Banknote,
  ArrowLeftRight,
  CreditCard,
  Tag,
  X,
  Truck,
} from "lucide-react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { roundUpTo } from "../hooks/use-pos-state";
import type { PaymentMethod, CouponInfo, SaleMode } from "@/lib/types";

interface PaymentSectionProps {
  saleMode: SaleMode;
  subtotal: number;
  orderDiscountAmount: number;
  couponDiscountAmount: number;
  totalDiscount: number;
  shippingFee: number;
  discountType: "fixed" | "percent";
  discountValue: number;
  showDiscountInput: boolean;
  totalDue: number;
  customerPayment: string;
  customerPaymentNum: number;
  changeAmount: number;
  paymentMethod: PaymentMethod;
  cartLength: number;
  // Coupon
  couponCode: string;
  appliedCoupon: CouponInfo | null;
  couponError: string;
  onSetCouponCode: (code: string) => void;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
  // Discount
  onSetDiscountType: (type: "fixed" | "percent") => void;
  onSetDiscountValue: (value: number) => void;
  onSetShowDiscountInput: (show: boolean) => void;
  // Payment
  onSetCustomerPayment: (value: string) => void;
  onSetPaymentMethod: (method: PaymentMethod) => void;
  onCheckout: () => void;
}

export function PaymentSection({
  saleMode,
  subtotal,
  orderDiscountAmount,
  couponDiscountAmount,
  totalDiscount,
  shippingFee,
  discountType,
  discountValue,
  showDiscountInput,
  totalDue,
  customerPayment,
  customerPaymentNum,
  changeAmount,
  paymentMethod,
  cartLength,
  couponCode,
  appliedCoupon,
  couponError,
  onSetCouponCode,
  onApplyCoupon,
  onRemoveCoupon,
  onSetDiscountType,
  onSetDiscountValue,
  onSetShowDiscountInput,
  onSetCustomerPayment,
  onSetPaymentMethod,
  onCheckout,
}: PaymentSectionProps) {
  return (
    <div className="border-t bg-white shrink-0">
      <div className="p-2.5 space-y-1.5 text-sm">
        {/* Subtotal */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tổng tiền hàng</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>

        {/* Manual Discount */}
        <div className="flex justify-between items-center">
          <button
            onClick={() => onSetShowDiscountInput(!showDiscountInput)}
            className="text-muted-foreground hover:text-primary text-sm flex items-center gap-1"
          >
            Giảm giá
            {!showDiscountInput && <Plus className="size-3" />}
          </button>
          {orderDiscountAmount > 0 && (
            <span className="text-red-500">
              -{formatCurrency(orderDiscountAmount)}
            </span>
          )}
        </div>
        {showDiscountInput && (
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              value={discountValue || ""}
              onChange={(e) =>
                onSetDiscountValue(parseInt(e.target.value) || 0)
              }
              className="h-7 text-sm flex-1"
              placeholder="0"
            />
            <div className="flex bg-gray-100 rounded overflow-hidden h-7">
              <button
                onClick={() => onSetDiscountType("fixed")}
                className={cn(
                  "px-2 text-xs transition-colors",
                  discountType === "fixed"
                    ? "bg-primary text-white"
                    : "hover:bg-gray-200"
                )}
              >
                đ
              </button>
              <button
                onClick={() => onSetDiscountType("percent")}
                className={cn(
                  "px-2 text-xs transition-colors",
                  discountType === "percent"
                    ? "bg-primary text-white"
                    : "hover:bg-gray-200"
                )}
              >
                %
              </button>
            </div>
          </div>
        )}

        {/* Coupon / Mã giảm giá */}
        {!appliedCoupon ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Tag className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                <Input
                  value={couponCode}
                  onChange={(e) => onSetCouponCode(e.target.value.toUpperCase())}
                  placeholder="Mã giảm giá"
                  className="h-7 text-xs pl-7 uppercase"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onApplyCoupon();
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5 shrink-0"
                onClick={onApplyCoupon}
              >
                Áp dụng
              </Button>
            </div>
            {couponError && (
              <p className="text-[11px] text-red-500 pl-1">{couponError}</p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded px-2 py-1">
            <div className="flex items-center gap-1.5">
              <Tag className="size-3 text-green-600" />
              <span className="text-xs font-medium text-green-700">
                {appliedCoupon.code}
              </span>
              <span className="text-xs text-green-600">
                (-{formatCurrency(couponDiscountAmount)})
              </span>
            </div>
            <button
              onClick={onRemoveCoupon}
              className="text-green-600 hover:text-red-500 transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* Shipping fee (delivery mode only) */}
        {saleMode === "delivery" && shippingFee > 0 && (
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground flex items-center gap-1">
              <Truck className="size-3" />
              Phí giao hàng
            </span>
            <span>{formatCurrency(shippingFee)}</span>
          </div>
        )}

        {/* Total Discount summary */}
        {totalDiscount > 0 && (
          <div className="flex justify-between text-red-500 text-xs">
            <span>Tổng giảm</span>
            <span>-{formatCurrency(totalDiscount)}</span>
          </div>
        )}

        {/* Total Due */}
        <div className="flex justify-between items-baseline pt-1.5 border-t">
          <span className="font-semibold">Khách cần trả</span>
          <span className="text-xl font-bold text-primary">
            {formatCurrency(totalDue)}
          </span>
        </div>

        {/* Customer Payment */}
        <div className="space-y-1.5 pt-1">
          <span className="text-muted-foreground text-xs">
            Tiền khách đưa
          </span>
          <Input
            type="number"
            value={customerPayment}
            onChange={(e) => onSetCustomerPayment(e.target.value)}
            placeholder={formatCurrency(totalDue)}
            className="h-9 text-right font-medium text-base"
          />

          {/* Quick amount buttons */}
          {totalDue > 0 && (
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => onSetCustomerPayment(totalDue.toString())}
                className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs hover:bg-blue-100 transition-colors font-medium"
              >
                {formatCurrency(totalDue)}
              </button>
              {[10000, 20000, 50000, 100000, 200000, 500000]
                .map((amt) => roundUpTo(totalDue, amt))
                .filter(
                  (rounded, i, arr) =>
                    rounded > totalDue &&
                    rounded <= totalDue * 3 &&
                    arr.indexOf(rounded) === i
                )
                .slice(0, 4)
                .map((rounded) => (
                  <button
                    key={rounded}
                    onClick={() => onSetCustomerPayment(rounded.toString())}
                    className="px-2 py-1 rounded bg-gray-100 text-xs hover:bg-gray-200 transition-colors"
                  >
                    {formatCurrency(rounded)}
                  </button>
                ))}
            </div>
          )}

          {/* Change */}
          {customerPaymentNum > totalDue && totalDue > 0 && (
            <div className="flex justify-between text-sm pt-0.5">
              <span className="text-muted-foreground">Tiền thừa</span>
              <span className="font-medium text-green-600">
                {formatCurrency(changeAmount)}
              </span>
            </div>
          )}
        </div>

        {/* Payment Method */}
        <div className="flex gap-1.5 pt-1.5">
          {(
            [
              { key: "cash", label: "Tiền mặt", icon: Banknote },
              { key: "transfer", label: "Chuyển khoản", icon: ArrowLeftRight },
              { key: "card", label: "Thẻ", icon: CreditCard },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onSetPaymentMethod(key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-medium border transition-colors",
                paymentMethod === key
                  ? "bg-primary/10 border-primary text-primary"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50"
              )}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Checkout Button */}
        <Button
          onClick={onCheckout}
          disabled={cartLength === 0}
          className="w-full h-12 bg-green-600 hover:bg-green-700 text-white text-base font-bold rounded-lg border-0 disabled:opacity-50 mt-1"
        >
          THANH TOÁN (F9)
        </Button>
      </div>
    </div>
  );
}
