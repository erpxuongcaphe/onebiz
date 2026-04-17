"use client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

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
      <div className="flex flex-col items-center justify-center h-48 text-gray-400">
        <Icon name="local_cafe" size={40} className="mb-3" />
        <p className="text-sm">Không có sản phẩm nào</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-1.5 p-2">
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

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center bg-white rounded-lg border border-gray-200 overflow-hidden transition-all text-center group",
        "hover:border-primary hover:shadow-md active:scale-[0.97]",
        "px-2 py-3 md:px-1.5 md:py-2 min-h-[88px] md:min-h-[72px]",
        outOfStock && "opacity-50"
      )}
    >
      {/* Out of stock overlay */}
      {outOfStock && (
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0.5">
            Hết
          </Badge>
        </div>
      )}

      {/* Image (only if exists) */}
      {product.image_url ? (
        <div className="relative h-12 w-12 md:h-10 md:w-10 rounded overflow-hidden mb-1 shrink-0">
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <Icon name="inventory_2" size={24} className="md:h-5 md:w-5 text-muted-foreground/30 mb-1 shrink-0" />
      )}

      {/* Price — prominent, on top */}
      <p className="text-sm md:text-xs font-bold text-primary tabular-nums">
        {formatCurrency(product.sell_price)}
      </p>

      {/* Name */}
      <p className="text-xs md:text-[11px] font-medium text-gray-700 line-clamp-2 leading-tight mt-0.5">
        {product.name}
      </p>
    </button>
  );
}
