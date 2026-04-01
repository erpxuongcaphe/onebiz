"use client";

import { RefObject } from "react";
import { Search, Barcode } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CATEGORIES, type Product } from "../hooks/use-pos-state";

interface ProductGridProps {
  searchRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  selectedCategory: string;
  filteredProducts: Product[];
  addedProductId: string | null;
  mobileView: "products" | "cart";
  onSearchChange: (value: string) => void;
  onSelectCategory: (id: string) => void;
  onAddToCart: (product: Product) => void;
}

export function ProductGrid({
  searchRef,
  searchQuery,
  selectedCategory,
  filteredProducts,
  addedProductId,
  mobileView,
  onSearchChange,
  onSelectCategory,
  onAddToCart,
}: ProductGridProps) {
  return (
    <div
      className={cn(
        "flex-1 flex flex-col min-w-0 bg-gray-50",
        mobileView === "cart" ? "hidden md:flex" : "flex"
      )}
    >
      {/* Search Bar */}
      <div className="p-2 bg-white border-b flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tim hang hoa (F3)"
            className="pl-9 pr-9 h-9"
          />
          <Barcode className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground cursor-pointer hover:text-primary transition-colors" />
        </div>
      </div>

      {/* Category Pills */}
      <div className="px-2 py-1.5 bg-white border-b">
        <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pb-0.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={cn(
                "shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                selectedCategory === cat.id
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      <ScrollArea className="flex-1">
        <div className="p-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {filteredProducts.map((product) => (
            <button
              key={product.id}
              onClick={() => onAddToCart(product)}
              className={cn(
                "bg-white border rounded-lg p-3 text-left hover:shadow-md hover:border-primary/30 transition-all duration-150 active:scale-[0.97]",
                addedProductId === product.id &&
                  "ring-2 ring-primary/50 scale-[0.97]"
              )}
            >
              <div className="text-sm font-medium line-clamp-2 min-h-[2.5rem] leading-tight">
                {product.name}
              </div>
              <div className="mt-1.5 text-sm font-bold text-primary">
                {formatCurrency(product.price)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Ton: {product.stock}
              </div>
            </button>
          ))}
          {filteredProducts.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              Khong tim thay san pham
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
