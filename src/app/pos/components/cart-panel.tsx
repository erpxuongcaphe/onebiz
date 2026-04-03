"use client";

import { Plus, User, ShoppingCart, Search, Barcode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { CartItem, OrderTab, PaymentMethod, SaleMode, CouponInfo } from "@/lib/types";
import { CartItemRow } from "./cart-item-row";
import { PaymentSection } from "./payment-section";
import type { Product } from "../hooks/use-pos-state";
import { RefObject } from "react";

interface CartPanelProps {
  saleMode: SaleMode;
  mobileView: "products" | "cart";
  activeTab: OrderTab;
  cart: CartItem[];
  customerSearch: string;
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
  // Coupon
  couponCode: string;
  appliedCoupon: CouponInfo | null;
  couponError: string;
  onSetCouponCode: (code: string) => void;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
  // Quick mode search
  searchRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  filteredProducts: Product[];
  addedProductId: string | null;
  onSearchChange: (value: string) => void;
  onAddToCart: (product: Product) => void;
  // Cart actions
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
  saleMode,
  mobileView,
  activeTab,
  cart,
  customerSearch,
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
  couponCode,
  appliedCoupon,
  couponError,
  onSetCouponCode,
  onApplyCoupon,
  onRemoveCoupon,
  searchRef,
  searchQuery,
  filteredProducts,
  addedProductId,
  onSearchChange,
  onAddToCart,
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
        "flex flex-col bg-white shrink-0",
        saleMode === "quick"
          ? "w-full flex"
          : cn(
              "w-full md:w-[380px] lg:w-[420px] border-l",
              mobileView === "products" ? "hidden md:flex" : "flex"
            )
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
              placeholder="Tìm khách hàng"
              className="pl-7 h-8 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-xs h-8"
          >
            <Plus className="size-3 mr-1" />
            Tạo KH
          </Button>
        </div>
        <div className="flex items-center gap-2 px-1">
          <User className="size-3.5 text-blue-500" />
          <span className="text-sm font-medium">
            {activeTab.customerName}
          </span>
        </div>
      </div>

      {/* Quick Mode: Inline search bar (no separate product grid) */}
      {saleMode === "quick" && (
        <div className="p-2 border-b bg-gray-50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Quét mã hoặc tìm hàng hóa (F3)"
              className="pl-9 pr-9 h-9 bg-white"
            />
            <Barcode className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground cursor-pointer hover:text-primary" />
          </div>
          {/* Quick search results dropdown */}
          {searchQuery.trim() && filteredProducts.length > 0 && (
            <div className="mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
              {filteredProducts.slice(0, 8).map((product) => (
                <button
                  key={product.id}
                  onClick={() => {
                    onAddToCart(product);
                    onSearchChange("");
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-blue-50 transition-colors",
                    addedProductId === product.id && "bg-blue-50"
                  )}
                >
                  <span className="truncate">{product.name}</span>
                  <span className="text-primary font-medium shrink-0 ml-2">
                    {new Intl.NumberFormat("vi-VN").format(product.price)}đ
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cart Items */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="divide-y">
          {cart.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ShoppingCart className="size-10 mb-2 opacity-30" />
              <p className="text-sm">Chưa có sản phẩm</p>
              {saleMode === "quick" && (
                <p className="text-xs mt-1">Quét mã vạch hoặc tìm hàng hóa phía trên</p>
              )}
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
        saleMode={saleMode}
        subtotal={subtotal}
        orderDiscountAmount={orderDiscountAmount}
        couponDiscountAmount={couponDiscountAmount}
        totalDiscount={totalDiscount}
        shippingFee={shippingFee}
        discountType={discountType}
        discountValue={discountValue}
        showDiscountInput={showDiscountInput}
        totalDue={totalDue}
        customerPayment={customerPayment}
        customerPaymentNum={customerPaymentNum}
        changeAmount={changeAmount}
        paymentMethod={paymentMethod}
        cartLength={cart.length}
        couponCode={couponCode}
        appliedCoupon={appliedCoupon}
        couponError={couponError}
        onSetCouponCode={onSetCouponCode}
        onApplyCoupon={onApplyCoupon}
        onRemoveCoupon={onRemoveCoupon}
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
