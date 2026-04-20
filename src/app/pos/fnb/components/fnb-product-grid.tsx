"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";

export interface FnbProduct {
  id: string;
  name: string;
  code: string;
  sell_price: number;
  image_url?: string;
  stock: number;
  category_id: string | null;
}

interface FnbProductGridProps {
  products: FnbProduct[];
  onSelectProduct: (product: FnbProduct) => void;
}

export function FnbProductGrid({
  products,
  onSelectProduct,
}: FnbProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <Icon name="local_cafe" size={40} className="mb-3" />
        <p className="text-sm">Không có sản phẩm nào</p>
      </div>
    );
  }

  // Stitch FnB POS spec: 2-4 col grid (ít đông), card aspect-square image với
  // price badge primary-container floating + font-headline semibold name.
  // Giữ grid dense hơn trên xl (5-6 col) để productivity, nhưng card cao hơn.
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-3">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          onClick={() => onSelectProduct(product)}
        />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  onClick,
}: {
  product: FnbProduct;
  onClick: () => void;
}) {
  const outOfStock = product.stock <= 0;
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col bg-surface-container-low rounded-xl overflow-hidden press-scale-sm transition-all duration-200 text-left",
        "hover:bg-surface-container-lowest hover:ambient-shadow border border-transparent hover:border-outline-variant/15",
        outOfStock && "opacity-50 pointer-events-none"
      )}
    >
      {/* Image area — aspect-square với padding Stitch style */}
      <div className="aspect-square overflow-hidden relative p-2">
        {product.image_url && !imageError ? (
          <>
            {!imageLoaded && (
              <Skeleton className="absolute inset-2 rounded-lg" />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image_url}
              alt={product.name}
              className={cn(
                "h-full w-full object-cover rounded-lg group-hover:scale-105 transition-transform duration-500",
                !imageLoaded && "opacity-0"
              )}
              loading="lazy"
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                setImageError(true);
                setImageLoaded(true);
              }}
            />
          </>
        ) : (
          <div className="h-full w-full rounded-lg bg-primary-fixed/40 flex items-center justify-center">
            <Icon name="local_cafe" size={32} className="text-primary/60" />
          </div>
        )}

        {/* Price badge — Stitch glass style top-right */}
        <div className="absolute top-3 right-3 bg-primary/90 backdrop-blur-[20px] text-on-primary text-[11px] font-bold px-2.5 py-1 rounded-full ambient-shadow">
          {formatCurrency(product.sell_price)}
        </div>

        {/* Out of stock overlay */}
        {outOfStock && (
          <div className="absolute inset-2 bg-surface-container-lowest/60 backdrop-blur-sm rounded-lg flex items-center justify-center">
            <Badge variant="destructive" className="text-xs px-2 py-1 font-bold">
              Hết hàng
            </Badge>
          </div>
        )}
      </div>

      {/* Name + status */}
      <div className="px-3 pb-3 pt-1">
        <h3 className="font-heading font-semibold text-sm text-foreground line-clamp-2 leading-tight mb-0.5">
          {product.name}
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {outOfStock ? "Hết hàng" : "Sẵn sàng"}
        </p>
      </div>
    </button>
  );
}
