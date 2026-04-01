"use client";

import { ShoppingCart, Search } from "lucide-react";

interface MobileCartToggleProps {
  mobileView: "products" | "cart";
  cartItemCount: number;
  onSetMobileView: (view: "products" | "cart") => void;
}

export function MobileCartToggle({
  mobileView,
  cartItemCount,
  onSetMobileView,
}: MobileCartToggleProps) {
  return (
    <div className="md:hidden fixed bottom-4 right-4 z-50">
      {mobileView === "products" ? (
        <button
          onClick={() => onSetMobileView("cart")}
          className="relative bg-primary text-white rounded-full size-14 flex items-center justify-center shadow-lg hover:bg-primary/90 active:scale-95 transition-all"
        >
          <ShoppingCart className="size-6" />
          {cartItemCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 font-bold">
              {cartItemCount}
            </span>
          )}
        </button>
      ) : (
        <button
          onClick={() => onSetMobileView("products")}
          className="bg-primary text-white rounded-full size-14 flex items-center justify-center shadow-lg hover:bg-primary/90 active:scale-95 transition-all"
        >
          <Search className="size-6" />
        </button>
      )}
    </div>
  );
}
