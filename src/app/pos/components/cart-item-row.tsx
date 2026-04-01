"use client";

import { useState } from "react";
import { Minus, Plus, X, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { CartItem } from "@/lib/types";

interface CartItemRowProps {
  item: CartItem;
  index: number;
  onUpdateQuantity: (id: string, qty: number) => void;
  onUpdatePrice: (id: string, price: number) => void;
  onUpdateDiscount: (id: string, discount: number) => void;
  onRemove: (id: string) => void;
}

export function CartItemRow({
  item,
  index,
  onUpdateQuantity,
  onUpdatePrice,
  onUpdateDiscount,
  onRemove,
}: CartItemRowProps) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(item.price.toString());
  const [showItemDiscount, setShowItemDiscount] = useState(item.discount > 0);
  const lineTotal = item.quantity * item.price - item.discount;

  return (
    <div className="group px-2 py-2 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-2">
        {/* Row number */}
        <span className="text-xs text-muted-foreground mt-1 w-4 shrink-0 text-right">
          {index + 1}
        </span>

        {/* Item details */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate pr-6">{item.name}</div>
          <div className="flex items-center gap-2 mt-1.5">
            {/* Quantity controls */}
            <div className="flex items-center border rounded h-7">
              <button
                onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                className="px-1.5 h-full hover:bg-gray-100 transition-colors rounded-l"
              >
                <Minus className="size-3" />
              </button>
              <input
                type="number"
                value={item.quantity}
                onChange={(e) =>
                  onUpdateQuantity(item.id, parseInt(e.target.value) || 1)
                }
                className="w-10 h-full text-center text-sm border-x bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                className="px-1.5 h-full hover:bg-gray-100 transition-colors rounded-r"
              >
                <Plus className="size-3" />
              </button>
            </div>

            <span className="text-xs text-muted-foreground">x</span>

            {/* Editable unit price */}
            {editingPrice ? (
              <input
                type="number"
                autoFocus
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                onBlur={() => {
                  onUpdatePrice(item.id, parseInt(priceInput) || item.price);
                  setEditingPrice(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onUpdatePrice(
                      item.id,
                      parseInt(priceInput) || item.price
                    );
                    setEditingPrice(false);
                  }
                  if (e.key === "Escape") {
                    setPriceInput(item.price.toString());
                    setEditingPrice(false);
                  }
                }}
                className="w-20 h-6 text-xs border rounded px-1 text-right outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            ) : (
              <button
                onClick={() => {
                  setPriceInput(item.price.toString());
                  setEditingPrice(true);
                }}
                className="text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                {formatCurrency(item.price)}
              </button>
            )}

            {/* Line total */}
            <span className="ml-auto text-sm font-semibold whitespace-nowrap">
              {formatCurrency(lineTotal)}
            </span>
          </div>

          {/* Per-item discount */}
          <div className="mt-1">
            {!showItemDiscount ? (
              <button
                onClick={() => setShowItemDiscount(true)}
                className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                + Giam gia
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  Giam:
                </span>
                <input
                  type="number"
                  value={item.discount || ""}
                  onChange={(e) =>
                    onUpdateDiscount(item.id, parseInt(e.target.value) || 0)
                  }
                  className="w-20 h-5 text-[11px] border rounded px-1 outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="0"
                />
                <button
                  onClick={() => {
                    onUpdateDiscount(item.id, 0);
                    setShowItemDiscount(false);
                  }}
                  className="text-muted-foreground hover:text-red-500 transition-colors"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Delete button */}
        <button
          onClick={() => onRemove(item.id)}
          className="mt-0.5 p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
