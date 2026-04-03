"use client";

import { RefObject } from "react";
import { Search, Barcode, LayoutGrid, List, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { Product, Category } from "../hooks/use-pos-state";

interface ProductGridProps {
  searchRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  selectedCategory: string;
  categories: Category[];
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
  categories,
  filteredProducts,
  addedProductId,
  mobileView,
  onSearchChange,
  onSelectCategory,
  onAddToCart,
}: ProductGridProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  return (
    <div
      className={cn(
        "flex-1 flex flex-col min-w-0 bg-gray-50",
        mobileView === "cart" ? "hidden md:flex" : "flex"
      )}
    >
      {/* Search Bar */}
      <div className="p-2 bg-white border-b flex gap-2 items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm hàng hóa (F3)"
            className="pl-9 pr-9 h-9"
          />
          <Barcode className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground cursor-pointer hover:text-primary transition-colors" />
        </div>
        {/* View toggle */}
        <div className="hidden sm:flex items-center bg-gray-100 rounded h-8 overflow-hidden">
          <button
            onClick={() => setViewMode("grid")}
            className={cn(
              "p-1.5 transition-colors",
              viewMode === "grid" ? "bg-primary text-white" : "text-gray-500 hover:text-gray-700"
            )}
            title="Xem dạng lưới"
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "p-1.5 transition-colors",
              viewMode === "list" ? "bg-primary text-white" : "text-gray-500 hover:text-gray-700"
            )}
            title="Xem dạng danh sách"
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {/* Category Pills */}
      <div className="px-2 py-1.5 bg-white border-b">
        <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pb-0.5">
          {categories.map((cat) => (
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

      {/* Products */}
      <ScrollArea className="flex-1">
        {viewMode === "grid" ? (
          /* Grid View */
          <div className="p-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => onAddToCart(product)}
                className={cn(
                  "bg-white border rounded-lg p-2.5 text-left hover:shadow-md hover:border-primary/30 transition-all duration-150 active:scale-[0.97]",
                  addedProductId === product.id &&
                    "ring-2 ring-primary/50 scale-[0.97]"
                )}
              >
                {/* Image placeholder */}
                <div className="aspect-square rounded bg-gray-50 border border-gray-100 flex items-center justify-center mb-2">
                  <Package className="size-8 text-gray-300" />
                </div>
                <div className="text-sm font-medium line-clamp-2 min-h-[2.5rem] leading-tight">
                  {product.name}
                </div>
                <div className="mt-1 text-sm font-bold text-primary">
                  {formatCurrency(product.price)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Tồn: {product.stock}
                </div>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                <Package className="size-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Không tìm thấy sản phẩm</p>
              </div>
            )}
          </div>
        ) : (
          /* List View */
          <div className="divide-y">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => onAddToCart(product)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-blue-50/50 transition-colors active:bg-blue-50",
                  addedProductId === product.id && "bg-blue-50"
                )}
              >
                <div className="size-10 rounded bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                  <Package className="size-5 text-gray-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{product.name}</div>
                  <div className="text-[11px] text-muted-foreground">Tồn: {product.stock}</div>
                </div>
                <div className="text-sm font-bold text-primary shrink-0">
                  {formatCurrency(product.price)}
                </div>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="size-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Không tìm thấy sản phẩm</p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
