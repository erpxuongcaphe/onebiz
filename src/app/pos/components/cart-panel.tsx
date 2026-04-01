"use client";

import { Plus, User, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { CartItem, OrderTab, PaymentMethod } from "@/lib/types";
import { CartItemRow } from "./cart-item-row";
import { PaymentSection } from "./payment-section";

interface CartPanelProps {
  mobileView: "products" | "cart";
  activeTab: OrderTab;
  cart: CartItem[];
  customerSearch: string;
  subtotal: number;
  discountAmount: number;
  discountType: "fixed" | "percent";
  discountValue: number;
  showDiscountInput: boolean;
  totalDue: number;
  customerPayment: string;
  customerPaymentNum: number;
  changeAmount: number;
  paymentMethod: PaymentMethod;
  onSetCustomerSearch: (value: string) => void;
  onUpdateQuantity: (id: string, qty: number) => void;
  onUpdatePrice: (id: string, price: number) => void;
  onUpdateItemDiscount: (id: string, discount: number) => void;
  onRemoveFromCart: (id: string) => void;
  onSetDiscountType: (type: "fixed" | "percent") => void;
  onSetDiscountValue: (value: number) => void;
  onSetShowDiscountInput: (show: boolean) => void;
  onSetCustomerPayment: (value: string) => void;
  onSetPaymentMethod: (method: PaymentMethod) => void;
  onCheckout: () => void;
}

export function CartPanel({
  mobileView,
  activeTab,
  cart,
  customerSearch,
  subtotal,
  discountAmount,
  discountType,
  discountValue,
  showDiscountInput,
  totalDue,
  customerPayment,
  customerPaymentNum,
  changeAmount,
  paymentMethod,
  onSetCustomerSearch,
  onUpdateQuantity,
  onUpdatePrice,
  onUpdateItemDiscount,
  onRemoveFromCart,
  onSetDiscountType,
  onSetDiscountValue,
  onSetShowDiscountInput,
  onSetCustomerPayment,
  onSetPaymentMethod,
  onCheckout,
}: CartPanelProps) {
  return (
    <div
      className={cn(
        "w-full md:w-[380px] lg:w-[420px] border-l flex flex-col bg-white shrink-0",
        mobileView === "products" ? "hidden md:flex" : "flex"
      )}
    >
      {/* Customer Section */}
      <div className="p-2 border-b space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <User className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={customerSearch}
              onChange={(e) => onSetCustomerSearch(e.target.value)}
              placeholder="Tim khach hang"
              className="pl-7 h-8 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-xs h-8"
          >
            <Plus className="size-3 mr-1" />
            Tao KH
          </Button>
        </div>
        <div className="flex items-center gap-2 px-1">
          <User className="size-3.5 text-blue-500" />
          <span className="text-sm font-medium">
            {activeTab.customerName}
          </span>
        </div>
      </div>

      {/* Cart Items */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="divide-y">
          {cart.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ShoppingCart className="size-10 mb-2 opacity-30" />
              <p className="text-sm">Chua co san pham</p>
            </div>
          )}
          {cart.map((item, index) => (
            <CartItemRow
              key={item.id}
              item={item}
              index={index}
              onUpdateQuantity={onUpdateQuantity}
              onUpdatePrice={onUpdatePrice}
              onUpdateDiscount={onUpdateItemDiscount}
              onRemove={onRemoveFromCart}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Order Summary + Payment */}
      <PaymentSection
        subtotal={subtotal}
        discountAmount={discountAmount}
        discountType={discountType}
        discountValue={discountValue}
        showDiscountInput={showDiscountInput}
        totalDue={totalDue}
        customerPayment={customerPayment}
        customerPaymentNum={customerPaymentNum}
        changeAmount={changeAmount}
        paymentMethod={paymentMethod}
        cartLength={cart.length}
        onSetDiscountType={onSetDiscountType}
        onSetDiscountValue={onSetDiscountValue}
        onSetShowDiscountInput={onSetShowDiscountInput}
        onSetCustomerPayment={onSetCustomerPayment}
        onSetPaymentMethod={onSetPaymentMethod}
        onCheckout={onCheckout}
      />
    </div>
  );
}
